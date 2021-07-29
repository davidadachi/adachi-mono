const {toTruffle} = require("../../test/testHelpers")
const hre = require("hardhat")
const {
  deployPoolTokens,
  deploySeniorPool,
  deployTranchedPool,
  deployMigratedTranchedPool,
  deploySeniorPoolStrategy,
  deployBorrower,
  deployClImplementation,
} = require("../baseDeploy")

async function deployV2(contracts, asTruffle = true) {
  const config = contracts.GoldfinchConfig.UpgradedContract
  const fidu = contracts.Fidu.UpgradedContract
  let seniorPool = await deploySeniorPool(hre, {config, fidu})
  let seniorPoolStrategy = await deploySeniorPoolStrategy(hre, {config})
  let tranchedPool = await deployTranchedPool(hre, {config})
  let poolTokens = await deployPoolTokens(hre, {config})
  let migratedTranchedPool = await deployMigratedTranchedPool(hre, {config})
  if (asTruffle) {
    seniorPool = await toTruffle(seniorPool, "SeniorPool")
    seniorPoolStrategy = await toTruffle(seniorPoolStrategy, "IFundStrategy")
    tranchedPool = await toTruffle(tranchedPool, "TranchedPool")
    poolTokens = await toTruffle(poolTokens, "PoolTokens")
    migratedTranchedPool = await toTruffle(migratedTranchedPool, "MigratedTranchedPool")
  }
  await deployClImplementation(hre, {config})
  await deployBorrower(hre, {config})
  await contracts.GoldfinchConfig.UpgradedContract.bulkAddToGoList([seniorPool.address])
  return {seniorPool, seniorPoolStrategy, tranchedPool, poolTokens, migratedTranchedPool}
}

module.exports = deployV2
