import fetch from "node-fetch"
import fs from "fs"
import hre from "hardhat"
import {Network} from "defender-base-client"

import {getDeployedContract} from "./deployHelpers"
import {default as DefenderProposer} from "./DefenderProposer"
import {asNonNullable} from "@goldfinch-eng/utils"

const personaAPIKey = process.env.PERSONA_API_KEY

let requests = 0

async function fetchEntities(entity, paginationToken, filter) {
  let url = `https://withpersona.com/api/v1/${entity}?${filter}`
  if (paginationToken) {
    url = `${url}&page[after]=${paginationToken}`
  }

  const options = {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Persona-Version": "2020-01-13",
      Authorization: `Bearer ${personaAPIKey}`,
    },
  }

  requests = requests + 1

  if (requests % 250 === 0) {
    console.log("Sleeping for rate limit")
    await new Promise((resolve) => setTimeout(resolve, 60000))
  }

  return fetch(url, options)
    .then((res) => res.json())
    .catch((err) => console.error("error:" + err))
}

interface Account {
  id: string
  inquiryId: string
  status: string
  countryCode: string
  email: string | null
  verificationCountryCode: string | null
  golisted?: boolean
}

interface AllAccounts {
  [id: string]: Account
}

async function fetchAllAccounts(): Promise<AllAccounts> {
  let paginationToken = null
  const allAccounts = {}
  let response
  do {
    response = await fetchEntities("events", paginationToken, "filter[name]=inquiry.approved")
    for (const event of response.data) {
      const payload = event.attributes.payload
      const account = payload.included.find((i) => i.type === "account")
      const referenceId = account.attributes.referenceId
      if (referenceId && payload.data.attributes.status === "approved") {
        const verification = payload.included.find((included) => included.type === "verification/government-id")
        const customFields = payload.data.attributes.fields
        if (allAccounts[referenceId]) {
          console.log(
            `${referenceId} already has an approved inquiry ${allAccounts[referenceId].inquiryId}, skipping ${payload.data.id}`
          )
          continue
        }
        allAccounts[referenceId] = {
          id: referenceId,
          inquiryId: payload.data.id,
          status: account.attributes.tags,
          countryCode: account.attributes.countryCode,
          email: account.attributes.emailAddress || null,
          verificationCountryCode: verification.attributes.countryCode || null,
        }
      }
      paginationToken = event.id
    }
  } while (response.data.length > 0)
  return allAccounts
}

class AddToGoListProposer extends DefenderProposer {
  async proposeBulkAddToGoList(accounts, configAddress) {
    const numAccounts = accounts.length
    if (!numAccounts) {
      this.logger("No accounts to propose adding via a Defender proposal.")
      return
    }

    this.logger(`Proposing adding ${numAccounts} to the go-list on GoldfinchConfig ${configAddress}`)
    await this.client.createProposal({
      contract: {address: configAddress, network: this.network as Network}, // Target contract
      title: "Add to go-list",
      description: `Add to go-list on GoldfinchConfig ${configAddress}`,
      type: "custom",
      functionInterface: {
        name: "bulkAddToGoList",
        inputs: [
          {
            internalType: "address[]",
            name: "_members",
            type: "address[]",
          },
        ],
      },
      functionInputs: [accounts],
      via: this.safeAddress,
      viaType: "Gnosis Safe", // Either Gnosis Safe or Gnosis Multisig
    })
    this.logger("Defender URL: ", this.defenderUrl(configAddress))
  }
}

async function main() {
  if (!personaAPIKey) {
    console.log("Persona API key is missing. Please prepend the command with PERSONA_API_KEY=#KEY#")
    return
  }

  const {deployments} = hre
  const config = await getDeployedContract(deployments, "GoldfinchConfig")

  console.log("Fetching accounts")
  const approvedAccounts = Object.values(await fetchAllAccounts())
  const total = approvedAccounts.length
  let processedAccounts = 0
  for (const account of approvedAccounts) {
    account.countryCode = account.countryCode || asNonNullable(account.verificationCountryCode)
    account.golisted = await retry(3, () => config.goList(account.id))
    processedAccounts += 1
    if (processedAccounts % 100 === 0) {
      console.log(`${processedAccounts}/${total} complete`)
    }
  }

  const accountsToAdd: string[] = []
  for (const account of approvedAccounts) {
    // If the account is US based or if we don't know the country code for sure, skip
    if (!account.countryCode || account.countryCode === "" || account.countryCode === "US") {
      continue
    }

    // If already golisted, ignore
    if (account.golisted) {
      continue
    }
    accountsToAdd.push(account.id)
  }

  for (let i = 0; i < accountsToAdd.length; i++) {
    if (i === accountsToAdd.length - 1) {
      console.log(`"${accountsToAdd[i]}"`)
    } else {
      console.log(`"${accountsToAdd[i]}",`)
    }
  }

  const writeStream = fs.createWriteStream("accounts.csv")
  writeStream.write("address, country_code, golisted, email\n")
  for (const account of approvedAccounts) {
    writeStream.write(`"${account.id}", ${account.countryCode}, ${account.golisted}, ${account.email}\n`)
  }
  writeStream.end()
  await new Promise<void>((resolve) => {
    writeStream.on("finish", () => {
      console.log("\nAll accounts exported to accounts.csv")
      resolve()
    })
  })

  const {getChainId} = hre
  const chainId = await getChainId()
  await new AddToGoListProposer({hre, logger: console.log, chainId}).proposeBulkAddToGoList(
    accountsToAdd,
    config.address
  )
}

async function retry(maxRetries, func) {
  try {
    return await func()
  } catch (e) {
    if (maxRetries <= 0) {
      throw e
    }
    console.log("Retrying " + (e as Error).message)
    return retry(maxRetries - 1, func)
  }
}

if (require.main === module) {
  // If this is run as a script, then call main. If it's imported (for tests), this block will not run
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}

export default main
