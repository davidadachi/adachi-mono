import BigNumber from "bignumber.js"
import {fetchDataFromAttributes, INTEREST_DECIMALS, USDC_DECIMALS} from "./utils"
import {Tickers, usdcFromAtomic} from "./erc20"
import {FIDU_DECIMALS, fiduFromAtomic} from "./fidu"
import {dedupe, roundDownPenny} from "../utils"
import {getPoolEvents} from "./user"
import _ from "lodash"
import {mapEventsToTx} from "./events"
import {Contract} from "web3-eth-contract"
import {Pool as PoolContract} from "../typechain/web3/Pool"
import {SeniorPool as SeniorPoolContract} from "../typechain/web3/SeniorPool"
import {Fidu as FiduContract} from "../typechain/web3/Fidu"
import {GoldfinchProtocol} from "./GoldfinchProtocol"
import {TranchedPool} from "../typechain/web3/TranchedPool"
import {buildCreditLine} from "./creditLine"

class Pool {
  goldfinchProtocol: GoldfinchProtocol
  contract: PoolContract
  chain: string
  address: string
  loaded: boolean

  constructor(goldfinchProtocol: GoldfinchProtocol) {
    this.goldfinchProtocol = goldfinchProtocol
    this.contract = goldfinchProtocol.getContract<PoolContract>("Pool")
    this.address = goldfinchProtocol.getAddress("Pool")
    this.chain = goldfinchProtocol.networkId
    this.loaded = true
  }
}

class SeniorPool {
  goldfinchProtocol: GoldfinchProtocol
  contract: SeniorPoolContract
  usdc: Contract
  fidu: FiduContract
  v1Pool: Pool
  chain: string
  address: string
  loaded: boolean
  gf!: PoolData

  constructor(goldfinchProtocol: GoldfinchProtocol, v1Pool: Pool) {
    this.goldfinchProtocol = goldfinchProtocol
    this.contract = goldfinchProtocol.getContract<SeniorPoolContract>("SeniorPool")
    this.address = goldfinchProtocol.getAddress("SeniorPool")
    this.usdc = goldfinchProtocol.getERC20(Tickers.USDC).contract
    this.fidu = goldfinchProtocol.getContract<FiduContract>("Fidu")
    this.v1Pool = v1Pool
    this.chain = goldfinchProtocol.networkId
    this.loaded = true
  }

  async initialize() {
    let poolData = await fetchPoolData(this, this.v1Pool, this.usdc)
    this.gf = poolData
  }
}

interface CapitalProvider {
  numShares: BigNumber
  availableToWithdraw: BigNumber
  availableToWithdrawInDollars: BigNumber
  address: string
  allowance: BigNumber
  weightedAverageSharePrice: BigNumber
  unrealizedGains: BigNumber
  unrealizedGainsInDollars: BigNumber
  unrealizedGainsPercentage: BigNumber
  loaded: boolean
}

function emptyCapitalProvider({loaded = false} = {}): CapitalProvider {
  return {
    numShares: new BigNumber(0),
    availableToWithdraw: new BigNumber(0),
    availableToWithdrawInDollars: new BigNumber(0),
    address: "",
    allowance: new BigNumber(0),
    weightedAverageSharePrice: new BigNumber(0),
    unrealizedGains: new BigNumber(0),
    unrealizedGainsInDollars: new BigNumber(0),
    unrealizedGainsPercentage: new BigNumber(0),
    loaded,
  }
}

async function fetchCapitalProviderData(
  pool: SeniorPool,
  v1Pool: Pool,
  capitalProviderAddress: string | boolean,
): Promise<CapitalProvider> {
  if (!capitalProviderAddress) {
    return emptyCapitalProvider({ loaded: pool.loaded && v1Pool.loaded })
  }

  const attributes = [{method: "sharePrice"}]
  let {sharePrice} = await fetchDataFromAttributes(pool.contract, attributes, {bigNumber: true})
  let numShares = new BigNumber(await pool.fidu.methods.balanceOf(capitalProviderAddress as string).call())
  let availableToWithdraw = new BigNumber(numShares)
    .multipliedBy(new BigNumber(sharePrice))
    .div(FIDU_DECIMALS.toString())
  let availableToWithdrawInDollars = new BigNumber(fiduFromAtomic(availableToWithdraw))
  let address = capitalProviderAddress as string
  let allowance = new BigNumber(await pool.usdc.methods.allowance(capitalProviderAddress, pool.address).call())
  let weightedAverageSharePrice = await getWeightedAverageSharePrice(pool, v1Pool, {numShares, address})
  const sharePriceDelta = sharePrice.dividedBy(FIDU_DECIMALS).minus(weightedAverageSharePrice)
  let unrealizedGains = sharePriceDelta.multipliedBy(numShares)
  let unrealizedGainsInDollars = new BigNumber(roundDownPenny(unrealizedGains.div(FIDU_DECIMALS)))
  let unrealizedGainsPercentage = sharePriceDelta.dividedBy(weightedAverageSharePrice)
  let loaded = true
  return {
    numShares,
    availableToWithdraw,
    availableToWithdrawInDollars,
    address,
    allowance,
    weightedAverageSharePrice,
    unrealizedGains,
    unrealizedGainsInDollars,
    unrealizedGainsPercentage,
    loaded,
  }
}

