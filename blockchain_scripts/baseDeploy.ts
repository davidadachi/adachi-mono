import {ethers} from "hardhat"
import BN from "bn.js"
import {CONFIG_KEYS} from "./configKeys"
import {
  USDCDecimals,
  OWNER_ROLE,
  MINTER_ROLE,
  updateConfig,
  getUSDCAddress,
  isTestEnv,
  setInitialConfigVals,
  SAFE_CONFIG,
  isMainnetForking,
  assertIsChainId,
  isSafeConfigChainId,
  leverageRatioAsBN,
} from "./deployHelpers"
import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"
import {
  GoldfinchConfig,
  GoldfinchFactory,
  Fidu,
  TransferRestrictedVault,
  Borrower,
  IFundStrategy,
  SeniorFund,
} from "../typechain/ethers"
import {Logger, DeployFn, DeployOpts} from "./types"
import {assertIsString} from "../utils/type"

let logger: Logger

const baseDeploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (isMainnetForking()) {
    return
  }
  const {deployments, getNamedAccounts, getChainId} = hre
  const {deploy, log} = deployments
  logger = log
  logger("Starting deploy...")
  const {protocol_owner, gf_deployer} = await getNamedAccounts()
  logger("Will be deploying using the protocol_owner account:", protocol_owner)

  const chainId = await getChainId()
  assertIsChainId(chainId)
  logger("Chain id is:", chainId)
  const config = await deployConfig(deploy)
  await getOrDeployUSDC()
  const fidu = await deployFidu(config)
  await deployPoolTokens(hre, {config})
  await deployTransferRestrictedVault(hre, {config})
  const pool = await deployPool(hre, {config})
  logger("Deploying TranchedPool")
  await deployTranchedPool(hre, {config})
  logger("Granting minter role to Pool")
  await grantMinterRoleToPool(fidu, pool)
  const creditDesk = await deployCreditDesk(deploy, {config})
  await deploySeniorFund(hre, {config, fidu})
  await deployBorrower(hre, {config})
  logger("Granting minter role to SeniorFund")
  await deploySeniorFundStrategy(hre, {config})
  logger("Deploying GoldfinchFactory")
  await deployGoldfinchFactory(deploy, {config})
  await deployClImplementation(hre, {config})

  logger("Granting ownership of Pool to CreditDesk")
  await grantOwnershipOfPoolToCreditDesk(pool, creditDesk.address)

  // Internal functions.

  async function deployConfig(deploy: DeployFn): Promise<GoldfinchConfig> {
    let contractName = "GoldfinchConfig"

    if (isTestEnv()) {
      contractName = "TestGoldfinchConfig"
    }

    assertIsString(gf_deployer)
    let deployResult = await deploy(contractName, {
      from: gf_deployer,
      gasLimit: 4000000,
    })
    logger("Config was deployed to:", deployResult.address)
    let config = (await ethers.getContractAt(deployResult.abi, deployResult.address)) as GoldfinchConfig
    if (deployResult.newlyDeployed) {
      logger("Config newly deployed, initializing...")
      assertIsString(protocol_owner)
      await (await config.initialize(protocol_owner)).wait()
    }

    await setInitialConfigVals(config, logger)

    return config
  }

  async function getOrDeployUSDC() {
    assertIsChainId(chainId)
    let usdcAddress = getUSDCAddress(chainId)
    if (!usdcAddress) {
      logger("We don't have a USDC address for this network, so deploying a fake USDC")
      const initialAmount = String(new BN("1000000").mul(USDCDecimals))
      const decimalPlaces = String(new BN(6))
      assertIsString(protocol_owner)
      const fakeUSDC = await deploy("TestERC20", {
        from: protocol_owner,
        gasLimit: 4000000,
        args: [initialAmount, decimalPlaces],
      })
      logger("Deployed the contract to:", fakeUSDC.address)
      usdcAddress = fakeUSDC.address
    }
    await updateConfig(config, "address", CONFIG_KEYS.USDC, usdcAddress, logger)
    return usdcAddress
  }

  async function deployGoldfinchFactory(deploy: DeployFn, {config}: DeployOpts): Promise<GoldfinchFactory> {
    logger("Deploying credit line factory")
    assertIsString(protocol_owner)
    const accountant = await deploy("Accountant", {from: protocol_owner, gasLimit: 4000000, args: []})
    assertIsString(gf_deployer)
    let goldfinchFactoryDeployResult = await deploy("GoldfinchFactory", {
      from: gf_deployer,
      proxy: {owner: gf_deployer,
        execute: {
          init: {
            methodName: "initialize",
            args: [protocol_owner, config.address],
          },
        },
      },
      gasLimit: 4000000,
      libraries: {
        ["Accountant"]: accountant.address,
      },
    })
    logger("GoldfinchFactory was deployed to:", goldfinchFactoryDeployResult.address)

    const goldfinchFactory = await ethers.getContractAt("GoldfinchFactory", goldfinchFactoryDeployResult.address)
    let goldfinchFactoryAddress = goldfinchFactory.address

    await updateConfig(config, "address", CONFIG_KEYS.GoldfinchFactory, goldfinchFactoryAddress, {logger})
    return goldfinchFactory as GoldfinchFactory
  }

  async function deployCreditDesk(deploy: DeployFn, {config}: DeployOpts) {
    assertIsString(protocol_owner)
    const accountant = await deploy("Accountant", {from: protocol_owner, gasLimit: 4000000, args: []})
    logger("Accountant was deployed to:", accountant.address)

    let contractName = "CreditDesk"

    if (isTestEnv()) {
      contractName = "TestCreditDesk"
    }

    logger("Deploying CreditDesk")
    assertIsString(gf_deployer)
    let creditDeskDeployResult = await deploy(contractName, {
      from: gf_deployer,
      proxy: {
        owner: gf_deployer,
        execute: {
          init: {
            methodName: "initialize",
            args: [protocol_owner, config.address],
          }
        },
      },
      gasLimit: 4000000,
      libraries: {["Accountant"]: accountant.address},
    })
    logger("Credit Desk was deployed to:", creditDeskDeployResult.address)
    let creditDeskAddress = creditDeskDeployResult.address
    await updateConfig(config, "address", CONFIG_KEYS.CreditDesk, creditDeskAddress, {logger})
    return await ethers.getContractAt(creditDeskDeployResult.abi, creditDeskDeployResult.address)
  }

  async function grantOwnershipOfPoolToCreditDesk(pool: any, creditDeskAddress: any) {
    const alreadyOwnedByCreditDesk = await pool.hasRole(OWNER_ROLE, creditDeskAddress)
    if (alreadyOwnedByCreditDesk) {
      // We already did this step, so early return
      logger("Looks like Credit Desk already is the owner")
      return
    }
    logger("Adding the Credit Desk as an owner")
    const txn = await pool.grantRole(OWNER_ROLE, creditDeskAddress)
    await txn.wait()
    const nowOwnedByCreditDesk = await pool.hasRole(OWNER_ROLE, creditDeskAddress)
    if (!nowOwnedByCreditDesk) {
      throw new Error(`Expected ${creditDeskAddress} to be an owner, but that is not the case`)
    }
  }

  async function deployFidu(config: GoldfinchConfig): Promise<Fidu> {
    logger("About to deploy Fidu...")
    assertIsString(gf_deployer)
    const fiduDeployResult = await deploy("Fidu", {
      from: gf_deployer,
      gasLimit: 4000000,
      proxy: {
        execute: {
          init: {
            methodName: "__initialize__",
            args: [protocol_owner, "Fidu", "FIDU", config.address],
          }
        }
      },
    })
    const fidu = (await ethers.getContractAt("Fidu", fiduDeployResult.address)) as Fidu
    let fiduAddress = fidu.address

    await updateConfig(config, "address", CONFIG_KEYS.Fidu, fiduAddress, {logger})
    logger("Deployed Fidu to address:", fidu.address)
    return fidu
  }
}

