import chai from "chai"
import {artifacts, web3, ethers} from "hardhat"
chai.use(require("chai-as-promised"))
const expect = chai.expect
import mochaEach from "mocha-each"
import {time} from "@openzeppelin/test-helpers"
import BN from "bn.js"
import {isTestEnv, USDCDecimals, interestAprAsBN, ZERO_ADDRESS} from "../blockchain_scripts/deployHelpers"
import {DeploymentsExtension} from "hardhat-deploy/dist/types"
import {
  CreditDeskInstance,
  ERC20Instance,
  FiduInstance,
  FixedLeverageRatioStrategyInstance,
  GoldfinchConfigInstance,
  GoldfinchFactoryInstance,
  PoolInstance,
  PoolTokensInstance,
  SeniorFundInstance,
  CreditLineInstance,
  TestForwarderInstance,
  TranchedPoolInstance,
  TransferRestrictedVaultInstance,
} from "../typechain/truffle"
import {assertNonNullable} from "../utils/type"
const decimals = new BN(String(1e18))
const USDC_DECIMALS = new BN(String(1e6))
const SECONDS_PER_DAY = new BN(86400)
const SECONDS_PER_YEAR = SECONDS_PER_DAY.mul(new BN(365))
const UNIT_SHARE_PRICE = new BN("1000000000000000000") // Corresponds to share price of 100% (no interest or writedowns)
chai.use(require("chai-bn")(BN))

const MAX_UINT = new BN("115792089237316195423570985008687907853269984665640564039457584007913129639935")
const fiduTolerance = decimals.div(USDC_DECIMALS)
const CreditLine = artifacts.require("CreditLine")
const EMPTY_DATA = "0x"
const BLOCKS_PER_DAY = 5760
const ZERO = new BN(0)

// Helper functions. These should be pretty generic.
function bigVal(number) {
  return new BN(number).mul(decimals)
}

function usdcVal(number) {
  return new BN(number).mul(USDC_DECIMALS)
}

function usdcToFidu(number) {
  return number.mul(decimals.div(USDCDecimals))
}

function fiduToUSDC(number) {
  return number.div(decimals.div(USDCDecimals))
}

const getDeployedAsTruffleContract = async <T extends Truffle.ContractInstance>(
  deployments: DeploymentsExtension,
  contractName: string
): Promise<T> => {
  let deployment = await deployments.getOrNull(contractName)
  if (!deployment && contractName === "GoldfinchFactory") {
    deployment = await deployments.getOrNull("CreditLineFactory")
  }
  if (!deployment && isTestEnv()) {
    contractName = `Test${contractName}`
    deployment = await deployments.get(contractName)
  }
  return getTruffleContract(contractName, deployment!.address)
}

async function getTruffleContract<T extends Truffle.ContractInstance>(name: string, address: string): Promise<T> {
  return (await artifacts.require(name).at(address)) as T
}

async function createCreditLine({
  borrower,
  creditDesk,
  underwriter,
  paymentPeriodInDays = 30,
  limit = usdcVal(10000),
  interestApr = interestAprAsBN("15.0"),
  termInDays = 360,
  lateFeesApr = interestAprAsBN("3.0"),
}: {
  borrower?: string
  creditDesk?: any
  underwriter?: string
  paymentPeriodInDays?: any
  limit?: BN
  interestApr?: BN
  termInDays?: number | BN
  lateFeesApr?: BN
} = {}) {
  if (typeof borrower !== "string") {
    throw new Error("Borrower address must be a string")
  }
  if (typeof underwriter !== "string") {
    throw new Error("Underwriter address must be a string")
  }
  await creditDesk.createCreditLine(borrower, limit, interestApr, paymentPeriodInDays, termInDays, lateFeesApr, {
    from: underwriter,
  })
  var ulCreditLines = await creditDesk.getUnderwriterCreditLines(underwriter)
  return CreditLine.at(ulCreditLines[ulCreditLines.length - 1]) // Return the latest
}

