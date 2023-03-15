/* eslint-disable @typescript-eslint/no-non-null-assertion */

import hre, {getNamedAccounts} from "hardhat"
import {
  getUSDCAddress,
  MAINNET_ONE_SPLIT_ADDRESS,
  getSignerForAddress,
  MAINNET_CUSDC_ADDRESS,
  TRANCHES,
  MAINNET_CHAIN_ID,
  getProtocolOwner,
  getTruffleContract,
  getEthersContract,
} from "../../blockchain_scripts/deployHelpers"
import {
  MAINNET_GOVERNANCE_MULTISIG,
  MAINNET_TRUSTED_SIGNER_ADDRESS,
} from "../../blockchain_scripts/mainnetForkingHelpers"
import {getExistingContracts} from "../../blockchain_scripts/deployHelpers/getExistingContracts"
import {CONFIG_KEYS} from "../../blockchain_scripts/configKeys"
import {time} from "@openzeppelin/test-helpers"

const {deployments, ethers, artifacts, web3} = hre
const Borrower = artifacts.require("Borrower")
const IOneSplit = artifacts.require("IOneSplit")
import {
  expect,
  expectAction,
  erc20Approve,
  usdcVal,
  getBalance,
  MAX_UINT,
  bigVal,
  advanceTime,
  BN,
  ZERO_ADDRESS,
  createPoolWithCreditLine,
  decodeLogs,
  getDeployedAsTruffleContract,
  getOnlyLog,
  getFirstLog,
  toEthers,
  mineInSameBlock,
  mineBlock,
  decodeAndGetFirstLog,
  erc721Approve,
  erc20Transfer,
  advanceAndMineBlock,
  getNumShares,
  HALF_CENT,
  ZERO,
  fiduVal,
  borrowers,
  stakedFiduHolders,
  amountLessProtocolFee,
  protocolFee,
  usdcFromShares,
  getCurrentTimestamp,
  getTruffleContractAtAddress,
  SECONDS_PER_DAY,
} from "../testHelpers"

import {asNonNullable, assertIsString, assertNonNullable} from "@goldfinch-eng/utils"
import {
  BackerRewardsInstance,
  BorrowerInstance,
  CommunityRewardsInstance,
  CreditLineInstance,
  FiduInstance,
  FixedLeverageRatioStrategyInstance,
  GFIInstance,
  GoInstance,
  GoldfinchConfigInstance,
  GoldfinchFactoryInstance,
  ICurveLPInstance,
  MerkleDirectDistributorInstance,
  MerkleDistributorInstance,
  PoolTokensInstance,
  SeniorPoolInstance,
  StakingRewardsInstance,
  TranchedPoolContract,
  TranchedPoolInstance,
  UniqueIdentityInstance,
  WithdrawalRequestTokenInstance,
  ZapperInstance,
} from "@goldfinch-eng/protocol/typechain/truffle"
import {DepositMade} from "@goldfinch-eng/protocol/typechain/truffle/contracts/protocol/core/TranchedPool"
import {TokenMinted} from "@goldfinch-eng/protocol/typechain/truffle/contracts/protocol/core/PoolTokens"
import {Granted} from "@goldfinch-eng/protocol/typechain/truffle/contracts/rewards/CommunityRewards"
import {assertCommunityRewardsVestingRewards} from "../communityRewardsHelpers"
import {TOKEN_LAUNCH_TIME_IN_SECONDS} from "@goldfinch-eng/protocol/blockchain_scripts/baseDeploy"
import {promises as fs} from "fs"
import _ from "lodash"
import {MerkleDistributorInfo} from "../../blockchain_scripts/merkle/merkleDistributor/types"
import {
  NO_VESTING_MERKLE_INFO_PATH,
  VESTING_MERKLE_INFO_PATH,
} from "../../blockchain_scripts/airdrop/community/calculation"
import {MerkleDirectDistributorInfo} from "../../blockchain_scripts/merkle/merkleDirectDistributor/types"
import {
  DepositedAndStaked,
  DepositedToCurveAndStaked,
  RewardPaid,
  Staked,
  Unstaked,
} from "@goldfinch-eng/protocol/typechain/truffle/contracts/rewards/StakingRewards"
import {impersonateAccount} from "../../blockchain_scripts/helpers/impersonateAccount"
import {fundWithWhales} from "../../blockchain_scripts/helpers/fundWithWhales"
import {
  BackerRewards,
  CreditLine,
  StakingRewards,
  TranchedPool,
  UniqueIdentity,
  Borrower as EthersBorrower,
} from "@goldfinch-eng/protocol/typechain/ethers"
import {ContractReceipt, Wallet} from "ethers"
import BigNumber from "bignumber.js"
import {
  BorrowerCreated,
  PoolCreated,
} from "@goldfinch-eng/protocol/typechain/truffle/contracts/protocol/core/GoldfinchFactory"

const THREE_YEARS_IN_SECONDS = 365 * 24 * 60 * 60 * 3
const TOKEN_LAUNCH_TIME = new BN(TOKEN_LAUNCH_TIME_IN_SECONDS).add(new BN(THREE_YEARS_IN_SECONDS))

const circleEoa = "0x55FE002aefF02F77364de339a1292923A15844B8"

const setupTest = deployments.createFixture(async ({deployments}) => {
  // Note: Even if we do not have any pending mainnet migrations,
  // the "fixture" part is what lets hardhat
  // snapshot and give us a clean blockchain before each test.
  // Otherwise, we have state leaking across tests.
  await deployments.fixture("pendingMainnetMigrations", {keepExistingDeployments: true})

  const [owner, bwr] = await web3.eth.getAccounts()
  assertNonNullable(owner)
  assertNonNullable(bwr)

  // Ensure the multisig has funds for various transactions
  const ownerAccount = await getSignerForAddress(owner)
  assertNonNullable(ownerAccount)
  await ownerAccount.sendTransaction({to: MAINNET_GOVERNANCE_MULTISIG, value: ethers.utils.parseEther("10.0")})

  await impersonateAccount(hre, MAINNET_GOVERNANCE_MULTISIG)

  const mainnetMultisigSigner = ethers.provider.getSigner(MAINNET_GOVERNANCE_MULTISIG)
  const contractNames = ["SeniorPool", "Fidu", "GoldfinchFactory", "GoldfinchConfig", "Go"]
  const existingContracts = await getExistingContracts(contractNames, mainnetMultisigSigner)

  const usdcAddress = getUSDCAddress(MAINNET_CHAIN_ID)
  assertIsString(usdcAddress)
  const usdc = await artifacts.require("IERC20withDec").at(usdcAddress)
  const cUSDC = await artifacts.require("IERC20withDec").at(MAINNET_CUSDC_ADDRESS)

  assertNonNullable(existingContracts.SeniorPool)
  assertNonNullable(existingContracts.Fidu)
  assertNonNullable(existingContracts.GoldfinchConfig)
  assertNonNullable(existingContracts.GoldfinchFactory)

  const seniorPool: SeniorPoolInstance = await artifacts
    .require("SeniorPool")
    .at(existingContracts.SeniorPool.ExistingContract.address)

  const fidu: FiduInstance = await artifacts.require("Fidu").at(existingContracts.Fidu.ExistingContract.address)

  const go: GoInstance = await artifacts.require("Go").at(existingContracts.Go?.ExistingContract.address)

  const legacyGoldfinchConfig = await artifacts.require("GoldfinchConfig").at(await go.legacyGoList())

  const goldfinchConfig: GoldfinchConfigInstance = await artifacts
    .require("GoldfinchConfig")
    .at(existingContracts.GoldfinchConfig.ExistingContract.address)

  const backerRewards: BackerRewardsInstance = await getTruffleContract<BackerRewardsInstance>("BackerRewards")

  const goldfinchFactory: GoldfinchFactoryInstance = await artifacts
    .require("GoldfinchFactory")
    .at(existingContracts.GoldfinchFactory.ExistingContract.address)

  const seniorPoolStrategyAddress = await goldfinchConfig.getAddress(CONFIG_KEYS.SeniorPoolStrategy)
  const seniorPoolStrategy: FixedLeverageRatioStrategyInstance = await artifacts
    .require("FixedLeverageRatioStrategy")
    .at(seniorPoolStrategyAddress)

  const stakingRewards: StakingRewardsInstance = await getTruffleContract<StakingRewardsInstance>("StakingRewards")

  const poolTokens: PoolTokensInstance = await getTruffleContract<PoolTokensInstance>("PoolTokens")

  // GFI is deployed by the temp multisig
  const gfi = await getDeployedAsTruffleContract<GFIInstance>(deployments, "GFI")

  const communityRewards = await getDeployedAsTruffleContract<CommunityRewardsInstance>(deployments, "CommunityRewards")
  await communityRewards.setTokenLaunchTimeInSeconds(TOKEN_LAUNCH_TIME, {from: await getProtocolOwner()})

  const merkleDistributor = await getDeployedAsTruffleContract<MerkleDistributorInstance>(
    deployments,
    "MerkleDistributor"
  )

  const merkleDirectDistributor = await getDeployedAsTruffleContract<MerkleDirectDistributorInstance>(
    deployments,
    "MerkleDirectDistributor"
  )

  const uniqueIdentity = await getDeployedAsTruffleContract<UniqueIdentityInstance>(deployments, "UniqueIdentity")

  const ethersUniqueIdentity = await toEthers<UniqueIdentity>(uniqueIdentity)
  const signer = ethersUniqueIdentity.signer
  assertNonNullable(signer.provider, "Signer provider is null")
  const network = await signer.provider.getNetwork()

  const requestTokens = await getTruffleContract<WithdrawalRequestTokenInstance>("WithdrawalRequestToken")

  const zapper: ZapperInstance = await getDeployedAsTruffleContract<ZapperInstance>(deployments, "Zapper")

  return {
    poolTokens,
    seniorPool,
    requestTokens,
    seniorPoolStrategy,
    usdc,
    fidu,
    goldfinchConfig,
    goldfinchFactory,
    cUSDC,
    go,
    stakingRewards,
    backerRewards,
    zapper,
    gfi,
    communityRewards,
    merkleDistributor,
    merkleDirectDistributor,
    legacyGoldfinchConfig,
    uniqueIdentity,
    ethersUniqueIdentity,
    signer,
    network,
  }
})