async function grantMinterRoleToPool(fidu: Fidu, pool: any) {
  if (!(await fidu.hasRole(MINTER_ROLE, pool.address))) {
    await fidu.grantRole(MINTER_ROLE, pool.address)
  }
}

async function deployTranchedPool(hre: HardhatRuntimeEnvironment, {config}: DeployOpts) {
  const {deployments, getNamedAccounts} = hre
  const {deploy, log} = deployments
  const logger = log
  const {gf_deployer} = await getNamedAccounts()

  logger("About to deploy TranchedPool...")
  let contractName = "TranchedPool"

  if (isTestEnv()) {
    contractName = "TestTranchedPool"
  }

  assertIsString(gf_deployer)
  const tranchedPoolImpl = await deploy(contractName, {
    from: gf_deployer,
  })
  await updateConfig(config, "address", CONFIG_KEYS.TranchedPoolImplementation, tranchedPoolImpl.address, {logger})
  logger("Updated TranchedPool config address to:", tranchedPoolImpl.address)
  return tranchedPoolImpl
}

async function deployClImplementation(hre: HardhatRuntimeEnvironment, {config}: DeployOpts) {
  const {deployments, getNamedAccounts} = hre
  const {deploy} = deployments
  const {protocol_owner, gf_deployer} = await getNamedAccounts()

  assertIsString(protocol_owner)
  const accountant = await deploy("Accountant", {from: protocol_owner, gasLimit: 4000000, args: []})
  // Deploy the credit line as well so we generate the ABI
  assertIsString(gf_deployer)
  const clDeployResult = await deploy("CreditLine", {
    from: gf_deployer,
    gasLimit: 4000000,
    libraries: {["Accountant"]: accountant.address},
  })

  await updateConfig(config, "address", CONFIG_KEYS.CreditLineImplementation, clDeployResult.address)
}

