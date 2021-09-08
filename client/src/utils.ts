import _ from "lodash"
import {AsyncReturnType} from "./types/util"
import web3 from "./web3"

function croppedAddress(address) {
  if (!address) {
    return ""
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function displayNumber(val, decimals) {
  if (val === "") {
    return ""
  }
  const valFloat = parseFloat(val)
  if (!decimals && Math.floor(valFloat) === valFloat) {
    decimals = 0
  } else if (!decimals) {
    decimals = valFloat.toString().split(".")[1]?.length || 0
  }

  return commaFormat(valFloat.toFixed(decimals))
}

function commaFormat(numberString) {
  if (isNaN(numberString)) {
    return numberString
  }
  const [beforeDecimal, afterDecimal] = numberString.split(".")
  let withCommas: string[] = []
  _.reverse(_.split(beforeDecimal, "")).forEach((letter, i) => {
    if (i % 3 === 0 && i > 0) {
      withCommas.push(",")
    }
    withCommas.push(letter)
  })

  const decimalString = afterDecimal ? "." + afterDecimal : ""

  return `${_.join(_.reverse(withCommas), "")}${decimalString}`
}

function displayDollars(val, decimals = 2) {
  let prefix = ""
  if (!isFinite(val)) {
    return " --.--"
  }
  const valFloat = parseFloat(val)
  if (valFloat < 0) {
    val = valFloat * -1
    prefix = "-"
  }
  if (valFloat < 0.01 && valFloat > 0) {
    return "<$0.01"
  }
  return `${prefix}$${displayNumber(val, decimals)}`
}

function displayPercent(val, decimals = 2) {
  let valDisplay
  if (!val || isNaN(val)) {
    valDisplay = "--.--"
  } else {
    valDisplay = displayNumber(val.multipliedBy(100), decimals)
  }
  return `${valDisplay}%`
}

function roundUpPenny(val) {
  return Math.ceil(val * 100) / 100
}

function roundDownPenny(val) {
  return Math.floor(val * 100) / 100
}

function secondsSinceEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

export class AssertionError extends Error {}

export function assertError(val: unknown): asserts val is Error {
  if (!(val instanceof Error)) {
    throw new AssertionError(`Value ${val} is not an instance of Error.`)
  }
}

export function assertNonNullable<T>(val: T | null | undefined): asserts val is NonNullable<T> {
  if (val === null || val === undefined) {
    throw new AssertionError(`Value ${val} is not non-nullable.`)
  }
}

export async function getCurrentBlock() {
  return await web3.eth.getBlock("latest")
}

type BlockInfo = {
  number: number
  timestamp: number
}

export function getBlockInfo(block: AsyncReturnType<typeof getCurrentBlock>): BlockInfo {
  if (typeof block.timestamp !== "number") {
    throw new Error(`Timestamp of block ${block.number} is not a number: ${block.timestamp}`)
  }
  return {
    number: block.number,
    timestamp: block.timestamp,
  }
}

export {croppedAddress, displayNumber, displayDollars, roundUpPenny, roundDownPenny, displayPercent, secondsSinceEpoch}
