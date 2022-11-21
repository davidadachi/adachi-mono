import {ethers} from "ethers"
import {Relayer} from "defender-relay-client"
import {DefenderRelaySigner, DefenderRelayProvider} from "defender-relay-client/lib/ethers"
import axios from "axios"
import {asNonNullable, INVALID_POOLS} from "@goldfinch-eng/utils"
import baseHandler from "../core/handler"

const CONFIG = {
  mainnet: {
    factoryAddress: "0xd20508E1E971b80EE172c73517905bfFfcBD87f9",
    poolTokensAddress: "0x57686612C601Cb5213b01AA8e80AfEb24BBd01df",
    seniorPoolAddress: "0x8481a6EbAf5c7DABc3F7e09e44A89531fd31F822",
    etherscanApi: "https://api.etherscan.io/api",
  },
}

// Entrypoint for the Autotask
exports.handler = baseHandler("assessor", async function (credentials) {
  const {etherscanApiKey} = credentials.secrets
  const relayer = new Relayer(credentials)
  const provider = new DefenderRelayProvider(credentials)
  const signer = new DefenderRelaySigner(credentials, provider, {speed: "fast"})

  const relayerInfo = await relayer.getRelayer()
  console.log(`Assessing using ${relayerInfo.name} on ${relayerInfo.network} `)

  const config = CONFIG[relayerInfo.network]
  if (!config) {
    throw new Error(`Unsupported network: ${relayerInfo.network}`)
  }

  const goldfinchFactoryAddress = config.factoryAddress

  const factoryAbi = await getAbifor(config.etherscanApi, goldfinchFactoryAddress, provider, etherscanApiKey)
  const factory = new ethers.Contract(goldfinchFactoryAddress, factoryAbi, signer)
  const poolTokensAbi = await getAbifor(config.etherscanApi, config.poolTokensAddress, provider, etherscanApiKey)
  const poolTokens = new ethers.Contract(config.poolTokensAddress, poolTokensAbi, signer)
  const seniorPoolAbi = await getAbifor(config.etherscanApi, config.seniorPoolAddress, provider, etherscanApiKey)
  const seniorPool = new ethers.Contract(config.seniorPoolAddress, seniorPoolAbi, signer)

  const filter = asNonNullable(factory.filters.PoolCreated)
  const result = await factory.queryFilter(filter(null, null))

  let pools: string[] = []
  for (const poolCreated of result) {
    const poolAddress = asNonNullable(poolCreated.args?.pool)

    if (INVALID_POOLS.has(poolAddress.toLowerCase())) {
      console.log(`On denylist, skipping assessment of ${poolAddress}`)
      continue
    }

    pools = pools.concat(poolAddress)
  }

  if (pools.length === 0) {
    console.log("No pools to assess")
    return
  }

  const poolAbi = await getAbifor(config.etherscanApi, pools[0], provider, etherscanApiKey)
  const pool = new ethers.Contract(asNonNullable(pools[0]), poolAbi, signer)

  const creditLineAddress = await pool.creditLine()
  const creditLineAbi = await getAbifor(config.etherscanApi, creditLineAddress, provider, etherscanApiKey)
  const creditLine = new ethers.Contract(creditLineAddress, creditLineAbi, signer)

  console.log(`Found ${pools.length} tranched pools`)
  let success = 0
  for (const poolAddress of pools) {
    try {
      console.log(`Assessing ${poolAddress}`)
      await assessIfRequired(pool.attach(poolAddress), creditLine, provider, seniorPool, poolTokens)
      success += 1
    } catch (err) {
      console.log(`Error trying to assess creditline: ${err}`)
    }
  }

  console.log(`Successfully assessed ${success} of ${pools.length} pools`)

  if (success !== pools.length && relayerInfo.network === "mainnet") {
    throw new Error(`${pools.length - success} pools failed to asses`)
  }
})