async function deployMigratedTranchedPool(hre: HardhatRuntimeEnvironment, {config}: DeployOpts) {
  const {deployments, getNamedAccounts} = hre
  const {deploy, log} = deployments
  const logger = log
  const {gf_deployer} = await getNamedAccounts()

  logger("About to deploy MigratedTranchedPool...")
  let contractName = "MigratedTranchedPool"

  assertIsString(gf_deployer)
  const migratedTranchedPoolImpl = await deploy(contractName, {from: gf_deployer})
  await updateConfig(
    config,
    "address",
    CONFIG_KEYS.MigratedTranchedPoolImplementation,
    migratedTranchedPoolImpl.address,
    {logger}
  )
  logger("Updated MigratedTranchedPool config address to:", migratedTranchedPoolImpl.address)
  return migratedTranchedPoolImpl
}

async function deployTransferRestrictedVault(
  hre: HardhatRuntimeEnvironment,
  {config}: DeployOpts
): Promise<TransferRestrictedVault> {
  const {deployments, getNamedAccounts, getChainId} = hre
  const {deploy, log} = deployments
  const logger = log
  const {protocol_owner, gf_deployer} = await getNamedAccounts()
  assertIsString(protocol_owner)
  assertIsString(gf_deployer)
  const chainId = await getChainId()
  assertIsChainId(chainId)

  let contractName = "TransferRestrictedVault"

  logger(`About to deploy ${contractName}...`)
  const deployResult = await deploy(contractName, {
    from: gf_deployer,
    proxy: {
      execute: {
        init: {
          methodName: "__initialize__",
          args: [isSafeConfigChainId(chainId) ? SAFE_CONFIG[chainId] : protocol_owner, config.address],
        }
      }
    },
  })
  const contract = (await ethers.getContractAt(contractName, deployResult.address)) as TransferRestrictedVault
  return contract
}

async function deployPoolTokens(hre: HardhatRuntimeEnvironment, {config}: DeployOpts) {
  const {deployments, getNamedAccounts, getChainId} = hre
  const {deploy, log} = deployments
  const logger = log
  const {protocol_owner, gf_deployer} = await getNamedAccounts()
  assertIsString(protocol_owner)
  assertIsString(gf_deployer)
  const chainId = await getChainId()
  assertIsChainId(chainId)

  let contractName = "PoolTokens"

  if (isTestEnv()) {
    contractName = "TestPoolTokens"
  }

  logger("About to deploy Pool Tokens...")
  const poolTokensDeployResult = await deploy(contractName, {
    from: gf_deployer,
    proxy: {
      execute: {
        init: {
          methodName: "__initialize__",
          args: [isSafeConfigChainId(chainId) ? SAFE_CONFIG[chainId] : protocol_owner, config.address],
        },
      },
    },
  })
  logger("Initialized Pool Tokens...")
  await updateConfig(config, "address", CONFIG_KEYS.PoolTokens, poolTokensDeployResult.address, {logger})
  const poolTokens = await ethers.getContractAt(contractName, poolTokensDeployResult.address)
  logger("Updated PoolTokens config address to:", poolTokens.address)
  return poolTokens
}