const tolerance = usdcVal(1).div(new BN(1000)) // 0.001$

function expectAction(action: any, debug?: boolean) {
  return {
    toChange: async (itemsAndExpectations) => {
      const items = itemsAndExpectations.map((pair) => pair[0])
      const expectations = itemsAndExpectations.map((pair) => pair[1])
      const originalValues = (await Promise.all(items.map((i) => i()))) as any
      if (debug) {
        console.log("Original:", String(originalValues))
      }
      const actionPromise = action()
      if (actionPromise === undefined) {
        throw new Error("Expected a promise. Did you forget to return?")
      }
      await actionPromise
      const newValues = (await Promise.all(items.map((i) => i()))) as any
      if (debug) {
        console.log("New:     ", String(newValues))
      }
      expectations.forEach((expectation, i) => {
        try {
          if (expectation.by) {
            expect(newValues[i].sub(originalValues[i])).to.bignumber.equal(expectation.by)
          } else if (expectation.byCloseTo) {
            const onePercent = expectation.byCloseTo.div(new BN(100)).abs()
            expect(newValues[i].sub(originalValues[i])).to.bignumber.closeTo(expectation.byCloseTo, onePercent)
          } else if (expectation.fn) {
            expectation.fn(originalValues[i], newValues[i])
          } else if (expectation.increase) {
            expect(newValues[i]).to.bignumber.gt(originalValues[i])
          } else if (expectation.decrease) {
            expect(newValues[i]).to.bignumber.lt(originalValues[i])
          } else if (expectation.to) {
            if (expectation.bignumber === false) {
              // It was not originally the number we expected, but then was changed to it
              expect(originalValues[i]).to.not.eq(expectation.to)
              expect(newValues[i]).to.eq(expectation.to)
            } else {
              // It was not originally the number we expected, but then was changed to it
              expect(originalValues[i]).to.not.bignumber.eq(expectation.to)
              expect(newValues[i]).to.bignumber.eq(expectation.to)
            }
          } else if (expectation.toCloseTo) {
            // It was not originally the number we expected, but then was changed to it
            const onePercent = expectation.toCloseTo.div(new BN(100)).abs()
            expect(originalValues[i]).to.not.bignumber.eq(expectation.toCloseTo)
            expect(newValues[i]).to.bignumber.closeTo(expectation.toCloseTo, onePercent)
          } else if (expectation.unchanged) {
            expect(newValues[i]).to.bignumber.eq(originalValues[i])
          } else if (expectation.beDifferent) {
            expect(String(originalValues[i])).to.not.eq(String(newValues[i]))
          }
        } catch (error) {
          console.log("Expectation", i, "failed")
          throw error
        }
      })
    },
  }
}

// This decodes logs for a single event type, and returns a decoded object in
// the same form truffle-contract uses on its receipts
// Mostly stolen from: https://github.com/OpenZeppelin/openzeppelin-test-helpers/blob/6e54db1e1f64a80c7632799776672297bbe543b3/src/expectEvent.js#L49
function decodeLogs<T extends Truffle.AnyEvent>(logs, emitter, eventName): T[] {
  let abi = emitter.abi
  let address = emitter.address
  let eventABI = abi.filter((x) => x.type === "event" && x.name === eventName)
  if (eventABI.length === 0) {
    throw new Error(`No ABI entry for event '${eventName}'`)
  } else if (eventABI.length > 1) {
    throw new Error(`Multiple ABI entries for event '${eventName}', only uniquely named events are supported`)
  }

  eventABI = eventABI[0]

  // The first topic will equal the hash of the event signature
  const eventTopic = eventABI.signature

  // Only decode events of type 'EventName'
  return logs
    .filter((log) => log.topics.length > 0 && log.topics[0] === eventTopic && (!address || log.address === address))
    .map((log) => web3.eth.abi.decodeLog(eventABI.inputs, log.data, log.topics.slice(1)))
    .map((decoded) => ({event: eventName, args: decoded}))
}