export const TEST_TIMEOUT = 180000 // 3 mins

/*
These tests are special. They use existing mainnet state, so
that we can easily and realistically test interactions with outside protocols
and contracts.
*/
describe("mainnet forking tests", async function () {
  // eslint-disable-next-line no-unused-vars
  let accounts, owner, bwr, person3, usdc, fidu, goldfinchConfig
  let goldfinchFactory: GoldfinchFactoryInstance, busd, usdt
  let reserveAddress,
    tranchedPool: TranchedPoolInstance,
    borrower,
    seniorPool: SeniorPoolInstance,
    seniorPoolStrategy,
    go: GoInstance,
    requestTokens: WithdrawalRequestTokenInstance,
    stakingRewards: StakingRewardsInstance,
    curvePool: ICurveLPInstance,
    backerRewards: BackerRewardsInstance,
    zapper: ZapperInstance,
    gfi: GFIInstance,
    communityRewards: CommunityRewardsInstance,
    merkleDistributor: MerkleDistributorInstance,
    merkleDirectDistributor: MerkleDirectDistributorInstance,
    legacyGoldfinchConfig: GoldfinchConfigInstance,
    uniqueIdentity: UniqueIdentityInstance,
    poolTokens: PoolTokensInstance

  async function setupSeniorPool() {
    seniorPoolStrategy = await artifacts.require("ISeniorPoolStrategy").at(seniorPoolStrategy.address)

    await erc20Approve(usdc, seniorPool.address, usdcVal(100_000), [owner])
    await seniorPool.deposit(usdcVal(100_000), {from: owner})
  }

  async function createBorrowerContract() {
    const result = await goldfinchFactory.createBorrower(bwr)
    assertNonNullable(result.logs)
    const bwrConAddr = (result.logs[result.logs.length - 1] as unknown as BorrowerCreated).args.borrower
    const bwrCon = await Borrower.at(bwrConAddr)
    await erc20Approve(busd, bwrCon.address, MAX_UINT, [bwr])
    await erc20Approve(usdt, bwrCon.address, MAX_UINT, [bwr])
    return bwrCon
  }

  async function initializeTranchedPool(pool, bwrCon) {
    await erc20Approve(usdc, pool.address, usdcVal(100000), [owner])
    await pool.deposit(TRANCHES.Junior, usdcVal(2000))
    await bwrCon.lockJuniorCapital(pool.address, {from: bwr})
    await pool.grantRole(await pool.SENIOR_ROLE(), owner, {from: MAINNET_GOVERNANCE_MULTISIG})
    await pool.deposit(TRANCHES.Senior, usdcVal(8000))
    await pool.revokeRole(await pool.SENIOR_ROLE(), owner, {from: MAINNET_GOVERNANCE_MULTISIG})
  }

  const stratosEoa = "0x26b36FB2a3Fd28Df48bc1B77cDc2eCFdA3A5fF9D"

  beforeEach(async function () {
    this.timeout(TEST_TIMEOUT)
    accounts = await web3.eth.getAccounts()
    ;[owner, bwr, person3] = accounts
    ;({
      usdc,
      goldfinchFactory,
      seniorPool,
      seniorPoolStrategy,
      fidu,
      goldfinchConfig,
      go,
      stakingRewards,
      backerRewards,
      zapper,
      gfi,
      communityRewards,
      merkleDistributor,
      merkleDirectDistributor,
      legacyGoldfinchConfig,
      uniqueIdentity,
      poolTokens,
      requestTokens,
    } = await setupTest())
    reserveAddress = await goldfinchConfig.getAddress(CONFIG_KEYS.TreasuryReserve)
    const usdcAddress = getUSDCAddress(MAINNET_CHAIN_ID)
    assertIsString(usdcAddress)
    const busdAddress = "0x4fabb145d64652a948d72533023f6e7a623c7c53"
    const usdtAddress = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
    const curveAddress = "0x80aa1a80a30055DAA084E599836532F3e58c95E2"
    busd = await artifacts.require("IERC20withDec").at(busdAddress)
    usdt = await artifacts.require("IERC20withDec").at(usdtAddress)
    curvePool = await artifacts.require("ICurveLP").at(curveAddress)
    await fundWithWhales(["USDC", "BUSD", "USDT"], [owner, bwr, person3])
    const {gf_deployer} = await getNamedAccounts()
    await fundWithWhales(["ETH"], [gf_deployer!, MAINNET_TRUSTED_SIGNER_ADDRESS, stratosEoa])
    await erc20Approve(usdc, seniorPool.address, MAX_UINT, accounts)
    await legacyGoldfinchConfig.bulkAddToGoList([owner, bwr, person3], {from: MAINNET_GOVERNANCE_MULTISIG})
    await setupSeniorPool()
  })

  describe("Go", () => {
    it("should not be re-initializable", async () => {
      await expect(
        go.initialize(Wallet.createRandom().address, goldfinchConfig.address, uniqueIdentity.address)
      ).to.be.rejectedWith(/Contract instance has already been initialized/)
    })
  })

  describe("epoch withdrawals", () => {
    async function repayPool(i: number, owner) {
      const pool = await getTruffleContract<TranchedPoolInstance>("TranchedPool", {at: borrowers[i]!.poolAddress})
      const cl = await getTruffleContract<CreditLineInstance>("CreditLine", {at: await pool.creditLine()})

      await pool.assess()

      // Advance time to the end of the epoch or next due time, whichever is later
      // We do this because we need to ensure that the epoch has passed
      const fourteenDaysInSeconds = new BN(14 * 24 * 60 * 60)
      const timeToAdvance = BN.max(await cl.nextDueTime(), new BN(await time.latest()).add(fourteenDaysInSeconds))
      await advanceTime({toSecond: timeToAdvance})
      await pool.assess()

      const interestOwed = await cl.interestOwed()
      await fundWithWhales(["USDC"], [owner.address])
      await impersonateAccount(hre, owner.address)
      await usdc.approve(pool.address, interestOwed, {from: owner.address})
      await pool.pay(await cl.interestOwed(), {from: owner.address})
    }

    async function redeemPool(token: number) {
      const tokenPreRedeem = await poolTokens.getTokenInfo(token)
      await expectAction(() => seniorPool.redeem(token)).toChange([
        [() => usdc.balanceOf(seniorPool.address), {increase: true}],
        [seniorPool.usdcAvailable, {increase: true}],
      ])
      const tokenPostRedeem = await poolTokens.getTokenInfo(token)
      const interestRedeemed = new BN(tokenPostRedeem.interestRedeemed).sub(new BN(tokenPreRedeem.interestRedeemed))
      const principalRedeemed = new BN(tokenPostRedeem.principalRedeemed).sub(new BN(tokenPreRedeem.principalRedeemed))
      return interestRedeemed.add(principalRedeemed)
    }

    // NOTE: This test can fail when the forked mainnet block is moved forward since the repayPool function
    //       advances time to the next due time. The duration until the next due time is variable depending on the current time.
    it("withdraws", async () => {
      const [owner] = await ethers.getSigners()
      assertNonNullable(owner)

      await fundWithWhales(["USDC"], [owner.address], 1_000_000)

      let usdcAvailable = await seniorPool.usdcAvailable()
      const expectedFiduLiquidatedByEpoch: BN[] = []
      const expectedUsdcAllocatedByEpoch: BN[] = []
      const fiduRequestedByEpoch: BN[] = []
      const withdrawalRequestsByEpoch: any[] = []

      // Each staked fidu holder is going to unstake and request to withdraw
      const currentEpoch = await seniorPool.currentEpoch()
      const latestMainnetWithdrawalRequestIndex = (await requestTokens._tokenIdTracker()).toNumber()

      fiduRequestedByEpoch.push(new BN(currentEpoch.fiduRequested))
      for (let i = 0; i < stakedFiduHolders.length; ++i) {
        const fiduBalance = await stakingRewards.stakedBalanceOf(stakedFiduHolders[i]!.stakingRewardsTokenId)
        await impersonateAccount(hre, stakedFiduHolders[i]!.address)
        await stakingRewards.unstake(stakedFiduHolders[i]!.stakingRewardsTokenId, fiduBalance, {
          from: stakedFiduHolders[i]!.address,
        })
        await fidu.approve(seniorPool.address, fiduBalance, {from: stakedFiduHolders[i]!.address})
        await expectAction(() =>
          seniorPool.requestWithdrawal(fiduBalance, {from: stakedFiduHolders[i]!.address})
        ).toChange([
          [() => fidu.balanceOf(stakedFiduHolders[i]!.address), {by: fiduBalance.neg()}],
          [() => fidu.balanceOf(seniorPool.address), {by: fiduBalance}],
        ])

        fiduRequestedByEpoch[0] = fiduRequestedByEpoch[0]!.add(fiduBalance)
      }

      expectedFiduLiquidatedByEpoch.push(getNumShares(usdcAvailable, await seniorPool.sharePrice()))
      expectedUsdcAllocatedByEpoch.push(usdcAvailable)
      withdrawalRequestsByEpoch.push([])
      for (let i = 0; i < stakedFiduHolders.length; ++i) {
        withdrawalRequestsByEpoch[0].push(
          await seniorPool.withdrawalRequest(i + latestMainnetWithdrawalRequestIndex + 1)
        )
      }

      // Stratos repayment  (also advances time to payment due date)
      await repayPool(0, owner)

      // IN EPOCH 2
      // console.log(`Should be in epoch 2`)
      // console.log(`currentEpoch: ${JSON.stringify(await seniorPool.currentEpoch())}`)
      usdcAvailable = await redeemPool(613)
      fiduRequestedByEpoch.push(fiduRequestedByEpoch[0]!.sub(expectedFiduLiquidatedByEpoch[0]!))
      expectedFiduLiquidatedByEpoch.push(getNumShares(usdcAvailable, await seniorPool.sharePrice()))
      expectedUsdcAllocatedByEpoch.push(usdcAvailable)
      withdrawalRequestsByEpoch.push([])
      for (let i = 0; i < stakedFiduHolders.length; ++i) {
        withdrawalRequestsByEpoch[1].push(
          await seniorPool.withdrawalRequest(i + latestMainnetWithdrawalRequestIndex + 1)
        )
      }

      // Addem Repayment (also advances time to payment due date)
      await repayPool(1, owner)
      await advanceAndMineBlock({days: 14})

      // IN EPOCH 3
      // console.log(`Should be in epoch 3`)
      // console.log(`currentEpoch: ${JSON.stringify(await seniorPool.currentEpoch())}`)
      fiduRequestedByEpoch.push(fiduRequestedByEpoch[1]!.sub(expectedFiduLiquidatedByEpoch[1]!))

      const depositAmount = usdcFromShares(fiduRequestedByEpoch[2]!, await seniorPool.sharePrice())
      await fundWithWhales(["USDC"], [owner.address], depositAmount.div(new BN(10 ** 6)).toNumber())
      await usdc.approve(seniorPool.address, depositAmount, {from: owner.address})
      await seniorPool.deposit(depositAmount, {
        from: owner.address,
      })

      // Full liquidation - liquidate fiduRequested instead of usdcAvailable
      expectedFiduLiquidatedByEpoch.push(fiduRequestedByEpoch[2]!)
      expectedUsdcAllocatedByEpoch.push(usdcFromShares(fiduRequestedByEpoch[2]!, await seniorPool.sharePrice()))
      withdrawalRequestsByEpoch.push([])
      for (let i = 0; i < stakedFiduHolders.length; ++i) {
        withdrawalRequestsByEpoch[2].push(
          await seniorPool.withdrawalRequest(i + latestMainnetWithdrawalRequestIndex + 1)
        )
      }

      // Advance to Epoch 4
      await advanceAndMineBlock({days: 14})

      // IN EPOCH 4
      // console.log(`Should be in epoch 4`)
      // console.log(`currentEpoch: ${JSON.stringify(await seniorPool.currentEpoch())}`)

      // Full liquidation
      expectedFiduLiquidatedByEpoch.push(ZERO)
      expectedUsdcAllocatedByEpoch.push(ZERO)
      fiduRequestedByEpoch.push(fiduRequestedByEpoch[2]!.sub(expectedFiduLiquidatedByEpoch[2]!))
      withdrawalRequestsByEpoch.push([])
      for (let i = 0; i < stakedFiduHolders.length; ++i) {
        withdrawalRequestsByEpoch[3].push(
          await seniorPool.withdrawalRequest(i + latestMainnetWithdrawalRequestIndex + 1)
        )
      }

      // Verify that the request after each epoch had the correct usdc withdrawable and fidu requested
      const cumulativeUsdcWithdrawableByRequest: BN[] = []
      const cumulativeFiduLiquidatedByRequest: BN[] = []
      for (let i = 0; i < stakedFiduHolders.length; ++i) {
        cumulativeUsdcWithdrawableByRequest.push(ZERO)
        cumulativeFiduLiquidatedByRequest.push(ZERO)
      }
      for (let epoch = 0; epoch < 3; ++epoch) {
        for (let requestId = 0; requestId < stakedFiduHolders.length; ++requestId) {
          const requestBeforeLiquidation = withdrawalRequestsByEpoch[epoch][requestId]!
          const requestAfterLiquidation = withdrawalRequestsByEpoch[epoch + 1][requestId]!

          const proRataUsdc = new BN(expectedUsdcAllocatedByEpoch[epoch]!)
            .mul(new BN(requestBeforeLiquidation.fiduRequested))
            .div(new BN(fiduRequestedByEpoch[epoch]!))

          const fiduLiquidated = new BN(expectedFiduLiquidatedByEpoch[epoch]!)
            .mul(new BN(requestBeforeLiquidation.fiduRequested))
            .div(new BN(fiduRequestedByEpoch[epoch]!))

          const expectedUsdcWithdrawable = cumulativeUsdcWithdrawableByRequest[requestId]!.add(proRataUsdc)
          expect(requestAfterLiquidation.usdcWithdrawable).to.bignumber.eq(expectedUsdcWithdrawable)

          const expectedFiduRequested = new BN(withdrawalRequestsByEpoch[0][requestId].fiduRequested)
            .sub(cumulativeFiduLiquidatedByRequest[requestId]!)
            .sub(fiduLiquidated)

          // Compare the usdc equivalent of fiduRequested because there could be some dust leftover
          expect(
            usdcFromShares(new BN(requestAfterLiquidation.fiduRequested), await seniorPool.sharePrice())
          ).to.bignumber.eq(usdcFromShares(new BN(expectedFiduRequested), await seniorPool.sharePrice()))

          cumulativeUsdcWithdrawableByRequest[requestId] =
            cumulativeUsdcWithdrawableByRequest[requestId]!.add(proRataUsdc)
          cumulativeFiduLiquidatedByRequest[requestId] =
            cumulativeFiduLiquidatedByRequest[requestId]!.add(fiduLiquidated)
        }
      }

      // Verify claim sends udsc to all the right places
      for (let requestId = 0; requestId < stakedFiduHolders.length; ++requestId) {
        const request = withdrawalRequestsByEpoch[3][requestId]
        const userUsdc = amountLessProtocolFee(new BN(request.usdcWithdrawable))
        const reserveUsdc = protocolFee(new BN(request.usdcWithdrawable))

        await expectAction(() =>
          seniorPool.claimWithdrawalRequest(requestId + latestMainnetWithdrawalRequestIndex + 1, {
            from: stakedFiduHolders[requestId]!.address,
          })
        ).toChange([
          [() => usdc.balanceOf(stakedFiduHolders[requestId]!.address), {byCloseTo: userUsdc, threshold: HALF_CENT}],
          [() => usdc.balanceOf(reserveAddress), {by: reserveUsdc}],
          [
            () => usdc.balanceOf(seniorPool.address),
            {byCloseTo: userUsdc.add(reserveUsdc).neg(), threshold: HALF_CENT},
          ],
        ])

        expect(
          (await requestTokens.balanceOf(stakedFiduHolders[requestId]!.address)).eq(new BN("0")) ||
            (
              await seniorPool.withdrawalRequest(requestId + latestMainnetWithdrawalRequestIndex + 1)
            ).usdcWithdrawable.eq(new BN("0"))
        ).to.be.true
      }
    })

    it("takes cancelation fees according to SeniorPoolWithdrawalCancelationFeeInBps", async () => {
      const fiduHolder = stakedFiduHolders[1]!
      await impersonateAccount(hre, fiduHolder.address)
      await stakingRewards.unstake(fiduHolder.stakingRewardsTokenId, fiduVal(10_000), {from: fiduHolder.address})
      await fidu.approve(seniorPool.address, fiduVal(10_000), {from: fiduHolder.address})
      await seniorPool.requestWithdrawal(fiduVal(10_000), {from: fiduHolder.address})

      const cancelationFeeInBps = await goldfinchConfig.getNumber(CONFIG_KEYS.SeniorPoolWithdrawalCancelationFeeInBps)
      const expectedCancelationFee = fiduVal(10_000).mul(cancelationFeeInBps).div(new BN(10_000))
      const expectedFiduReturnedToUser = fiduVal(10_000).sub(expectedCancelationFee)

      const protocolAdminAddress = await goldfinchConfig.getAddress(CONFIG_KEYS.ProtocolAdmin)

      const totalSupply = await requestTokens._tokenIdTracker()

      await expectAction(() => seniorPool.cancelWithdrawalRequest(totalSupply, {from: fiduHolder.address})).toChange([
        [() => fidu.balanceOf(fiduHolder.address), {by: expectedFiduReturnedToUser}],
        [() => fidu.balanceOf(protocolAdminAddress), {by: expectedCancelationFee}],
        [() => fidu.balanceOf(seniorPool.address), {by: fiduVal(10_000).neg()}],
      ])
    })
  })

  describe("poolToken splitting", () => {
    /**
     * The stratos test simualates progressing through the loan, having the token holder withdrawing some rewards
     * partway through, and then finally at the end of the loan asserting that interest redeemed, principal redeemed,
     * and total claimable backer rewards are what we would expect
     */
    describe("stratos", () => {
      const stratosPoolAddress = "0x00c27fc71b159a346e179b4a1608a0865e8a7470"
      const tokenId = 536 // This is a pool token belonging to the Stratos Pool
      let tokenOwner: string
      let tranchedPool: TranchedPoolInstance
      let creditLine: CreditLineInstance
      let tokenInfoBeforePayment
      beforeEach(async () => {
        tokenOwner = await poolTokens.ownerOf(tokenId)
        tranchedPool = await getTruffleContractAtAddress<TranchedPoolInstance>("TranchedPool", stratosPoolAddress)
        creditLine = await getTruffleContractAtAddress<CreditLineInstance>(
          "CreditLine",
          await tranchedPool.creditLine()
        )

        await fundWithWhales(["USDC"], [stratosEoa], 10_000_000)

        // At the current blockNum, tokenOwner hasn't claimed any rewards. We want a test where they have non-zero
        // rewardsClaimed at token split, so we'll withdraw all their claimable rewards up to now (they will accrue)
        // more claimable rewards after payment time

        await hre.network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [stratosEoa],
        })
        await tranchedPool.assess()
        let interestOwed = await creditLine.interestOwed()
        if (!interestOwed.isZero()) {
          // Need to make payment first. We can't claim rewards if the pool is late on payments...

          await usdc.approve(tranchedPool.address, interestOwed, {from: stratosEoa})
          await tranchedPool.pay(interestOwed, {from: stratosEoa})
        }

        await hre.network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [tokenOwner],
        })
        await backerRewards.withdraw(tokenId, {from: tokenOwner})

        await advanceTime({toSecond: (await creditLine.termEndTime()).sub(SECONDS_PER_DAY.mul(new BN(30)))})
        await tranchedPool.assess()
        await hre.network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [stratosEoa],
        })
        interestOwed = await creditLine.interestOwed()
        await usdc.approve(tranchedPool.address, interestOwed, {from: stratosEoa})
        tokenInfoBeforePayment = await poolTokens.getTokenInfo(tokenId) // do not DELETE! needed to calculate expectedRedeemableInterest
        await tranchedPool.pay(interestOwed, {from: stratosEoa})
      })

      it("doesn't change interest and principal redeemed/redeemable", async () => {
        await hre.network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [tokenOwner],
        })

        // These are the values we expect to be able to redeem with the original pool token
        // after stratos's next repayment. They are computed by uncommenting the code snippet
        // below and reading the console output

        // await tranchedPool.withdrawMax(tokenId, {from: tokenOwner})
        // const tokenInfoAfterPaymentAndWithdrawal = await poolTokens.getTokenInfo(tokenId)

        // const interestRedeemed = new BN(tokenInfoAfterPaymentAndWithdrawal.interestRedeemed)
        //   .sub(new BN(tokenInfoBeforePayment.interestRedeemed))
        // const principalRedeemed = new BN(tokenInfoAfterPaymentAndWithdrawal.principalRedeemed)
        //   .sub(new BN(tokenInfoBeforePayment.principalRedeemed))

        // console.log(`interestRedeemed ${interestRedeemed}`)
        // console.log(`principalRedeemed ${principalRedeemed}`)
        const expectedRedeemableInterest = new BN(597978187)
        const expectedRedeemablePrincipal = new BN(8744)

        const principalAmount = new BN(tokenInfoBeforePayment.principalAmount)
        const amount1 = principalAmount.div(new BN(4))

        const tx = await poolTokens.splitToken(tokenId, amount1, {from: tokenOwner})
        const logs = decodeLogs<TokenMinted>(tx.receipt.rawLogs, poolTokens, "TokenMinted")
        const [newTokenId1, newTokenId2] = logs.map((log) => log.args.tokenId)
        assertNonNullable(newTokenId1)
        assertNonNullable(newTokenId2)

        const newTokenInfo1BeforeWithdraw = await poolTokens.getTokenInfo(newTokenId1)
        const newTokenInfo2BeforeWithdraw = await poolTokens.getTokenInfo(newTokenId2)

        // The sum of interest redeemed in the split tokens should match the interest redeemed on
        // the original token
        expect(
          new BN(newTokenInfo1BeforeWithdraw.interestRedeemed).add(new BN(newTokenInfo2BeforeWithdraw.interestRedeemed))
        ).to.bignumber.eq(tokenInfoBeforePayment.interestRedeemed)
        // The sum of principal redeemed in the split tokens should match the principal redeemed on
        // the original token
        expect(
          new BN(newTokenInfo1BeforeWithdraw.principalRedeemed).add(
            new BN(newTokenInfo2BeforeWithdraw.principalRedeemed)
          )
        ).to.bignumber.eq(tokenInfoBeforePayment.principalRedeemed)

        await tranchedPool.withdrawMax(newTokenId1, {from: tokenOwner})
        await tranchedPool.withdrawMax(newTokenId2, {from: tokenOwner})

        const newTokenInfo1AfterWithdraw = await poolTokens.getTokenInfo(newTokenId1)
        const newTokenInfo2AfterWithdraw = await poolTokens.getTokenInfo(newTokenId2)

        // The sum of interest redeemable on the split tokens should match what the tokenOwner would
        // have been able to redeem with the original token (but it might be a little less due to rounding
        // in integer division)
        const token1InterestRedeemed = new BN(newTokenInfo1AfterWithdraw.interestRedeemed).sub(
          new BN(newTokenInfo1BeforeWithdraw.interestRedeemed)
        )
        const token2InterestRedeemed = new BN(newTokenInfo2AfterWithdraw.interestRedeemed).sub(
          new BN(newTokenInfo2BeforeWithdraw.interestRedeemed)
        )
        expect(token1InterestRedeemed.add(token2InterestRedeemed)).to.bignumber.closeTo(expectedRedeemableInterest, "1")

        // The sum of principal redeemable on the split tokens should match what the tokenOwner would
        // have been able to redeem with the original token (but it might be a little less due to rounding
        // in integer division)
        const token1PrincipalRedeemed = new BN(newTokenInfo1AfterWithdraw.principalRedeemed).sub(
          new BN(newTokenInfo1BeforeWithdraw.principalRedeemed)
        )
        const token2PrincipalRedeemed = new BN(newTokenInfo2AfterWithdraw.principalRedeemed).sub(
          new BN(newTokenInfo2BeforeWithdraw.principalRedeemed)
        )
        expect(token1PrincipalRedeemed.add(token2PrincipalRedeemed)).to.bignumber.closeTo(
          expectedRedeemablePrincipal,
          "1"
        )
      })

      it("doesn't change rewardsClaimed or rewardsClaimable", async () => {
        const rewardsClaimed = new BN((await backerRewards.getTokenInfo(tokenId)).rewardsClaimed)
        const rewardsClaimable = new BN(await backerRewards.poolTokenClaimableRewards(tokenId))

        await hre.network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [tokenOwner],
        })

        const principalAmount = new BN(tokenInfoBeforePayment.principalAmount)
        const amount1 = principalAmount.div(new BN(4))
        const tx = await poolTokens.splitToken(tokenId, amount1, {from: tokenOwner})
        const logs = decodeLogs<TokenMinted>(tx.receipt.rawLogs, poolTokens, "TokenMinted")
        const [newTokenId1, newTokenId2] = logs.map((log) => log.args.tokenId)
        assertNonNullable(newTokenId1)
        assertNonNullable(newTokenId2)

        // The sum of the split tokens' claimable rewards should be the claimable rewards of the original
        const claimableRewards1 = new BN(await backerRewards.poolTokenClaimableRewards(newTokenId1))
        const claimableRewards2 = new BN(await backerRewards.poolTokenClaimableRewards(newTokenId2))
        expect(claimableRewards1.add(claimableRewards2)).to.bignumber.eq(rewardsClaimable)

        // The sum of the split tokens' claimed rewards should be the claimed rewards of the original
        const claimedRewards1 = new BN((await backerRewards.getTokenInfo(newTokenId1)).rewardsClaimed)
        const claimedRewards2 = new BN((await backerRewards.getTokenInfo(newTokenId2)).rewardsClaimed)
        expect(claimedRewards1.add(claimedRewards2)).to.bignumber.eq(rewardsClaimed)
      })
    })
  })

  // Regression test for senior pool writedown bug fix
  // https://bugs.immunefi.com/dashboard/submission/10342
  describe("writedowns", () => {
    it("doesn't tank the share price when a loan reaches maturity", async () => {
      // Get stratos borrower contract
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [stratosEoa],
      })
      await fundWithWhales(["USDC"], [stratosEoa], 10_000_000)
      const stratosSigner = await ethers.getSigner(stratosEoa)
      const stratosBrwContract = await (
        await getEthersContract<EthersBorrower>("Borrower", {at: "0xf8C4A0fEDf9b249253D89203034374E5A57b617C"})
      ).connect(stratosSigner)
      await erc20Approve(usdc, stratosBrwContract.address, usdcVal(10_000_000), [stratosEoa])
      const stratosPool = await getEthersContract<TranchedPool>("TranchedPool", {
        at: "0x00c27FC71b159a346e179b4A1608a0865e8A7470",
      })
      const stratosCl = await getEthersContract<CreditLine>("CreditLine", {at: await stratosPool.creditLine()})

      while (!(await stratosCl.nextDueTime()).eq(await stratosCl.termEndTime())) {
        const nextDueTime = await stratosCl.nextDueTime()
        if (new BN(nextDueTime.toString()).gt(new BN((await getCurrentTimestamp()).toString()))) {
          await advanceTime({toSecond: nextDueTime.toString()})
        }

        await stratosPool.assess()
        const interestOwed = await stratosCl.interestOwed()
        await stratosBrwContract.pay(stratosPool.address, interestOwed)
      }

      const sharePriceBefore = await seniorPool.sharePrice()
      await advanceTime({toSecond: (await stratosCl.termEndTime()).toString()})
      await stratosPool.assess()
      await seniorPool.writedown(613)
      const sharePriceAfter = await seniorPool.sharePrice()

      // The bug caused the share price to tank when calling writedown after termEndTime
      // The expectation is that share price is unchanged.
      expect(sharePriceBefore).to.bignumber.eq(sharePriceAfter)
    })
  })

  describe("drawing down into another currency", async function () {
    let bwrCon: BorrowerInstance, oneSplit
    beforeEach(async () => {
      this.timeout(TEST_TIMEOUT)
      oneSplit = await IOneSplit.at(MAINNET_ONE_SPLIT_ADDRESS)
      bwrCon = await createBorrowerContract()
      ;({tranchedPool} = await createPoolWithCreditLine({
        people: {owner: MAINNET_GOVERNANCE_MULTISIG, borrower: bwrCon.address},
        goldfinchFactory,
        usdc,
      }))
      await initializeTranchedPool(tranchedPool, bwrCon)
    })

    it("should let you drawdown to tether", async function () {
      const usdcAmount = usdcVal(10)
      const expectedReturn = await oneSplit.getExpectedReturn(usdc.address, usdt.address, usdcAmount, 10, 0, {
        from: bwr,
      })
      await expectAction(() => {
        return bwrCon.drawdownWithSwapOnOneInch(
          tranchedPool.address,
          usdcAmount,
          person3,
          usdt.address,
          expectedReturn.returnAmount.mul(new BN(99)).div(new BN(100)),
          expectedReturn.distribution,
          {from: bwr}
        )
      }).toChange([
        [async () => await getBalance(tranchedPool.address, usdc), {by: usdcAmount.neg()}],
        [async () => await getBalance(bwrCon.address, usdt), {by: new BN(0)}],
        [async () => await getBalance(person3, usdt), {byCloseTo: expectedReturn.returnAmount}],
        [async () => await getBalance(bwr, usdt), {by: new BN(0)}],
      ])
    }).timeout(TEST_TIMEOUT)

    describe("address forwarding", async () => {
      it("should support forwarding the money to another address", async () => {
        const usdcAmount = usdcVal(10)
        const expectedReturn = await oneSplit.getExpectedReturn(usdc.address, usdt.address, usdcAmount, 10, 0, {
          from: bwr,
        })
        await expectAction(() => {
          return bwrCon.drawdownWithSwapOnOneInch(
            tranchedPool.address,
            usdcAmount,
            person3,
            usdt.address,
            expectedReturn.returnAmount.mul(new BN(99)).div(new BN(100)),
            expectedReturn.distribution,
            {from: bwr}
          )
        }).toChange([
          [async () => await getBalance(tranchedPool.address, usdc), {by: usdcAmount.neg()}],
          [async () => await getBalance(person3, usdt), {byCloseTo: expectedReturn.returnAmount}],
          [async () => await getBalance(bwr, usdt), {by: new BN(0)}],
          [async () => await getBalance(bwrCon.address, usdt), {by: new BN(0)}],
        ])
      }).timeout(TEST_TIMEOUT)

      context("addressToSendTo is the contract address", async () => {
        it("should default to msg.sender", async function () {
          const usdcAmount = usdcVal(10)
          const expectedReturn = await oneSplit.getExpectedReturn(usdc.address, usdt.address, usdcAmount, 10, 0, {
            from: bwr,
          })
          await expectAction(() => {
            return bwrCon.drawdownWithSwapOnOneInch(
              tranchedPool.address,
              usdcAmount,
              bwrCon.address,
              usdt.address,
              expectedReturn.returnAmount.mul(new BN(99)).div(new BN(100)),
              expectedReturn.distribution,
              {from: bwr}
            )
          }).toChange([
            [async () => await getBalance(tranchedPool.address, usdc), {by: usdcAmount.neg()}],
            [async () => await getBalance(bwr, usdt), {byCloseTo: expectedReturn.returnAmount}],
            [async () => await getBalance(bwrCon.address, usdt), {by: new BN(0)}],
          ])
        }).timeout(TEST_TIMEOUT)
      })

      context("addressToSendTo is the zero address", async () => {
        it("should default to msg.sender", async () => {
          const usdcAmount = usdcVal(10)
          const expectedReturn = await oneSplit.getExpectedReturn(usdc.address, usdt.address, usdcAmount, 10, 0, {
            from: bwr,
          })
          await expectAction(() => {
            return bwrCon.drawdownWithSwapOnOneInch(
              tranchedPool.address,
              usdcAmount,
              ZERO_ADDRESS,
              usdt.address,
              expectedReturn.returnAmount.mul(new BN(99)).div(new BN(100)),
              expectedReturn.distribution,
              {from: bwr}
            )
          }).toChange([
            [async () => await getBalance(tranchedPool.address, usdc), {by: usdcAmount.neg()}],
            [async () => await getBalance(bwr, usdt), {byCloseTo: expectedReturn.returnAmount}],
            [async () => await getBalance(bwrCon.address, usdt), {by: new BN(0)}],
          ])
        }).timeout(TEST_TIMEOUT)
      })
    })

    it("should let you drawdown to BUSD", async function () {
      const usdcAmount = usdcVal(10)
      const expectedReturn = await oneSplit.getExpectedReturn(usdc.address, busd.address, usdcAmount, 10, 0, {
        from: bwr,
      })
      await expectAction(() => {
        return bwrCon.drawdownWithSwapOnOneInch(
          tranchedPool.address,
          usdcAmount,
          person3,
          busd.address,
          expectedReturn.returnAmount.mul(new BN(99)).div(new BN(100)),
          expectedReturn.distribution,
          {from: bwr}
        )
      }).toChange([
        [async () => await getBalance(tranchedPool.address, usdc), {by: usdcAmount.neg()}],
        [async () => await getBalance(person3, busd), {byCloseTo: expectedReturn.returnAmount}],
        [async () => await getBalance(bwr, busd), {by: new BN(0)}],
        [async () => await getBalance(bwrCon.address, busd), {by: new BN(0)}],
      ])
    }).timeout(TEST_TIMEOUT)
  })

  describe("paying back via another currency", async function () {
    let bwrCon, cl, oneSplit
    const amount = usdcVal(100)
    beforeEach(async function () {
      this.timeout(TEST_TIMEOUT)
      oneSplit = await IOneSplit.at(MAINNET_ONE_SPLIT_ADDRESS)
      bwrCon = await createBorrowerContract()
      ;({tranchedPool, creditLine: cl} = await createPoolWithCreditLine({
        people: {owner: MAINNET_GOVERNANCE_MULTISIG, borrower: bwrCon.address},
        goldfinchFactory,
        usdc,
      }))

      await initializeTranchedPool(tranchedPool, bwrCon)
      await bwrCon.drawdown(tranchedPool.address, amount, bwr, {from: bwr})
    })

    it("should allow you to pay with another currency", async () => {
      // USDT has the same decimals as USDC, so USDC val is fine here.
      const rawAmount = 10
      const usdtAmount = usdcVal(rawAmount)
      const expectedReturn = await oneSplit.getExpectedReturn(usdt.address, usdc.address, usdtAmount, 10, 0, {
        from: bwr,
      })
      await expectAction(() => {
        return bwrCon.payWithSwapOnOneInch(
          tranchedPool.address,
          usdtAmount,
          usdt.address,
          expectedReturn.returnAmount.mul(new BN(99)).div(new BN(100)),
          expectedReturn.distribution,
          {from: bwr}
        )
      }).toChange([
        [async () => await getBalance(bwr, usdt), {by: usdtAmount.neg()}],
        [async () => await getBalance(cl.address, usdc), {byCloseTo: expectedReturn.returnAmount}],
      ])
      await advanceTime({toSecond: (await cl.nextDueTime()).add(new BN(1))})
      await expectAction(() => tranchedPool.assess()).toChange([
        [async () => await cl.balance(), {decrease: true}],
        [async () => await getBalance(cl.address, usdc), {to: new BN(0)}],
      ])
    }).timeout(TEST_TIMEOUT)

    it("Works with BUSD", async () => {
      const rawAmount = 10
      const busdAmount = bigVal(rawAmount)
      const expectedReturn = await oneSplit.getExpectedReturn(busd.address, usdc.address, busdAmount, 10, 0, {
        from: bwr,
      })
      await expectAction(() => {
        return bwrCon.payWithSwapOnOneInch(
          tranchedPool.address,
          busdAmount,
          busd.address,
          expectedReturn.returnAmount.mul(new BN(99)).div(new BN(100)),
          expectedReturn.distribution,
          {from: bwr}
        )
      }).toChange([
        [async () => await getBalance(bwr, busd), {by: busdAmount.neg()}],
        [async () => await getBalance(cl.address, usdc), {byCloseTo: expectedReturn.returnAmount}],
      ])
      await advanceTime({toSecond: (await cl.nextDueTime()).add(new BN(1))})
      await expectAction(() => tranchedPool.assess()).toChange([
        [async () => await cl.balance(), {decrease: true}],
        [async () => await getBalance(cl.address, usdc), {to: new BN(0)}],
      ])
    }).timeout(TEST_TIMEOUT)

    describe("payMultipleWithSwapOnOneInch", async () => {
      let tranchedPool2, cl2
      const amount2 = usdcVal(50)

      beforeEach(async function () {
        this.timeout(TEST_TIMEOUT)
        ;({tranchedPool: tranchedPool2, creditLine: cl2} = await createPoolWithCreditLine({
          people: {owner: MAINNET_GOVERNANCE_MULTISIG, borrower: bwrCon.address},
          goldfinchFactory,
          usdc,
        }))

        expect(cl.address).to.not.eq(cl2.addresss)
        expect(tranchedPool.address).to.not.eq(tranchedPool2.addresss)

        await initializeTranchedPool(tranchedPool2, bwrCon)
        await bwrCon.drawdown(tranchedPool2.address, amount2, bwr, {from: bwr})
      })

      it("should pay back multiple loans", async () => {
        const padding = usdcVal(50)
        const originAmount = amount.add(amount2).add(padding)
        const expectedReturn = await oneSplit.getExpectedReturn(usdt.address, usdc.address, originAmount, 10, 0, {
          from: bwr,
        })
        const totalMinAmount = amount.add(amount2)
        const expectedExtra = expectedReturn.returnAmount.sub(totalMinAmount)

        await advanceTime({toSecond: (await cl.nextDueTime()).add(new BN(1))})
        await tranchedPool.assess()

        await expectAction(() =>
          bwrCon.payMultipleWithSwapOnOneInch(
            [tranchedPool.address, tranchedPool2.address],
            [amount, amount2],
            originAmount,
            usdt.address,
            expectedReturn.distribution,
            {from: bwr}
          )
        ).toChange([
          // CreditLine should be paid down by `amount`
          [async () => (await cl.balance()).add(await cl.interestOwed()), {by: amount.neg()}],
          // Excess USDC from swap should be added to the first CreditLine's contract balance
          // rather than applied as payment
          [() => getBalance(cl.address, usdc), {byCloseTo: expectedExtra}],
          [() => getBalance(cl2.address, usdc), {by: amount2}],
          [() => getBalance(bwr, usdt), {by: originAmount.neg()}],
        ])
        expect(await getBalance(bwrCon.address, usdc)).to.bignumber.eq(new BN(0))
        expect(await getBalance(bwrCon.address, usdt)).to.bignumber.eq(new BN(0))
      }).timeout(TEST_TIMEOUT)
    })
  })

  describe("BackerRewards", () => {
    const poolToToken = {
      "0x538473c3a69da2b305cf11a40cf2f3904de8db5f": "909", // Cauris #4
      "0x89d7c618a4eef3065da8ad684859a547548e6169": "719", // Addem
      "0x759f097f3153f5d62ff1c2d82ba78b6350f223e3": "653", // Alma #7
      "0xb26b42dd5771689d0a7faeea32825ff9710b9c11": "640", // Lend East
      "0xd09a57127bc40d680be7cb061c2a6629fe71abef": "588", // Cauris #2
      "0x00c27fc71b159a346e179b4a1608a0865e8a7470": "564", // Stratos
      "0x418749e294cabce5a714efccc22a8aade6f9db57": "471", // Alma 6
    }

    it("does not allocate any backer staking rewards", async () => {
      // Move forward in time so that some interest is due
      await advanceAndMineBlock({days: 65})

      // whale mode activate
      const me = circleEoa
      await impersonateAccount(hre, me)

      for (const [poolAddress, poolTokenId] of Object.entries(poolToToken)) {
        const pool = await getTruffleContract<TranchedPoolInstance>("TranchedPool", {at: poolAddress})
        const creditLineAddress = await pool.creditLine()
        const creditLine = await getTruffleContract<CreditLineInstance>("CreditLine", {at: creditLineAddress})
        const tokenInfo = await poolTokens.getTokenInfo(poolTokenId)
        expect(tokenInfo.pool).to.eq(pool.address)
        const backerStakingRewardsAvailableForWithdrawBeforeRepayment =
          await backerRewards.stakingRewardsEarnedSinceLastWithdraw(poolTokenId)
        await pool.assess()
        const interestOwed = await creditLine.interestOwed()
        await usdc.approve(pool.address, interestOwed, {from: me})
        await pool.pay(interestOwed, {from: me})

        const backerStakingRewardsAvailableForWithdrawAfterRepayment =
          await backerRewards.stakingRewardsEarnedSinceLastWithdraw(poolTokenId)

        expect(backerStakingRewardsAvailableForWithdrawAfterRepayment).to.bignumber.eq(
          backerStakingRewardsAvailableForWithdrawBeforeRepayment
        )
      }
    })
  })

  describe("integration tests", async () => {
    let bwrCon: BorrowerInstance
    describe("as a not user on the go list and without a UID", async () => {
      let unGoListedUser: string

      beforeEach(async () => {
        const [, , , maybeUser] = await hre.getUnnamedAccounts()
        unGoListedUser = asNonNullable(maybeUser)
        ;({tranchedPool} = await createPoolWithCreditLine({
          people: {borrower: bwr, owner: MAINNET_GOVERNANCE_MULTISIG},
          usdc,
          goldfinchFactory,
        }))
        await fundWithWhales(["USDC"], [unGoListedUser])
        await erc20Approve(usdc, seniorPool.address, MAX_UINT, [unGoListedUser])
        await erc20Approve(usdc, tranchedPool.address, MAX_UINT, [unGoListedUser])
        await erc20Approve(usdc, stakingRewards.address, MAX_UINT, [unGoListedUser])
        await expect(go.go(unGoListedUser)).to.eventually.be.false
      })

      describe("when I deposit and subsequently withdraw into the senior pool", async () => {
        it("it reverts", async () => {
          await expect(seniorPool.deposit(usdcVal(10), {from: unGoListedUser})).to.be.rejected
          await expect(seniorPool.withdraw(usdcVal(10), {from: unGoListedUser})).to.be.rejected
        })
      })

      describe("when I deposit and subsequently withdraw from a tranched pool's junior tranche", async () => {
        it("it reverts", async () => {
          await expect(tranchedPool.deposit(TRANCHES.Junior, usdcVal(10), {from: unGoListedUser})).to.be.rejected
          await expect(tranchedPool.withdraw(new BN("0"), usdcVal(10), {from: unGoListedUser})).to.be.rejected
        })
      })

      describe("when I deposit and stake", async () => {
        it("it reverts", async () => {
          await expect(stakingRewards.depositAndStake(usdcVal(10), {from: unGoListedUser})).to.be.rejectedWith(/GL/i)
        })
      })
    })

    describe("as a user on the go list", async () => {
      let goListedUser: string

      beforeEach(async () => {
        const [, , , , maybeUser, maybeBorrower] = await hre.getUnnamedAccounts()
        goListedUser = asNonNullable(maybeUser)
        borrower = asNonNullable(maybeBorrower)
        ;({tranchedPool} = await createPoolWithCreditLine({
          people: {borrower, owner: MAINNET_GOVERNANCE_MULTISIG},
          usdc,
          goldfinchFactory,
        }))
        await fundWithWhales(["USDC"], [goListedUser])
        const goldfinchConfigWithGoListAddress = await go.legacyGoList()
        const goldfinchConfigWithGoList = await getTruffleContract<GoldfinchConfigInstance>("GoldfinchConfig", {
          at: goldfinchConfigWithGoListAddress,
        })
        await goldfinchConfigWithGoList.addToGoList(goListedUser)
        await erc20Approve(usdc, seniorPool.address, MAX_UINT, [goListedUser])
        await erc20Approve(usdc, tranchedPool.address, MAX_UINT, [goListedUser])
        await erc20Approve(usdc, stakingRewards.address, MAX_UINT, [goListedUser])
        await expect(go.go(goListedUser)).to.eventually.be.true
      })

      describe("when I deposit and subsequently withdraw from a tranched pool's junior tranche", async () => {
        it("it works", async () => {
          const tx = await expect(tranchedPool.deposit(TRANCHES.Junior, usdcVal(10), {from: goListedUser})).to.be
            .fulfilled
          const logs = decodeLogs<DepositMade>(tx.receipt.rawLogs, tranchedPool, "DepositMade")
          let depositMadeEvent = logs[0]
          expect(depositMadeEvent).to.not.be.undefined
          depositMadeEvent = asNonNullable(depositMadeEvent)
          const tokenId = depositMadeEvent.args.tokenId
          await expect(tranchedPool.withdraw(tokenId, usdcVal(10), {from: goListedUser})).to.be.fulfilled
        })
      })

      describe("when I deposit and stake and then exit", async () => {
        it("it works", async () => {
          const depositAmount = usdcVal(10_000)
          const tx = await expect(stakingRewards.depositAndStake(depositAmount, {from: goListedUser})).to.be.fulfilled
          const logs = decodeLogs<Staked>(tx.receipt.rawLogs, stakingRewards, "Staked")
          const stakedEvent = asNonNullable(logs[0])
          const tokenId = stakedEvent?.args.tokenId
          await expect(stakingRewards.unstake(tokenId, depositAmount, {from: goListedUser})).to.be.fulfilled
        })
      })

      describe("when I deposit and stake, and then zap to Curve", async () => {
        beforeEach(async () => {
          await erc20Approve(usdc, seniorPool.address, MAX_UINT, [owner])
          await erc20Approve(usdc, stakingRewards.address, MAX_UINT, [goListedUser, owner])
          await erc20Approve(usdc, zapper.address, MAX_UINT, [goListedUser])
          await erc20Approve(fidu, stakingRewards.address, MAX_UINT, [goListedUser, owner])

          // Seed the Curve pool with funds
          await erc20Approve(usdc, curvePool.address, MAX_UINT, [owner])
          await erc20Approve(fidu, curvePool.address, MAX_UINT, [owner])
          await fundWithWhales(["USDC"], [owner])
          await seniorPool.deposit(usdcVal(100_000), {from: owner})
          await curvePool.add_liquidity([bigVal(10_000), usdcVal(10_000)], new BN(0), false, owner, {
            from: owner,
          })
        })

        context("for a FIDU only migration", async () => {
          it("it works", async () => {
            const curveFiduBalanceBefore = await curvePool.balances(0)
            const curveUSDCBalanceBefore = await curvePool.balances(1)

            // Deposit and stake
            const tx = await expect(stakingRewards.depositAndStake(usdcVal(10_000), {from: goListedUser})).to.be
              .fulfilled
            const stakedEvent = decodeAndGetFirstLog<Staked>(tx.receipt.rawLogs, stakingRewards, "Staked")
            const tokenId = stakedEvent.args.tokenId

            // Zap to curve
            await erc721Approve(stakingRewards, zapper.address, tokenId, [goListedUser])
            const zapperTx = await expect(
              zapper.zapStakeToCurve(tokenId, new BN(stakedEvent?.args.amount.toString(10)), new BN(0), {
                from: goListedUser,
              })
            ).to.be.fulfilled

            const unstakedLog = await decodeAndGetFirstLog<Unstaked>(
              zapperTx.receipt.rawLogs,
              stakingRewards,
              "Unstaked"
            )
            expect(unstakedLog.args.tokenId).to.bignumber.equal(tokenId)
            expect(unstakedLog.args.amount).to.bignumber.equal(new BN(stakedEvent.args.amount.toString(10)))

            const depositedToCurveAndStakeLog = await decodeAndGetFirstLog<DepositedToCurveAndStaked>(
              zapperTx.receipt.rawLogs,
              stakingRewards,
              "DepositedToCurveAndStaked"
            )
            expect(depositedToCurveAndStakeLog.args.fiduAmount).to.bignumber.equal(
              new BN(stakedEvent.args.amount.toString(10))
            )
            expect(depositedToCurveAndStakeLog.args.usdcAmount).to.bignumber.equal(new BN(0))

            const curveFiduBalanceAfter = await curvePool.balances(0)
            const curveUSDCBalanceAfter = await curvePool.balances(1)
            expect(curveFiduBalanceAfter.sub(curveFiduBalanceBefore)).to.bignumber.equal(
              depositedToCurveAndStakeLog.args.fiduAmount
            )
            expect(curveUSDCBalanceAfter.sub(curveUSDCBalanceBefore)).to.bignumber.equal(new BN(0))
          })
        })

        context("for a FIDU with USDC migration", async () => {
          it("it works", async () => {
            const curveFiduBalanceBefore = await curvePool.balances(0)
            const curveUSDCBalanceBefore = await curvePool.balances(1)
            await erc20Transfer(usdc, [goListedUser], usdcVal(1_000), owner)

            // Deposit and stake
            const tx = await expect(stakingRewards.depositAndStake(usdcVal(100), {from: goListedUser})).to.be.fulfilled
            const stakedEvent = decodeAndGetFirstLog<Staked>(tx.receipt.rawLogs, stakingRewards, "Staked")
            const tokenId = stakedEvent.args.tokenId

            // Zap to curve
            await erc721Approve(stakingRewards, zapper.address, tokenId, [goListedUser])
            const zapperTx = await expect(
              zapper.zapStakeToCurve(tokenId, new BN(stakedEvent?.args.amount.toString(10)), usdcVal(100), {
                from: goListedUser,
              })
            ).to.be.fulfilled

            const unstakedLog = await decodeAndGetFirstLog<Unstaked>(
              zapperTx.receipt.rawLogs,
              stakingRewards,
              "Unstaked"
            )
            expect(unstakedLog.args.tokenId).to.bignumber.equal(tokenId)
            expect(unstakedLog.args.amount).to.bignumber.equal(new BN(stakedEvent.args.amount.toString(10)))

            const depositedToCurveAndStakeLog = await decodeAndGetFirstLog<DepositedToCurveAndStaked>(
              zapperTx.receipt.rawLogs,
              stakingRewards,
              "DepositedToCurveAndStaked"
            )
            expect(depositedToCurveAndStakeLog.args.fiduAmount).to.bignumber.equal(
              new BN(stakedEvent.args.amount.toString(10))
            )
            expect(depositedToCurveAndStakeLog.args.usdcAmount).to.bignumber.equal(usdcVal(100))

            const curveFiduBalanceAfter = await curvePool.balances(0)
            const curveUSDCBalanceAfter = await curvePool.balances(1)
            expect(curveFiduBalanceAfter.sub(curveFiduBalanceBefore)).to.bignumber.equal(
              depositedToCurveAndStakeLog.args.fiduAmount
            )
            expect(curveUSDCBalanceAfter.sub(curveUSDCBalanceBefore)).to.bignumber.equal(
              depositedToCurveAndStakeLog.args.usdcAmount
            )
          })
        })
      })
    })

    describe("as a go listed borrower", async () => {
      describe("with a pool that I don't own", async () => {
        beforeEach(async () => {
          // eslint-disable-next-line @typescript-eslint/no-extra-semi
          ;({tranchedPool} = await createPoolWithCreditLine({
            people: {
              owner: MAINNET_GOVERNANCE_MULTISIG,
              borrower: person3,
            },
            usdc,
            goldfinchFactory,
          }))
          bwr = person3
          bwrCon = await createBorrowerContract()
          await erc20Approve(usdc, tranchedPool.address, MAX_UINT, [bwr, owner])
          await erc20Approve(usdc, bwrCon.address, MAX_UINT, [bwr, owner])
          await tranchedPool.deposit(TRANCHES.Junior, usdcVal(100), {from: owner})
          await tranchedPool.lockJuniorCapital({from: MAINNET_GOVERNANCE_MULTISIG})
          await tranchedPool.grantRole(await tranchedPool.SENIOR_ROLE(), owner, {from: MAINNET_GOVERNANCE_MULTISIG})
          await tranchedPool.deposit(TRANCHES.Senior, usdcVal(300), {from: owner})
          await tranchedPool.revokeRole(await tranchedPool.SENIOR_ROLE(), owner, {from: MAINNET_GOVERNANCE_MULTISIG})
          await tranchedPool.lockPool({from: MAINNET_GOVERNANCE_MULTISIG})
        })

        describe("when I try to withdraw", async () => {
          it("it fails", async () => {
            await expect(bwrCon.drawdown(tranchedPool.address, usdcVal(400), bwr, {from: bwr})).to.be.rejectedWith(
              /Must have locker role/i
            )
          })
        })
      })

      describe("with a pool that I own", async () => {
        let backerTokenId
        beforeEach(async () => {
          // eslint-disable-next-line @typescript-eslint/no-extra-semi
          ;({tranchedPool} = await createPoolWithCreditLine({
            people: {
              owner: MAINNET_GOVERNANCE_MULTISIG,
              borrower: bwr,
            },
            usdc,
            goldfinchFactory,
          }))
          await erc20Approve(usdc, tranchedPool.address, MAX_UINT, [bwr, owner])
          await erc20Approve(usdc, bwrCon.address, MAX_UINT, [bwr, owner])
          const tx = await tranchedPool.deposit(TRANCHES.Junior, usdcVal(2_500), {from: owner})
          const logs = decodeLogs<DepositMade>(tx.receipt.rawLogs, tranchedPool, "DepositMade")
          const depositMadeEvent = asNonNullable(logs[0])
          backerTokenId = depositMadeEvent.args.tokenId
          await tranchedPool.lockJuniorCapital({from: bwr})
          await tranchedPool.grantRole(await tranchedPool.SENIOR_ROLE(), owner, {from: MAINNET_GOVERNANCE_MULTISIG})
          await tranchedPool.deposit(TRANCHES.Senior, usdcVal(7_500), {from: owner})
          await tranchedPool.revokeRole(await tranchedPool.SENIOR_ROLE(), owner, {from: MAINNET_GOVERNANCE_MULTISIG})
          await tranchedPool.lockPool({from: bwr})
        })

        describe("if backerrewards contract is configured", () => {
          beforeEach(async () => {
            const totalRewards = 1_000
            const maxInterestDollarsEligible = 1_000_000_000
            const protocolOwner = await getProtocolOwner()
            await backerRewards.setMaxInterestDollarsEligible(bigVal(maxInterestDollarsEligible), {from: protocolOwner})
            await backerRewards.setTotalRewards(bigVal(Math.round(totalRewards * 100)).div(new BN(100)), {
              from: protocolOwner,
            })
            await backerRewards.setTotalInterestReceived(usdcVal(0), {from: protocolOwner})
          })

          it("properly allocates rewards", async () => {
            await expect(bwrCon.drawdown(tranchedPool.address, usdcVal(10_000), bwr, {from: bwr})).to.be.fulfilled
            await advanceTime({days: 90})
            await ethers.provider.send("evm_mine", [])
            await expect(bwrCon.pay(tranchedPool.address, usdcVal(10_000), {from: bwr})).to.be.fulfilled

            // verify accRewardsPerPrincipalDollar
            const accRewardsPerPrincipalDollar = await backerRewards.pools(tranchedPool.address)
            expect(accRewardsPerPrincipalDollar).to.bignumber.equal(new BN(0))

            // verify claimable rewards
            const expectedPoolTokenClaimableRewards = await backerRewards.poolTokenClaimableRewards(backerTokenId)
            expect(new BN(expectedPoolTokenClaimableRewards)).to.bignumber.equal(new BN(0))
          })
        })

        describe("if backerrewards contract is not configured", () => {
          describe("when I drawdown and pay back", async () => {
            it("it works", async () => {
              await expect(bwrCon.drawdown(tranchedPool.address, usdcVal(10_000), bwr, {from: bwr})).to.be.fulfilled
              await advanceTime({days: 90})
              await ethers.provider.send("evm_mine", [])
              await expect(bwrCon.pay(tranchedPool.address, usdcVal(10_000), {from: bwr})).to.be.fulfilled
              const rewards = await expect(backerRewards.poolTokenClaimableRewards(backerTokenId)).to.be.fulfilled
              // right now rewards rates aren't set, so no rewards should be claimable
              expect(rewards).to.bignumber.eq("0")
            })
          })
        })
      })
    })
  })

  describe("CommunityRewards", () => {
    describe("claimableRewards", () => {
      // no vesting to merkle direct distributor balance
      describe.skip("MerkleDistributor", () => {
        it("proper reward allocation for users claimable", async () => {
          const vestingGrantsJson: MerkleDistributorInfo = JSON.parse(
            await fs.readFile(VESTING_MERKLE_INFO_PATH, {
              encoding: "utf8",
            })
          )
          await advanceTime({toSecond: new BN(TOKEN_LAUNCH_TIME)})
          await ethers.provider.send("evm_mine", [])

          // randomly sample 50 grants
          const sampledGrants = _.sampleSize(vestingGrantsJson.grants, 50)
          for (const grant of sampledGrants) {
            const {
              index,
              proof,
              account: recipient,
              grant: {amount, vestingLength, cliffLength, vestingInterval},
            } = grant

            const rewardsAvailableBefore = await communityRewards.rewardsAvailable()
            const recipientBalanceBefore = await gfi.balanceOf(recipient)

            await impersonateAccount(hre, recipient)
            await fundWithWhales(["ETH"], [recipient])
            try {
              const receipt = await merkleDistributor.acceptGrant(
                index,
                amount,
                vestingLength,
                cliffLength,
                vestingInterval,
                proof,
                {from: recipient}
              )
              const grantedEvent = getOnlyLog<Granted>(decodeLogs(receipt.receipt.rawLogs, communityRewards, "Granted"))
              const tokenId = grantedEvent.args.tokenId

              // verify grant properties
              const grantState = await communityRewards.grants(tokenId)
              assertCommunityRewardsVestingRewards(grantState)
              expect(grantState.totalGranted).to.bignumber.equal(web3.utils.toBN(amount))
              expect(grantState.totalClaimed).to.bignumber.equal(new BN(0))
              expect(grantState.vestingInterval).to.bignumber.equal(web3.utils.toBN(vestingInterval))
              expect(grantState.cliffLength).to.bignumber.equal(web3.utils.toBN(cliffLength))

              // advance time to end of grant
              if ((await time.latest()).lt(new BN(TOKEN_LAUNCH_TIME).add(web3.utils.toBN(vestingLength)))) {
                await advanceTime({toSecond: new BN(TOKEN_LAUNCH_TIME).add(web3.utils.toBN(vestingLength))})
                await ethers.provider.send("evm_mine", [])
              }

              // verify fully vested claimable rewards
              const claimable = await communityRewards.claimableRewards(tokenId)
              expect(claimable).to.bignumber.equal(web3.utils.toBN(amount))

              // claim all awards
              await communityRewards.getReward(tokenId, {from: recipient})

              const rewardsAvailableAfter = await communityRewards.rewardsAvailable()
              expect(rewardsAvailableAfter).to.bignumber.equal(rewardsAvailableBefore.sub(claimable))

              const recipientBalanceAfter = await gfi.balanceOf(recipient)
              expect(recipientBalanceAfter).to.bignumber.equal(recipientBalanceBefore.add(claimable))
            } catch (e: any) {
              if (e instanceof Error && String(e).indexOf("Grant already accepted")) {
                console.log("Skipping grant, already accepted")
                continue
              }

              console.error(e)
            }
          }
        }).timeout(TEST_TIMEOUT)

        it("works for partial vesting periods", async () => {
          const vestingGrantsJson: MerkleDistributorInfo = JSON.parse(
            await fs.readFile(VESTING_MERKLE_INFO_PATH, {
              encoding: "utf8",
            })
          )

          const affectedAddresses = new Set([
            "0x3e4b143ec4aa78acb5c9f51b4955dc60f8268f14",
            "0x977c827a997e6cb67e70daeaa7145b17d0cb8bda",
            "0xc25d35024dd497d3825115828994bb08d12a3aa7",
            "0x61203f1a49a1df8da163647fb7fa0105e51f7341",
            "0xea93c16b2ed1cd73e6f9d5b5a92c36e504e8dc72",
            "0xd06ac243a362fe59bc336c918485d3fcc733fd1e",
            "0xb49ce783e7572ffe985c0eeced326b621201ffda",
            "0xba8a69673b6b3934c43998d1e18220b0154950e0",
            "0xcd84959ccf9cbd0abbc7e20e30c1c05bcbd2533e",
            "0x13e9b3ea5159ca4dccef9dc2907974027d663703",
            "0x7f1b17848969f0ea6f8814929cf2c14806b23e40",
            "0xfec5746990aeb84572d03def94dfb26ecbc4fe87",
          ])

          const affectedGrants = vestingGrantsJson.grants.filter((g) => affectedAddresses.has(g.account.toLowerCase()))

          for (const grant of affectedGrants) {
            const {
              index,
              proof,
              account: recipient,
              grant: {amount, vestingLength, cliffLength, vestingInterval},
            } = grant

            const rewardsAvailableBefore = await communityRewards.rewardsAvailable()
            const recipientBalanceBefore = await gfi.balanceOf(recipient)

            await impersonateAccount(hre, recipient)
            await fundWithWhales(["ETH"], [recipient])

            try {
              const receipt = await merkleDistributor.acceptGrant(
                index,
                amount,
                vestingLength,
                cliffLength,
                vestingInterval,
                proof,
                {from: recipient}
              )
              const grantedEvent = getOnlyLog<Granted>(decodeLogs(receipt.receipt.rawLogs, communityRewards, "Granted"))
              const tokenId = grantedEvent.args.tokenId

              // verify grant properties
              const grantState = await communityRewards.grants(tokenId)
              assertCommunityRewardsVestingRewards(grantState)
              expect(grantState.totalGranted).to.bignumber.equal(web3.utils.toBN(amount))
              expect(grantState.totalClaimed).to.bignumber.equal(new BN(0))

              if (web3.utils.toBN(vestingInterval).isZero()) {
                expect(grantState.vestingInterval).to.bignumber.equal(web3.utils.toBN(vestingLength))
              } else {
                expect(grantState.vestingInterval).to.bignumber.equal(web3.utils.toBN(vestingInterval))
              }

              expect(grantState.cliffLength).to.bignumber.equal(web3.utils.toBN(cliffLength))

              // advance time to end of grant
              if ((await time.latest()).lt(new BN(TOKEN_LAUNCH_TIME).add(web3.utils.toBN(vestingLength)))) {
                await advanceTime({toSecond: new BN(TOKEN_LAUNCH_TIME).add(web3.utils.toBN(vestingLength))})
                await ethers.provider.send("evm_mine", [])
              }

              // verify fully vested claimable rewards
              const claimable = await communityRewards.claimableRewards(tokenId)
              expect(claimable).to.bignumber.equal(web3.utils.toBN(amount))

              // claim all awards
              await communityRewards.getReward(tokenId, {from: recipient})

              const rewardsAvailableAfter = await communityRewards.rewardsAvailable()
              expect(rewardsAvailableAfter).to.bignumber.equal(rewardsAvailableBefore.sub(claimable))

              const recipientBalanceAfter = await gfi.balanceOf(recipient)
              expect(recipientBalanceAfter).to.bignumber.equal(recipientBalanceBefore.add(claimable))
            } catch (e: any) {
              if (e instanceof Error && String(e).indexOf("Grant already accepted")) {
                console.log("Skipping grant, already accepted")
                continue
              }

              console.error(e)
            }
          }
        }).timeout(TEST_TIMEOUT)
      })

      describe.skip("MerkleDirectDistributor", () => {
        it("proper reward allocation for users claimable", async () => {
          const noVestingGrantsJson: MerkleDirectDistributorInfo = JSON.parse(
            await fs.readFile(NO_VESTING_MERKLE_INFO_PATH, {
              encoding: "utf8",
            })
          )

          await advanceTime({toSecond: new BN(TOKEN_LAUNCH_TIME)})
          await ethers.provider.send("evm_mine", [])

          // randomly sample 50 grants
          const sampledGrants = _.sampleSize(noVestingGrantsJson.grants, 50)
          for (const grant of sampledGrants) {
            const {
              index,
              proof,
              account: recipient,
              grant: {amount},
            } = grant
            const recipientBalanceBefore = await gfi.balanceOf(recipient)

            await impersonateAccount(hre, recipient)
            await fundWithWhales(["ETH"], [recipient])

            try {
              await merkleDirectDistributor.acceptGrant(index, amount, proof, {from: recipient})

              const recipientBalanceAfter = await gfi.balanceOf(recipient)
              expect(recipientBalanceAfter).to.bignumber.equal(recipientBalanceBefore.add(web3.utils.toBN(amount)))
            } catch (e: any) {
              if (e instanceof Error && String(e).indexOf("Grant already accepted")) {
                console.log("Skipping grant, already accepted")
                continue
              }

              console.error(e)
            }
          }
        }).timeout(TEST_TIMEOUT)
      })
    })

    describe("StakingRewards", () => {
      it("deposits and stakes into senior pool, and can withdraw", async () => {
        const yearInSeconds = new BN(365 * 24 * 60 * 60)
        const halfYearInSeconds = yearInSeconds.div(new BN(2))
        const amount = usdcVal(1000)

        await usdc.approve(stakingRewards.address, amount, {from: owner})

        const receipt = await stakingRewards.depositAndStake(amount, {from: owner})
        const stakedEvent = getFirstLog<Staked>(decodeLogs(receipt.receipt.rawLogs, stakingRewards, "Staked"))
        const tokenId = stakedEvent.args.tokenId
        const depositedAndStakedEvent = getFirstLog<DepositedAndStaked>(
          decodeLogs(receipt.receipt.rawLogs, stakingRewards, "DepositedAndStaked")
        )
        expect(depositedAndStakedEvent.args.user).to.equal(stakedEvent.args.user)
        expect(depositedAndStakedEvent.args.depositedAmount).to.bignumber.equal(amount)
        expect(depositedAndStakedEvent.args.tokenId).to.equal(tokenId)
        expect(depositedAndStakedEvent.args.amount).to.bignumber.equal(stakedEvent.args.amount)

        // advance time to end of grant
        await advanceTime({seconds: halfYearInSeconds})
        await ethers.provider.send("evm_mine", [])

        const rewardReceipt = await stakingRewards.getReward(tokenId, {from: owner})
        const rewardEvent = getFirstLog<RewardPaid>(
          decodeLogs(rewardReceipt.receipt.rawLogs, stakingRewards, "RewardPaid")
        )
        const gfiBalance = await gfi.balanceOf(owner)
        expect(gfiBalance).to.bignumber.gt(new BN("0"))
        expect(gfiBalance).to.bignumber.equal(rewardEvent.args.reward)
      })

      it("does not affect reward calculations for a staked position created prior to GIP-1", async () => {
        // Use a known staked position created prior to GIP-1
        // Note: If this test starts failing, check that this position is still staked
        const tokenId = new BN(72)

        // The unsafeEffectiveMultiplier and unsafeBaseTokenExchangeRate should be 0
        const position = await stakingRewards.positions(tokenId)
        expect(position[5]).to.bignumber.equal(new BN(0))
        expect(position[6]).to.bignumber.equal(new BN(0))

        // The position's earnedSinceLastCheckpoint() should be non-zero, implying that the
        // 0 values for the position's `unsafeEffectiveMultiplier` and `unsafeBaseTokenExchangeRate`
        // are being handled safely and not adversely affecting the earning of additional rewards.
        expect(await stakingRewards.earnedSinceLastCheckpoint(tokenId)).to.bignumber.gt(new BN(0))
      })
    })
  })
})