async function deployPool(hre: HardhatRuntimeEnvironment, {config}: DeployOpts) {
  let contractName = "Pool"
  if (isTestEnv()) {
    contractName = "TestPool"
  }
  const {deployments, getNamedAccounts} = hre
  const {deploy, log} = deployments
  const logger = log
  const {protocol_owner, gf_deployer} = await getNamedAccounts()

  assertIsString(gf_deployer)
  let poolDeployResult = await deploy(contractName, {
    from: gf_deployer,
    proxy: {
      execute: {
        init: {
          methodName: "initialize",
          args: [protocol_owner, config.address],
        }
      }
    },
  })
  logger("Pool was deployed to:", poolDeployResult.address)
  const pool = await ethers.getContractAt(contractName, poolDeployResult.address)
  let poolAddress = pool.address
  await updateConfig(config, "address", CONFIG_KEYS.Pool, poolAddress, {logger})

  return pool
}

async function deploySeniorFund(hre: HardhatRuntimeEnvironment, {config, fidu}: DeployOpts): Promise<SeniorFund> {
  let contractName = "SeniorFund"
  if (isTestEnv()) {
    contractName = "TestSeniorFund"
  }
  const {deployments, getNamedAccounts} = hre
  const {deploy, log} = deployments
  const logger = log
  const {protocol_owner, gf_deployer} = await getNamedAccounts()

  assertIsString(protocol_owner)
  const accountant = await deploy("Accountant", {from: protocol_owner, gasLimit: 4000000, args: []})
  logger("Accountant was deployed to:", accountant.address)

  assertIsString(gf_deployer)
  let deployResult = await deploy(contractName, {
    from: gf_deployer,
    proxy: {
      execute: {
        init: {
          methodName: "initialize",
          args: [protocol_owner, config.address],
        },
      }
    },
    libraries: {["Accountant"]: accountant.address},
  })
  logger("SeniorFund was deployed to:", deployResult.address)
  const fund = (await ethers.getContractAt(contractName, deployResult.address)) as SeniorFund
  await updateConfig(config, "address", CONFIG_KEYS.SeniorFund, fund.address, {logger})
  await config.addToGoList(fund.address)
  if (fidu) {
    await grantMinterRoleToPool(fidu, fund)
  }
  return fund
}

async function deploySeniorFundStrategy(hre: HardhatRuntimeEnvironment, {config}: DeployOpts): Promise<IFundStrategy> {
  let contractName = "FixedLeverageRatioStrategy"
  const {deployments, getNamedAccounts} = hre
  const {deploy, log} = deployments
  const logger = log
  const {gf_deployer} = await getNamedAccounts()

  assertIsString(gf_deployer)
  let deployResult = await deploy(contractName, {
    from: gf_deployer,
    args: [leverageRatioAsBN("4").toString()],
  })
  logger("FixedLeverageRatioStrategy was deployed to:", deployResult.address)
  const strategy = (await ethers.getContractAt(contractName, deployResult.address)) as IFundStrategy
  await updateConfig(config, "address", CONFIG_KEYS.SeniorFundStrategy, strategy.address, {logger})

  return strategy
}

async function deployBorrower(hre: HardhatRuntimeEnvironment, {config}: DeployOpts): Promise<Borrower> {
  let contractName = "Borrower"
  const {deployments, getNamedAccounts} = hre
  const {deploy, log} = deployments
  const logger = log
  const {gf_deployer} = await getNamedAccounts()

  assertIsString(gf_deployer)
  let deployResult = await deploy(contractName, {
    from: gf_deployer,
  })
  logger("Borrower implementation was deployed to:", deployResult.address)
  const borrower = (await ethers.getContractAt(contractName, deployResult.address)) as Borrower
  await updateConfig(config, "address", CONFIG_KEYS.BorrowerImplementation, borrower.address, {logger})

  return borrower
}

module.exports = {
  baseDeploy,
  deployPoolTokens,
  deployTransferRestrictedVault,
  deployTranchedPool,
  deploySeniorFund,
  deployMigratedTranchedPool,
  deploySeniorFundStrategy,
  deployBorrower,
  deployClImplementation,
}
