import {GoldfinchProtocol} from "./GoldfinchProtocol"
import {GFI as GFIContract} from "@goldfinch-eng/protocol/typechain/web3/GFI"
import BigNumber from "bignumber.js"

class GFI {
  goldfinchProtocol: GoldfinchProtocol
  contract: GFIContract
  address: string
  loaded: boolean

  constructor(goldfinchProtocol: GoldfinchProtocol) {
    this.goldfinchProtocol = goldfinchProtocol
    this.contract = goldfinchProtocol.getContract<GFIContract>("GFI")
    this.address = goldfinchProtocol.getAddress("GFI")
    this.loaded = true
  }

  async initialize() {}
}

const GFI_DECIMAL_PLACES = 18
const GFI_DECIMALS = new BigNumber(String(10 ** GFI_DECIMAL_PLACES))

function gfiFromAtomic(amount: BigNumber) {
  return amount.div(GFI_DECIMALS).toString(10)
}

function gfiToAtomic(amount: BigNumber) {
  return amount.multipliedBy(GFI_DECIMALS).toString(10)
}

export {GFI, GFI_DECIMAL_PLACES, GFI_DECIMALS, gfiFromAtomic, gfiToAtomic}