interface PoolData {
  rawBalance: BigNumber
  compoundBalance: BigNumber
  balance: BigNumber
  totalShares: BigNumber
  totalPoolAssets: BigNumber
  totalLoansOutstanding: BigNumber
  cumulativeWritedowns: BigNumber
  cumulativeDrawdowns: BigNumber
  estimatedTotalInterest: BigNumber
  estimatedApy: BigNumber
  defaultRate: BigNumber
  poolTxs: any[] //TODO
  assetsAsOf: typeof assetsAsOf
  getRepaymentEvents: typeof getRepaymentEvents
  remainingCapacity: typeof remainingCapacity
  loaded: boolean
  pool: SeniorPool
}

async function fetchPoolData(pool: SeniorPool, v1Pool: Pool, erc20: Contract): Promise<PoolData> {
  const attributes = [{method: "sharePrice"}, {method: "compoundBalance"}]
  let {sharePrice, compoundBalance: _compoundBalance} = await fetchDataFromAttributes(pool.contract, attributes)
  let rawBalance = new BigNumber(await erc20.methods.balanceOf(pool.address).call())
  let compoundBalance = new BigNumber(_compoundBalance)
  let balance = compoundBalance.plus(rawBalance)
  let totalShares = new BigNumber(await pool.fidu.methods.totalSupply().call())

  // Do some slightly goofy multiplication and division here so that we have consistent units across
  // 'balance', 'totalPoolBalance', and 'totalLoansOutstanding', allowing us to do arithmetic between them
  // and display them using the same helpers.
  const totalPoolAssetsInDollars = totalShares
    .div(FIDU_DECIMALS.toString())
    .multipliedBy(new BigNumber(sharePrice))
    .div(FIDU_DECIMALS.toString())
  let totalPoolAssets = totalPoolAssetsInDollars.multipliedBy(USDC_DECIMALS.toString())
  let totalLoansOutstanding = new BigNumber(await pool.contract.methods.totalLoansOutstanding().call())
  let cumulativeWritedowns = await getCumulativeWritedowns(pool)
  let cumulativeDrawdowns = await getCumulativeDrawdowns(pool)
  let poolTxs = await getAllDepositAndWithdrawalTxs(pool, v1Pool)
  // let estimatedTotalInterest = await getEstimatedTotalInterest(pool)
  // HOTFIX: Hardcode to NaN so that APY displays as "--.--%" instead of 0%
  let estimatedTotalInterest = new BigNumber(NaN)
  // let estimatedApy = estimatedTotalInterest.dividedBy(totalPoolAssets)
  // HOTFIX: Hardcode to NaN so that APY displays as "--.--%" instead of 0%
  let estimatedApy = new BigNumber(NaN)
  let defaultRate = cumulativeWritedowns.dividedBy(cumulativeDrawdowns)

  let loaded = true

  return {
    rawBalance,
    compoundBalance,
    balance,
    totalShares,
    totalPoolAssets,
    totalLoansOutstanding,
    cumulativeWritedowns,
    cumulativeDrawdowns,
    poolTxs,
    assetsAsOf,
    getRepaymentEvents,
    remainingCapacity,
    estimatedTotalInterest,
    estimatedApy,
    defaultRate,
    loaded,
    pool,
  }
}