function getFirstLog<T extends Truffle.AnyEvent>(logs: T[]): T {
  const firstLog = logs[0]
  assertNonNullable(firstLog)
  return firstLog
}

async function deployAllContracts(
  deployments: DeploymentsExtension,
  options: {deployForwarder?: boolean; fromAccount?: string} = {}
): Promise<{
  pool: PoolInstance
  seniorFund: SeniorFundInstance
  seniorFundStrategy: FixedLeverageRatioStrategyInstance
  usdc: ERC20Instance
  creditDesk: CreditDeskInstance
  fidu: FiduInstance
  goldfinchConfig: GoldfinchConfigInstance
  goldfinchFactory: GoldfinchFactoryInstance
  forwarder: TestForwarderInstance | null
  poolTokens: PoolTokensInstance
  tranchedPool: TranchedPoolInstance
  transferRestrictedVault: TransferRestrictedVaultInstance
}> {
  let {deployForwarder, fromAccount} = options
  await deployments.fixture("base_deploy")
  const pool = await getDeployedAsTruffleContract<PoolInstance>(deployments, "Pool")
  const seniorFund = await getDeployedAsTruffleContract<SeniorFundInstance>(deployments, "SeniorFund")
  const seniorFundStrategy = await getDeployedAsTruffleContract<FixedLeverageRatioStrategyInstance>(
    deployments,
    "FixedLeverageRatioStrategy"
  )
  const usdc = await getDeployedAsTruffleContract<ERC20Instance>(deployments, "ERC20")
  const creditDesk = await getDeployedAsTruffleContract<CreditDeskInstance>(deployments, "CreditDesk")
  const fidu = await getDeployedAsTruffleContract<FiduInstance>(deployments, "Fidu")
  const goldfinchConfig = await getDeployedAsTruffleContract<GoldfinchConfigInstance>(deployments, "GoldfinchConfig")
  const goldfinchFactory = await getDeployedAsTruffleContract<GoldfinchFactoryInstance>(deployments, "GoldfinchFactory")
  const poolTokens = await getDeployedAsTruffleContract<PoolTokensInstance>(deployments, "PoolTokens")
  let forwarder: TestForwarderInstance | null = null
  if (deployForwarder) {
    await deployments.deploy("TestForwarder", {from: fromAccount as string, gasLimit: 4000000})
    forwarder = await getDeployedAsTruffleContract<TestForwarderInstance>(deployments, "TestForwarder")
    await forwarder!.registerDomainSeparator("Defender", "1")
  }
  let tranchedPool = await getDeployedAsTruffleContract<TranchedPoolInstance>(deployments, "TranchedPool")
  const transferRestrictedVault = await getDeployedAsTruffleContract<TransferRestrictedVaultInstance>(
    deployments,
    "TransferRestrictedVault"
  )
  return {
    pool,
    seniorFund,
    seniorFundStrategy,
    usdc,
    creditDesk,
    fidu,
    goldfinchConfig,
    goldfinchFactory,
    forwarder,
    poolTokens,
    tranchedPool,
    transferRestrictedVault,
  }
}

async function erc20Approve(erc20, accountToApprove, amount, fromAccounts) {
  if (typeof accountToApprove != "string") {
    throw new Error("Account to approve must be a string!")
  }
  for (const fromAccount of fromAccounts) {
    await erc20.approve(accountToApprove, amount, {from: fromAccount})
  }
}

async function erc20Transfer(erc20, toAccounts, amount, fromAccount) {
  for (const toAccount of toAccounts) {
    await erc20.transfer(toAccount, amount, {from: fromAccount})
  }
}

