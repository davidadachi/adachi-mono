/* global web3 tenderly */
const hre = require("hardhat")
import {advanceTime, expect, expectAction, getBalance, toTruffle, usdcVal} from "../testHelpers"
import {isMainnetForking, getSignerForAddress, OWNER_ROLE, MINTER_ROLE, getContract, PAUSER_ROLE, GO_LISTER_ROLE, getUSDCAddress, MAINNET_CHAIN_ID} from "../../blockchain_scripts/deployHelpers"
const {deployments, artifacts, ethers} = hre
const {deployMigrator, givePermsToMigrator, deployAndMigrateToV2} = require("../../blockchain_scripts/v2/migrate")
const TEST_TIMEOUT = 180000 // 3 mins
import {fundWithWhales, getAllExistingContracts, impersonateAccount, MAINNET_MULTISIG, MAINNET_UNDERWRITER} from "../../blockchain_scripts/mainnetForkingHelpers"
import BN from "bn.js"
import _ from "lodash"
import {prepareMigration} from "../../blockchain_scripts/v2/migrate"
import { BorrowerInstance, CreditLineInstance, TranchedPoolInstance } from "../../typechain/truffle"

describe("Migrating to V2", () => {
  // Hack way to only run this suite when we actually want to.
  if (!isMainnetForking()) {
    return
  }

  const testSetup = deployments.createFixture(async ({deployments, getNamedAccounts}) => {
    // Note: base_deploy always returns when mainnet forking, however
    // we need it here, because the "fixture" part is what lets hardhat
    // snapshot and give us a clean blockchain before each test.
    // Otherwise, we have state leaking across tests.
    await deployments.fixture("base_deploy")
    const {gf_deployer} = await getNamedAccounts()
    mainnetContracts = await getAllExistingContracts()
    const config = mainnetContracts.GoldfinchConfig
    const pool = mainnetContracts.Pool
    const creditDesk = mainnetContracts.CreditDesk
    const goldfinchConfig = mainnetContracts.GoldfinchConfig
    const goldfinchFactory = mainnetContracts.GoldfinchFactory
    const fidu = mainnetContracts.Fidu

    let migrator = await deployMigrator(hre, {config})
    migrator = await toTruffle(migrator, "V2Migrator", {from: gf_deployer})
    return {migrator, pool, creditDesk, goldfinchConfig, goldfinchFactory, fidu}
  })

  let owner, migrator, accounts, mainnetContracts, mainnetMultisigSigner, bwr
  let pool, creditDesk, goldfinchFactory, goldfinchConfig, fidu, usdc

  beforeEach(async function () {
    this.timeout(TEST_TIMEOUT)
    // Pull in our unlocked accounts
    accounts = await web3.eth.getAccounts()
    ;[owner] = accounts

    ;({migrator, pool, creditDesk, goldfinchConfig, goldfinchFactory, fidu} = await testSetup())

    ;[owner, bwr] = await web3.eth.getAccounts()

    usdc = await getContract("IERC20withDec", {at: await getUSDCAddress(MAINNET_CHAIN_ID)})
    mainnetContracts = await getAllExistingContracts()
    mainnetMultisigSigner = await ethers.provider.getSigner(MAINNET_MULTISIG)

    // Ensure the multisig has funds for upgrades and other transactions
    let ownerAccount = await getSignerForAddress(owner)
    await ownerAccount!.sendTransaction({to: MAINNET_MULTISIG, value: ethers.utils.parseEther("5.0")})

    // Ensure mainnet underwriter has funds for transactions
    await ownerAccount!.sendTransaction({to: MAINNET_UNDERWRITER, value: ethers.utils.parseEther("5.0")})

    await impersonateAccount(hre, MAINNET_MULTISIG)
  })

  async function getProxyVersion(address) {
    return await artifacts.require("IMigrate").at(address)
  }

  async function assertNewClStillCalculatesInterestCorrectly(tranchedPool, newCl, expectedAmount) {
    await tranchedPool.assess()
    const afterNextDueTime = (await newCl.nextDueTime()).add(new BN(1))
    await advanceTime({toSecond: afterNextDueTime})
    await expectAction(() => tranchedPool.assess()).toChange([
      [() => newCl.totalInterestAccrued(), {by: new BN(expectedAmount)}], // A period's worth of interest
      [() => newCl.principalOwed(), {by: new BN(0)}],
    ])
  }

  type MigratedInfo = {
    tranchedPool: TranchedPoolInstance,
    newCl: CreditLineInstance,
    bwrCon: BorrowerInstance,
    owner: string,
  }
  async function getMigratedInfo(clAddress: string, migrationEvents) : Promise<MigratedInfo> {
    const event = _.find(migrationEvents, (e) => e.args.clToMigrate.toLowerCase() === clAddress.toLowerCase())
    const migrator = await getContract("V2Migrator")
    const bwrAddr = await migrator.borrowerContracts(event.args.owner)
    return {
      tranchedPool: await getContract("MigratedTranchedPool", {at: event.args.tranchedPool}),
      newCl: await getContract("CreditLine", {at: event.args.newCl}),
      bwrCon: await getContract("Borrower", {at: bwrAddr}),
      owner: event.args.owner,
    }
  }

  describe("givePermsToMigrator", async function () {
    it("should give all the perms to the migrator address", async () => {
      // Ensure we don't currently have the right perms

      expect(await fidu.hasRole(MINTER_ROLE, migrator.address)).to.equal(false)
      expect(await fidu.hasRole(OWNER_ROLE, migrator.address)).to.equal(false)
      expect(await fidu.hasRole(PAUSER_ROLE, migrator.address)).to.equal(false)

      expect(await creditDesk.hasRole(OWNER_ROLE, migrator.address)).to.equal(false)
      expect(await creditDesk.hasRole(PAUSER_ROLE, migrator.address)).to.equal(false)

      expect(await pool.hasRole(OWNER_ROLE, migrator.address)).to.equal(false)
      expect(await pool.hasRole(PAUSER_ROLE, migrator.address)).to.equal(false)

      expect(await goldfinchFactory.hasRole(OWNER_ROLE, migrator.address)).to.equal(false)
      expect(await goldfinchFactory.hasRole(PAUSER_ROLE, migrator.address)).to.equal(false)

      expect(await goldfinchConfig.hasRole(OWNER_ROLE, migrator.address)).to.equal(false)
      expect(await goldfinchConfig.hasRole(PAUSER_ROLE, migrator.address)).to.equal(false)
      expect(await goldfinchConfig.hasRole(GO_LISTER_ROLE, migrator.address)).to.equal(false)

      await givePermsToMigrator({pool, creditDesk, goldfinchFactory, fidu, migrator, oldConfig: goldfinchConfig})

      // Check that adding the new owner worked

      expect(await fidu.hasRole(MINTER_ROLE, migrator.address)).to.equal(true)
      expect(await fidu.hasRole(OWNER_ROLE, migrator.address)).to.equal(true)
      expect(await fidu.hasRole(PAUSER_ROLE, migrator.address)).to.equal(true)

      expect(await creditDesk.hasRole(OWNER_ROLE, migrator.address)).to.equal(true)
      expect(await creditDesk.hasRole(PAUSER_ROLE, migrator.address)).to.equal(true)

      expect(await pool.hasRole(OWNER_ROLE, migrator.address)).to.equal(true)
      expect(await pool.hasRole(PAUSER_ROLE, migrator.address)).to.equal(true)

      expect(await goldfinchFactory.hasRole(OWNER_ROLE, migrator.address)).to.equal(true)
      expect(await goldfinchFactory.hasRole(PAUSER_ROLE, migrator.address)).to.equal(true)

      expect(await goldfinchConfig.hasRole(OWNER_ROLE, migrator.address)).to.equal(true)
      expect(await goldfinchConfig.hasRole(PAUSER_ROLE, migrator.address)).to.equal(false)
      expect(await goldfinchConfig.hasRole(GO_LISTER_ROLE, migrator.address)).to.equal(false)
    }).timeout(TEST_TIMEOUT)
  })
  describe("step 1", async function () {
    it("should do lots of stuff", async () => {
      const migrator = await prepareMigration()
      const migrationEvents = await deployAndMigrateToV2(migrator)

      expect(await pool.paused()).to.eq(true)

      // QuickCheck's 300k creditline
      let {tranchedPool, newCl, bwrCon, owner: quickCheck} = await getMigratedInfo("0x6dDC3a7233ecD5514607FB1a0E3475A7dA6E58ED", migrationEvents)
      // This value taken from the exact current amount of "interestOwed", according to etherscan
      let expectedAmount = 3698625297
      await assertNewClStillCalculatesInterestCorrectly(tranchedPool, newCl, expectedAmount)

      // Ensure they can pay and interest is received
      await impersonateAccount(hre, quickCheck)
      await fundWithWhales(["ETH", "USDC"], [quickCheck])
      await usdc.approve(bwrCon.address, usdcVal(expectedAmount), {from: quickCheck})
      await expectAction(() => bwrCon.pay(tranchedPool.address, new BN(expectedAmount), {from: quickCheck})).toChange([
        [newCl.interestOwed, {by: new BN(expectedAmount).neg()}],
        // Account for reserve fee
        [() => getBalance(tranchedPool.address, usdc), {byCloseTo: new BN(expectedAmount).mul(new BN(9)).div(new BN(10))}],
      ])

      const {tranchedPool: tranchedPool2, newCl: newCl2} = await getMigratedInfo("0xb2ad56df3bce9bad4d8f04be1fc0eda982a84f44", migrationEvents)
      // This value taken from the exact current amount of "interestOwed", according to etherscan
      // except divided by 2, because at the time, Aspire happened to have accrued 2 periods worth of interest.
      expectedAmount = 2958904109
      await assertNewClStillCalculatesInterestCorrectly(tranchedPool2, newCl2, expectedAmount)

      const newGoldfinchConfig = await getContract("GoldfinchConfig")
      expect(newGoldfinchConfig.address).not.to.equal(goldfinchConfig.address)

      // Expect all perms to be returned

      expect(await fidu.hasRole(MINTER_ROLE, migrator.address)).to.equal(false)
      expect(await fidu.hasRole(OWNER_ROLE, migrator.address)).to.equal(false)
      expect(await fidu.hasRole(PAUSER_ROLE, migrator.address)).to.equal(false)

      expect(await creditDesk.hasRole(OWNER_ROLE, migrator.address)).to.equal(false)
      expect(await creditDesk.hasRole(PAUSER_ROLE, migrator.address)).to.equal(false)

      expect(await pool.hasRole(OWNER_ROLE, migrator.address)).to.equal(false)
      expect(await pool.hasRole(PAUSER_ROLE, migrator.address)).to.equal(false)

      expect(await goldfinchFactory.hasRole(OWNER_ROLE, migrator.address)).to.equal(false)
      expect(await goldfinchFactory.hasRole(PAUSER_ROLE, migrator.address)).to.equal(false)

      expect(await goldfinchConfig.hasRole(OWNER_ROLE, migrator.address)).to.equal(false)
      expect(await goldfinchConfig.hasRole(PAUSER_ROLE, migrator.address)).to.equal(false)
      expect(await goldfinchConfig.hasRole(GO_LISTER_ROLE, migrator.address)).to.equal(false)

      expect(await newGoldfinchConfig.hasRole(OWNER_ROLE, migrator.address)).to.equal(false)
      expect(await newGoldfinchConfig.hasRole(PAUSER_ROLE, migrator.address)).to.equal(false)
      expect(await newGoldfinchConfig.hasRole(GO_LISTER_ROLE, migrator.address)).to.equal(false)

      expect(await fidu.hasRole(MINTER_ROLE, MAINNET_MULTISIG)).to.equal(true)
      expect(await fidu.hasRole(OWNER_ROLE, MAINNET_MULTISIG)).to.equal(true)
      expect(await fidu.hasRole(PAUSER_ROLE, MAINNET_MULTISIG)).to.equal(true)

      expect(await creditDesk.hasRole(OWNER_ROLE, MAINNET_MULTISIG)).to.equal(true)
      expect(await creditDesk.hasRole(PAUSER_ROLE, MAINNET_MULTISIG)).to.equal(true)

      expect(await pool.hasRole(OWNER_ROLE, MAINNET_MULTISIG)).to.equal(true)
      expect(await pool.hasRole(PAUSER_ROLE, MAINNET_MULTISIG)).to.equal(true)

      expect(await goldfinchFactory.hasRole(OWNER_ROLE, MAINNET_MULTISIG)).to.equal(true)
      expect(await goldfinchFactory.hasRole(PAUSER_ROLE, MAINNET_MULTISIG)).to.equal(true)

      expect(await goldfinchConfig.hasRole(OWNER_ROLE, MAINNET_MULTISIG)).to.equal(true)
      expect(await goldfinchConfig.hasRole(PAUSER_ROLE, MAINNET_MULTISIG)).to.equal(true)
      expect(await goldfinchConfig.hasRole(GO_LISTER_ROLE, MAINNET_MULTISIG)).to.equal(false)

      expect(await newGoldfinchConfig.hasRole(OWNER_ROLE, MAINNET_MULTISIG)).to.equal(true)
      expect(await newGoldfinchConfig.hasRole(PAUSER_ROLE, MAINNET_MULTISIG)).to.equal(true)
      expect(await newGoldfinchConfig.hasRole(GO_LISTER_ROLE, MAINNET_MULTISIG)).to.equal(true)

      // Proxy ownership given back to governance

      expect(await (await getProxyVersion(pool.address)).owner()).to.equal(MAINNET_MULTISIG)
      expect(await (await getProxyVersion(creditDesk.address)).owner()).to.equal(MAINNET_MULTISIG)
      expect(await (await getProxyVersion(goldfinchFactory.address)).owner()).to.equal(MAINNET_MULTISIG)
      expect(await (await getProxyVersion(fidu.address)).owner()).to.equal(MAINNET_MULTISIG)

      const poolTokens = await getContract("PoolTokens")
      const seniorPool = await getContract("SeniorPool")

      expect(await seniorPool.hasRole(OWNER_ROLE, MAINNET_MULTISIG)).to.equal(true)
      expect(await poolTokens.hasRole(OWNER_ROLE, MAINNET_MULTISIG)).to.equal(true)
      expect(await (await getProxyVersion(seniorPool.address)).owner()).to.equal(MAINNET_MULTISIG)
      expect(await (await getProxyVersion(poolTokens.address)).owner()).to.equal(MAINNET_MULTISIG)

    }).timeout(TEST_TIMEOUT)
  })
})