// This uses the FIFO method of calculating cost-basis. Thus we
// add up the deposits *in reverse* to arrive at your current number of shares.
// We calculate the weighted average price based on that, which can then be used
// to calculate unrealized gains.
// Note: This does not take into account transfers of Fidu that happen outside
// the protocol. In such a case, you would necessarily end up with more Fidu
// than we have records of your deposits, so we would not be able to account
// for your shares, and we would fail out, and return a "-" on the front-end.
// Note: This also does not take into account realized gains, which we are also punting on.
async function getWeightedAverageSharePrice(pool: SeniorPool, v1Pool: Pool, capitalProvider) {
  // In migrating from v1 to v2 (i.e. from the `Pool` contract as modeling the senior pool,
  // to the `SeniorPool` contract as modeling the senior pool), the deposits that a
  // `capitalProvider` had made into Pool became deposits in SeniorPool. But we did not
  // migrate / re-emit DepositMade events themselves, from the Pool contract onto the
  // SeniorPool contract. So to accurately count all of a `capitalProvider`'s deposits, we
  // need to query for their DepositMade events on both the SeniorPool and Pool contracts.
  const v1PoolEvents = await getPoolEvents(v1Pool, capitalProvider.address, ["DepositMade"])
  const poolEvents = await getPoolEvents(pool, capitalProvider.address, ["DepositMade"])
  const combinedEvents = v1PoolEvents.concat(poolEvents)
  const preparedEvents = _.reverse(_.sortBy(combinedEvents, "blockNumber"))

  let zero = new BigNumber(0)
  let sharesLeftToAccountFor = capitalProvider.numShares
  let totalAmountPaid = zero
  preparedEvents.forEach((event) => {
    if (sharesLeftToAccountFor.lte(zero)) {
      return
    }
    const sharePrice = new BigNumber(event.returnValues.amount)
      .dividedBy(USDC_DECIMALS.toString())
      .dividedBy(new BigNumber(event.returnValues.shares).dividedBy(FIDU_DECIMALS.toString()))
    const sharesToAccountFor = BigNumber.min(sharesLeftToAccountFor, new BigNumber(event.returnValues.shares))
    totalAmountPaid = totalAmountPaid.plus(sharesToAccountFor.multipliedBy(sharePrice))
    sharesLeftToAccountFor = sharesLeftToAccountFor.minus(sharesToAccountFor)
  })
  if (sharesLeftToAccountFor.gt(zero)) {
    // This case means you must have received Fidu outside of depositing,
    // which we don't have price data for, and therefore can't calculate
    // a correct weighted average price. By returning empty string,
    // the result becomes NaN, and our display functions automatically handle
    // the case, and turn it into a '-' on the front-end
    return new BigNumber("")
  } else {
    return totalAmountPaid.dividedBy(capitalProvider.numShares)
  }
}

async function getCumulativeWritedowns(pool: SeniorPool) {
  // TODO[PR] In theory, I believe we'd want to include events here from the v1 Pool as well.
  // But we wouldn't need to in practice if no such events were emitted...?

  const events = await pool.goldfinchProtocol.queryEvents(pool.contract, "PrincipalWrittenDown")
  return new BigNumber(_.sumBy(events, (event) => parseInt(event.returnValues.amount, 10))).negated()
}

async function getCumulativeDrawdowns(pool: SeniorPool) {
  // TODO[PR] In theory, I believe we'd want to include events here from the v1 Pool as well.
  // But we wouldn't need to in practice if no such events were emitted...? Was there such a
  // thing as "InvestmentMade" events in v1?

  const protocol = pool.goldfinchProtocol
  const investmentEvents = await protocol.queryEvents(pool.contract, [
    "InvestmentMadeInSenior",
    "InvestmentMadeInJunior",
  ])
  const mappedTranchedPoolAddresses = investmentEvents.map((e) => e.returnValues.tranchedPool)
  // De-duplicate the tranched pool addresses, in case the senior pool has made more than one investment
  // in a tranched pool.
  const tranchedPoolAddresses: string[] = dedupe(mappedTranchedPoolAddresses)
  const tranchedPools = tranchedPoolAddresses.map((address) =>
    pool.goldfinchProtocol.getContract<TranchedPool>("TranchedPool", address),
  )
  let allDrawdownEvents = _.flatten(
    await Promise.all(tranchedPools.map((pool) => protocol.queryEvents(pool, "DrawdownMade"))),
  )
  return new BigNumber(_.sumBy(allDrawdownEvents, (event) => parseInt(event.returnValues.amount, 10)))
}

