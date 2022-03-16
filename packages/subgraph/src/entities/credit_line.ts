import {Address, BigDecimal, BigInt, log} from "@graphprotocol/graph-ts"
import {CreditLine} from "../../generated/schema"
import {CreditLine as CreditLineContract} from "../../generated/templates/GoldfinchFactory/CreditLine"
import {isAfterV2_2, VERSION_BEFORE_V2_2, VERSION_V2_2} from "../utils"

const INTEREST_DECIMALS = BigDecimal.fromString("1000000000000000000")

export function getOrInitCreditLine(address: Address, timestamp: BigInt): CreditLine {
  let creditLine = CreditLine.load(address.toHexString())
  if (!creditLine) {
    creditLine = initOrUpdateCreditLine(address, timestamp)
  }
  return creditLine
}

export function initOrUpdateCreditLine(address: Address, timestamp: BigInt): CreditLine {
  let creditLine = CreditLine.load(address.toHexString())
  if (!creditLine) {
    creditLine = new CreditLine(address.toHexString())
  }
  let contract = CreditLineContract.bind(address)

  creditLine.balance = contract.balance()
  creditLine.interestApr = contract.interestApr()
  creditLine.interestAccruedAsOf = contract.interestAccruedAsOf()
  creditLine.paymentPeriodInDays = contract.paymentPeriodInDays()
  creditLine.termInDays = contract.termInDays()
  creditLine.nextDueTime = contract.nextDueTime()
  creditLine.limit = contract.limit()
  creditLine.interestOwed = contract.interestOwed()
  creditLine.termEndTime = contract.termEndTime()
  creditLine.lastFullPaymentTime = contract.lastFullPaymentTime()
  creditLine.interestAprDecimal = creditLine.interestApr.toBigDecimal().div(INTEREST_DECIMALS)
  creditLine.version = VERSION_BEFORE_V2_2

  let maxLimit = creditLine.limit
  if (timestamp && isAfterV2_2(timestamp)) {
    const callMaxLimit = contract.try_maxLimit()
    if (callMaxLimit.reverted) {
      log.warning("maxLimit reverted for credit line {}", [address.toHexString()])
    } else {
      maxLimit = callMaxLimit.value
      // Assuming that the credit line is v2_2 if requests work
      creditLine.version = VERSION_V2_2
    }
  }

  creditLine.maxLimit = maxLimit
  creditLine.save()
  return creditLine
}
