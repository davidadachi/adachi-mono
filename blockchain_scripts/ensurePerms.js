const {
  getDeployedContract,
  updateConfig,
  CONFIG_KEYS,
  SAFE_CONFIG,
  OWNER_ROLE,
  PAUSER_ROLE,
  MINTER_ROLE,
} = require("./deployHelpers.js")
const hre = require("hardhat")

/*
This script ensures the permissions on the contracts are correct. Run this after the first deploy
to transfer ownership to the safe, and to grant to OWNER_ROLE to the safe.
*/
let logger

async function main() {
  await ensurePerms(hre)
}

async function ensurePerms(hre) {
  const {getNamedAccounts, getChainId} = hre
  const {proxy_owner, protocol_owner} = await getNamedAccounts()

  // Since this is not a "real" deployment (just a script),
  //the deployments.log is not enabled. So, just use console.log instead
  logger = console.log

  const chainId = await getChainId()

  if (!SAFE_CONFIG[chainId]) {
    throw new Error(`Unsupported chain id: ${chainId}`)
  }

  let contractsToUpgrade = process.env.CONTRACTS || "GoldfinchConfig, CreditLineFactory, CreditDesk, Pool, Fidu"
  contractsToUpgrade = contractsToUpgrade.split(/[ ,]+/)
  await ensurePermsOnContracts(contractsToUpgrade, proxy_owner, protocol_owner, hre)
  logger("Done.")
}

async function ensurePermsOnContracts(contractNames, proxy_owner, protocol_owner, hre) {
  const {deployments, getChainId} = hre
  const safeAddress = SAFE_CONFIG[await getChainId()].safeAddress

  const result = {}

  for (let i = 0; i < contractNames.length; i++) {
    let contractName = contractNames[i]
    let contract = await getDeployedContract(deployments, contractName)
    let contractProxy = await getDeployedContract(deployments, `${contractName}_Proxy`)
    const admin = await contractProxy.owner()

    if (admin.toLowerCase() !== safeAddress.toLowerCase()) {
      logger(`Converting safe ${safeAddress} as the proxy owner for ${contractName}`)
      const contractAsAdmin = await getDeployedContract(deployments, `${contractName}_Proxy`, proxy_owner)
      const txn = await contractAsAdmin.transferOwnership(safeAddress)
      await txn.wait()
    }

    if (contractName === "GoldfinchConfig") {
      // Ensure the safeAddress is marked as the protocol admin on the config
      await updateConfig(contract, "address", CONFIG_KEYS.ProtocolAdmin, safeAddress)
      const treasureReserveAddress = await contract.getAddress(CONFIG_KEYS.TreasuryReserve)
      if (treasureReserveAddress.toLowerCase() !== safeAddress.toLowerCase()) {
        logger(`Updating treasury reserve address to ${safeAddress}`)
        await contract.setTreasuryReserve(safeAddress)
      }
    }

    // Ensure owner is at the end, so we revoke that last
    let roles = ["pauser", "owner"]
    if (contractName === "Fidu") {
      roles = ["minter", "pauser", "owner"]
    }
    await ensureRoles(contractName, contract, safeAddress, protocol_owner, roles)
    logger(`Permissions updated for ${contractName}`)
  }
  return result
}

async function ensureRoles(contractName, contract, safeAddress, protocol_owner, roles) {
  const ROLE_MAP = {
    owner: OWNER_ROLE,
    pauser: PAUSER_ROLE,
    minter: MINTER_ROLE,
  }
  for (let i = 0; i < roles.length; i++) {
    let role = ROLE_MAP[roles[i]]
    if (!role) {
      throw new Error(`Unknown role: ${roles[i]}`)
    }
    // First grant the role to the safe if it doesn't have it
    if (!(await contract.hasRole(role, safeAddress))) {
      logger(`Granting safe ${safeAddress} the ${roles[i]} role for ${contractName}`)
      const txn = await contract.grantRole(role, safeAddress)
      await txn.wait()
    }
    // Then revoke the role from the protocol owner
    if (await contract.hasRole(role, protocol_owner)) {
      logger(`Revoking protocol owner ${protocol_owner} the ${roles[i]} role for ${contractName}`)
      const txn = await contract.revokeRole(role, protocol_owner)
      await txn.wait()
    }
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

module.exports = ensurePerms
