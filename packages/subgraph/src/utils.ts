import {ethereum, BigInt, BigDecimal} from "@graphprotocol/graph-ts"
import {V2_2_MIGRATION_TIME} from "./constants"

export const VERSION_BEFORE_V2_2 = "BEFORE_V2_2"
export const VERSION_V2_2 = "V2_2"

export function buildId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + event.logIndex.toString()
}

export function isAfterV2_2(timestamp: BigInt): boolean {
  return timestamp.ge(BigInt.fromString(V2_2_MIGRATION_TIME))
}

export function bigIntMin(a: BigInt, b: BigInt): BigInt {
  if (a < b) {
    return a
  }
  return b
}

export function bigIntMax(a: BigInt, b: BigInt): BigInt {
  if (a > b) {
    return a
  }
  return b
}

export function bigDecimalMin(a: BigDecimal, b: BigDecimal): BigDecimal {
  if (a < b) {
    return a
  }
  return b
}

export function bigDecimalMax(a: BigDecimal, b: BigDecimal): BigDecimal {
  if (a > b) {
    return a
  }
  return b
}

export function bigDecimalToBigInt(n: BigDecimal): BigInt {
  return BigInt.fromString(n.toString().split(".")[0])
}