const assessIfRequired = async function assessIfRequired(
  tranchedPool,
  creditLineContract,
  provider,
  seniorPool,
  poolTokens
) {
  // Normalize everything to ethers.BigNumber because tests use Truffle and therefore bn.js
  // which is incompatible with BigNumber
  const creditLineAddress = await tranchedPool.creditLine()
  const creditLine = creditLineContract.attach(creditLineAddress)
  const currentTime = ethers.BigNumber.from((await provider.getBlock("latest")).timestamp.toString())
  const nextDueTime = ethers.BigNumber.from((await creditLine.nextDueTime()).toString())
  const termEndTime = ethers.BigNumber.from((await creditLine.termEndTime()).toString())
  const limit = await creditLine.limit()

  if (limit.isZero()) {
    console.log(`Assess ${creditLine.address}: Skipped (Closed)`)
    return
  }

  if (nextDueTime.isZero()) {
    const balance = await creditLine.balance()
    if (!balance.isZero()) {
      throw new Error(`Non-zero balance (${balance}) for pool ${tranchedPool.address} without a nextDueTime`)
    }
    console.log(`Assess ${tranchedPool.address}: Skipped (Zero balance)`)
  } else {
    if (currentTime.gte(termEndTime)) {
      // Currently we don't have a good way to track the last time we assessed a creditLine past it's
      // term end block. So we're going to keep assessing it everytime the script runs for now.
      console.log(`Assessing pool beyond the end time: ${tranchedPool.address}`)
      await assessAndRedeem(tranchedPool, seniorPool, poolTokens)
    } else if (currentTime.gte(nextDueTime)) {
      console.log(`Assessing ${tranchedPool.address}`)
      await assessAndRedeem(tranchedPool, seniorPool, poolTokens)
    } else {
      const nextDueTimeFormatted = new Date(nextDueTime.toNumber() * 1000).toISOString()
      console.log(`Assess ${tranchedPool.address}: Skipped (Already assessed). Next Due: ${nextDueTimeFormatted}`)
    }
  }
}

async function assessAndRedeem(tranchedPool, seniorPool, poolTokens) {
  await tranchedPool.assess()

  // Now get the tokenId for the senior pool so we can redeem (or writedown if required)
  const result = await poolTokens.queryFilter(poolTokens.filters.TokenMinted(seniorPool.address, tranchedPool.address))

  for (const tokenMinted of result) {
    const tokenId = tokenMinted.args.tokenId
    console.log(`Redeeming token ${tokenId} from pool ${tranchedPool.address}`)
    // TODO: Uncomment once we have a "redeemer" role that can redeem/writedown
    // await seniorPool.redeem(tokenId)

    const writedownAmount = await seniorPool.calculateWritedown(tokenId)

    if (!writedownAmount.isZero()) {
      console.log(`Writedown for token ${tokenId} from pool ${tranchedPool.address}: ${writedownAmount.toString()}`)
      // TODO: Uncomment once we have a "redeemer" role that can redeem/writedown
      // await seniorPool.writedown(tokenId)
    }
  }
}

async function getAbifor(etherscanApiUrl, address, provider, etherscanApiKey: string) {
  // De-reference the proxy to the implementation if it is a proxy
  // https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v3.2.0/contracts/proxy/TransparentUpgradeableProxy.sol#L81
  const implStorageLocation = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
  let implementationAddress = await provider.getStorageAt(address, implStorageLocation)
  implementationAddress = ethers.utils.hexStripZeros(implementationAddress)
  if (implementationAddress !== "0x") {
    address = implementationAddress
  }

  // https://etherscan.io/apis#contracts
  const url = `${etherscanApiUrl}?module=contract&action=getabi&address=${address}&apikey=${etherscanApiKey}`
  const body = await axios.get(url)
  const bodyAsJson = body.data

  if (bodyAsJson.message !== "OK") {
    throw new Error(`Error fetching ABI for ${address}: ${bodyAsJson.result}`)
  }
  return JSON.parse(bodyAsJson.result)
}

// For tests
export {assessIfRequired}

// To run locally (this code will not be executed in Autotasks)
// Invoke with: API_KEY=<key> API_SECRET=<secret> node autotasks/assessor/dist/index.js
if (require.main === module) {
  const {API_KEY: apiKey, API_SECRET: apiSecret} = process.env
  exports
    .handler({apiKey, apiSecret})
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