async function getRepaymentEvents(this: PoolData, goldfinchProtocol: GoldfinchProtocol) {
  const eventNames = ["InterestCollected", "PrincipalCollected", "ReserveFundsCollected"]
  let events = await goldfinchProtocol.queryEvents(this.pool.contract, eventNames)
  const oldEvents = await goldfinchProtocol.queryEvents("Pool", eventNames)
  events = oldEvents.concat(events)
  const eventTxs = await mapEventsToTx(events)
  const combinedEvents = _.map(_.groupBy(eventTxs, "id"), (val) => {
    const interestPayment = _.find(val, (event) => event.type === "InterestCollected")
    const principalPayment = _.find(val, (event) => event.type === "PrincipalCollected") || {
      amountBN: new BigNumber(0),
    }
    const reserveCollection = _.find(val, (event) => event.type === "ReserveFundsCollected") || {
      amountBN: new BigNumber(0),
    }
    if (!interestPayment) {
      // This usually  means it's just ReserveFundsCollected, from a withdraw, and not a repayment
      return null
    }
    const merged: any = {...interestPayment, ...principalPayment, ...reserveCollection}
    merged.amountBN = interestPayment.amountBN.plus(principalPayment.amountBN).plus(reserveCollection.amountBN)
    merged.amount = usdcFromAtomic(merged.amountBN)
    merged.interestAmountBN = interestPayment.amountBN
    merged.type = "CombinedRepayment"
    merged.name = "CombinedRepayment"
    return merged
  })
  return _.compact(combinedEvents)
}

async function getAllDepositAndWithdrawalTxs(pool: SeniorPool, v1Pool: Pool) {
  const eventNames = ["DepositMade", "WithdrawalMade"]
  const [poolEvents, v1PoolEvents] = await Promise.all([getPoolEvents(pool, undefined, eventNames), getPoolEvents(v1Pool, undefined, eventNames)])
  const combinedEvents = v1PoolEvents.concat(poolEvents)
  return await mapEventsToTx(_.flatten(combinedEvents))
}

function assetsAsOf(this: PoolData, dt) {
  const filtered = _.filter(this.poolTxs, (transfer) => {
    return transfer.blockTime < dt
  })
  if (!filtered.length) {
    return new BigNumber(0)
  }
  return BigNumber.sum.apply(
    null,
    filtered.map((transfer) => {
      if (transfer.type === "WithdrawalMade") {
        return transfer.amountBN.multipliedBy(new BigNumber(-1))
      } else {
        return transfer.amountBN
      }
    }),
  )
}

/**
 * Returns the remaining capacity in the pool, assuming a max capacity of `maxPoolCapacity`,
 * in atomic units.
 *
 * @param maxPoolCapacity - Maximum capacity of the pool
 * @returns Remaining capacity of pool in atomic units
 */
function remainingCapacity(this: PoolData, maxPoolCapacity: BigNumber): BigNumber {
  let cappedBalance = BigNumber.min(this.totalPoolAssets, maxPoolCapacity)
  return new BigNumber(maxPoolCapacity).minus(cappedBalance)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getEstimatedTotalInterest(pool: SeniorPool): Promise<BigNumber> {
  const protocol = pool.goldfinchProtocol
  const investmentEvents = await protocol.queryEvents(pool.contract, [
    "InvestmentMadeInSenior",
    "InvestmentMadeInJunior",
  ])
  const mappedTranchedPoolAddresses = investmentEvents.map((e) => e.returnValues.tranchedPool)
  // De-duplicate the tranched pool addresses, in case the senior pool has made more than one investment
  // in a tranched pool.
  const tranchedPoolAddresses: string[] = dedupe(mappedTranchedPoolAddresses)
  const tranchedPools = tranchedPoolAddresses.map((address) =>
    pool.goldfinchProtocol.getContract<TranchedPool>("TranchedPool", address),
  )
  const creditLineAddresses = await Promise.all(tranchedPools.map((p) => p.methods.creditLine().call()))
  const creditLines = creditLineAddresses.map((a) => buildCreditLine(a))
  const creditLineData = await Promise.all(
    creditLines.map(async (cl) => {
      let balance = new BigNumber(await cl.methods.balance().call())
      let interestApr = new BigNumber(await cl.methods.interestApr().call())
      return {balance, interestApr}
    }),
  )
  return BigNumber.sum.apply(
    null,
    creditLineData.map((cl) => cl.balance.multipliedBy(cl.interestApr.dividedBy(INTEREST_DECIMALS.toString()))),
  )
}

export {fetchCapitalProviderData, fetchPoolData, SeniorPool, Pool, emptyCapitalProvider}
export type {PoolData, CapitalProvider}
