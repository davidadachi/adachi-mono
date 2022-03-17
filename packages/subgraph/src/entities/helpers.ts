import {Address, BigDecimal, BigInt} from "@graphprotocol/graph-ts"
import {JuniorTrancheInfo, SeniorTrancheInfo, TranchedPool, CreditLine} from "../../generated/schema"
import {SeniorPool as SeniorPoolContract} from "../../generated/templates/GoldfinchFactory/SeniorPool"
import {GoldfinchConfig as GoldfinchConfigContract} from "../../generated/templates/GoldfinchFactory/GoldfinchConfig"
import {GOLDFINCH_CONFIG_ADDRESS, LeverageRatioConfigIndex, SENIOR_POOL_ADDRESS} from "../constants"
import {MAINNET_METADATA} from "../metadata"

const FIDU_DECIMAL_PLACES = 18
const FIDU_DECIMALS = BigInt.fromI32(10).pow(FIDU_DECIMAL_PLACES as u8)
const ONE = BigInt.fromString("1")
const ONE_HUNDRED = BigDecimal.fromString("100")

export function fiduFromAtomic(amount: BigInt): BigInt {
  return amount.div(FIDU_DECIMALS)
}

export function getTotalDeposited(
  address: Address,
  juniorTranches: JuniorTrancheInfo[],
  seniorTranches: SeniorTrancheInfo[]
): BigInt {
  let totalDeposited = new BigInt(0)

  for (let i = 0, k = juniorTranches.length; i < k; ++i) {
    let jrTranche = juniorTranches[i]
    let srTranche = seniorTranches[i]

    if (!jrTranche || !srTranche) {
      throw new Error(`Missing tranche information for ${address.toHexString()}`)
    }

    totalDeposited = totalDeposited.plus(jrTranche.principalDeposited)
    totalDeposited = totalDeposited.plus(srTranche.principalDeposited)
  }
  return totalDeposited
}

export function getEstimatedTotalAssets(
  address: Address,
  juniorTranches: JuniorTrancheInfo[],
  seniorTranches: SeniorTrancheInfo[]
): BigInt {
  let totalAssets = new BigInt(0)
  totalAssets = getTotalDeposited(address, juniorTranches, seniorTranches)

  let seniorPoolContract = SeniorPoolContract.bind(Address.fromString(SENIOR_POOL_ADDRESS))
  let estimatedSeniorPoolContribution = seniorPoolContract.estimateInvestment(address)
  totalAssets = totalAssets.plus(estimatedSeniorPoolContribution)
  return totalAssets
}

export function getEstimatedLeverageRatio(
  address: Address,
  juniorTranches: JuniorTrancheInfo[],
  seniorTranches: SeniorTrancheInfo[]
): BigInt {
  let juniorContribution = new BigInt(0)

  for (let i = 0, k = juniorTranches.length; i < k; ++i) {
    let tranche = assert(juniorTranches[i])
    juniorContribution = juniorContribution.plus(tranche.principalDeposited)
  }

  if (juniorContribution.isZero()) {
    const configContract = GoldfinchConfigContract.bind(Address.fromString(GOLDFINCH_CONFIG_ADDRESS))
    const rawLeverageRatio = configContract.getNumber(BigInt.fromI32(LeverageRatioConfigIndex))
    return fiduFromAtomic(rawLeverageRatio)
  }

  const totalAssets = getEstimatedTotalAssets(address, juniorTranches, seniorTranches)
  const estimatedLeverageRatio = totalAssets.minus(juniorContribution).div(juniorContribution)
  return estimatedLeverageRatio
}

export function isV1StyleDeal(address: Address): boolean {
  const poolMetadata = MAINNET_METADATA.get(address.toHexString())
  if (poolMetadata != null) {
    const isV1StyleDeal = poolMetadata.toObject().get("v1StyleDeal")
    if (isV1StyleDeal != null) {
      return isV1StyleDeal.toBool()
    }
  }
  return false
}

export function calculateEstimatedInterestForTranchedPool(tranchedPoolId: string): BigDecimal {
  const tranchedPool = TranchedPool.load(tranchedPoolId)
  if (!tranchedPool) {
    return BigDecimal.fromString("0")
  }
  const creditLine = CreditLine.load(tranchedPool.creditLine)
  if (!creditLine) {
    return BigDecimal.fromString("0")
  }

  const protocolFee = BigDecimal.fromString("0.1")
  const balance = creditLine.balance.toBigDecimal()
  const interestAprDecimal = creditLine.interestAprDecimal
  const juniorFeePercentage = tranchedPool.juniorFeePercent.toBigDecimal().div(ONE_HUNDRED)
  const isV1Pool = tranchedPool.isV1StyleDeal
  const seniorPoolPercentageOfInterest = BigDecimal.fromString("1")
    .minus(isV1Pool ? BigDecimal.fromString("0") : juniorFeePercentage)
    .minus(protocolFee)
  return balance.times(interestAprDecimal).times(seniorPoolPercentageOfInterest)
}

export function estimateJuniorAPY(tranchedPoolId: string): BigDecimal {
  const tranchedPool = TranchedPool.load(tranchedPoolId)
  if (!tranchedPool) {
    return BigDecimal.fromString("0")
  }

  const creditLine = CreditLine.load(tranchedPool.creditLine)
  if (!creditLine) {
    return BigDecimal.fromString("0")
  }

  if (isV1StyleDeal(Address.fromString(tranchedPoolId))) {
    return creditLine.interestAprDecimal
  }

  let balance: BigInt
  if (creditLine.balance.isZero()) {
    balance = creditLine.limit
  } else {
    balance = creditLine.balance
  }

  if (balance.isZero()) {
    return BigDecimal.fromString("0")
  }

  const leverageRatio = tranchedPool.estimatedLeverageRatio
  let seniorFraction = leverageRatio.divDecimal(ONE.plus(leverageRatio).toBigDecimal())
  let juniorFraction = ONE.divDecimal(ONE.plus(leverageRatio).toBigDecimal())
  let interestRateFraction = creditLine.interestAprDecimal.div(ONE_HUNDRED)
  let juniorFeeFraction = tranchedPool.juniorFeePercent.divDecimal(ONE_HUNDRED)
  let reserveFeeFraction = tranchedPool.reserveFeePercent.divDecimal(ONE_HUNDRED)

  let grossSeniorInterest = balance.toBigDecimal().times(interestRateFraction).times(seniorFraction)
  let grossJuniorInterest = balance.toBigDecimal().times(interestRateFraction).times(juniorFraction)
  const juniorFee = grossSeniorInterest.times(juniorFeeFraction)

  const juniorReserveFeeOwed = grossJuniorInterest.times(reserveFeeFraction)
  let netJuniorInterest = grossJuniorInterest.plus(juniorFee).minus(juniorReserveFeeOwed)
  let juniorTranche = balance.toBigDecimal().times(juniorFraction)
  return netJuniorInterest.div(juniorTranche).times(ONE_HUNDRED)
}