type Numberish = BN | string | number
async function advanceTime({days, seconds, toSecond}: {days?: Numberish; seconds?: Numberish; toSecond?: Numberish}) {
  let secondsPassed, newTimestamp
  let currentTimestamp = await time.latest()

  if (days) {
    secondsPassed = SECONDS_PER_DAY.mul(new BN(days))
    newTimestamp = currentTimestamp.add(secondsPassed)
  } else if (seconds) {
    secondsPassed = new BN(seconds)
    newTimestamp = currentTimestamp.add(secondsPassed)
  } else if (toSecond) {
    newTimestamp = new BN(toSecond)
  }
  // Cannot go backward
  expect(newTimestamp).to.bignumber.gt(currentTimestamp)

  await ethers.provider.send("evm_setNextBlockTimestamp", [newTimestamp.toNumber()])
  return newTimestamp
}

async function getBalance(address, erc20) {
  if (typeof address !== "string") {
    throw new Error("Address must be a string")
  }
  if (erc20) {
    return new BN(await erc20.balanceOf(address))
  }
  return new BN(await web3.eth.getBalance(address))
}

const createPoolWithCreditLine = async ({
  people,
  goldfinchFactory,
  usdc,
  juniorFeePercent = 20,
  interestApr = interestAprAsBN("15.0"),
  paymentPeriodInDays = new BN(30),
  termInDays = new BN(365),
  limit = usdcVal(10000),
  lateFeeApr = interestAprAsBN("3.0"),
}): Promise<{tranchedPool: TranchedPoolInstance; creditLine: CreditLineInstance}> => {
  const thisOwner = people.owner
  const thisBorrower = people.borrower

  if (!thisBorrower) {
    throw new Error("No borrower is set. Set one in a beforeEach, or pass it in explicitly")
  }

  if (!thisOwner) {
    throw new Error("No owner is set. Please set one in a beforeEach or pass it in explicitly")
  }

  let result = await goldfinchFactory.createPool(
    thisBorrower,
    juniorFeePercent,
    limit,
    interestApr,
    paymentPeriodInDays,
    termInDays,
    lateFeeApr,
    {from: thisOwner}
  )
  let event = result.logs[result.logs.length - 1]
  let pool = await getTruffleContract<TranchedPoolInstance>("TranchedPool", event.args.pool)
  let creditLine = await getTruffleContract<CreditLineInstance>("CreditLine", await pool.creditLine())

  await erc20Approve(usdc, pool.address, usdcVal(100000), [thisOwner])

  // Only approve if borrower is an EOA (could be a borrower contract)
  if ((await web3.eth.getCode(thisBorrower)) === "0x") {
    await erc20Approve(usdc, pool.address, usdcVal(100000), [thisBorrower])
  }

  let tranchedPool = await getTruffleContract<TranchedPoolInstance>("TestTranchedPool", pool.address)
  return {tranchedPool, creditLine}
}

async function toTruffle(address: Truffle.ContractInstance | string, contractName, opts?: {}) : Promise<Truffle.ContractInstance> {
  let truffleContract = await artifacts.require(contractName)
  address = typeof(address) === "string" ? address : address.address
  if (opts) {
    truffleContract.defaults(opts)
  }
  return truffleContract.at(address)
}

export {
  chai,
  expect,
  decimals,
  USDC_DECIMALS,
  BN,
  MAX_UINT,
  tolerance,
  fiduTolerance,
  ZERO_ADDRESS,
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR,
  EMPTY_DATA,
  BLOCKS_PER_DAY,
  UNIT_SHARE_PRICE,
  ZERO,
  bigVal,
  usdcVal,
  mochaEach,
  getBalance,
  getDeployedAsTruffleContract,
  getTruffleContract,
  fiduToUSDC,
  usdcToFidu,
  expectAction,
  deployAllContracts,
  erc20Approve,
  erc20Transfer,
  advanceTime,
  createCreditLine,
  createPoolWithCreditLine,
  decodeLogs,
  getFirstLog,
  toTruffle,
}
