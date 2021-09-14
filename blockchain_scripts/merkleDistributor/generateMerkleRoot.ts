import {BigNumber} from "ethers"
import { program } from 'commander'
import fs from 'fs'
import { parseGrants } from './parseGrants'
import { AccountedGrant, isArrayOfAccountedGrant, isArrayOfJsonAccountedGrant, JsonAccountedGrant } from './types'

program
  .version('0.0.0')
  .requiredOption(
    '-i, --input <path>',
    'input JSON file location containing an array of JsonAccountedGrant objects'
  )

program.parse(process.argv)

const options = program.opts()
const json = JSON.parse(fs.readFileSync(options.input, { encoding: 'utf8' }))

if (!isArrayOfJsonAccountedGrant(json)) {
  throw new Error('Invalid JSON.')
}

const accountedGrants: AccountedGrant[] = json.map((info: JsonAccountedGrant) => ({
  account: info.account,
  grant: {
    amount: BigNumber.from(info.grant.amount),
    vestingLength: BigNumber.from(info.grant.vestingLength),
    cliffLength: BigNumber.from(info.grant.cliffLength),
    vestingInterval: BigNumber.from(info.grant.vestingInterval),
  }
}))

if (!isArrayOfAccountedGrant(accountedGrants)) {
  throw new Error('Failed to parse accounted grants.')
}

console.log(JSON.stringify(parseGrants(accountedGrants)))
