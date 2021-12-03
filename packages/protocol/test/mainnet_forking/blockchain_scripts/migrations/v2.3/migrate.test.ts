import {getNamedAccounts, deployments} from "hardhat"
import {fundWithWhales} from "@goldfinch-eng/protocol/blockchain_scripts/mainnetForkingHelpers"
import {assertIsString} from "@goldfinch-eng/utils"
import * as migrate22 from "@goldfinch-eng/protocol/blockchain_scripts/migrations/v2.2/migrate"
import * as migrate from "@goldfinch-eng/protocol/blockchain_scripts/migrations/v2.3/migrate"
import {getEthersContract, getTruffleContract} from "@goldfinch-eng/protocol/blockchain_scripts/deployHelpers"
import {Awaited} from "@goldfinch-eng/protocol/blockchain_scripts/types"
import {TEST_TIMEOUT} from "../../../MainnetForking.test"
import {Deployment} from "hardhat-deploy/types"
import {CONFIG_KEYS} from "@goldfinch-eng/protocol/blockchain_scripts/configKeys"
import {GoldfinchConfig, GoldfinchFactory} from "@goldfinch-eng/protocol/typechain/ethers"
import {GoInstance} from "@goldfinch-eng/protocol/typechain/truffle"

const performMigration = deployments.createFixture(async ({deployments}) => {
  await deployments.fixture("base_deploy", {keepExistingDeployments: true})
  await migrate22.main()
  return await migrate.main()
})

describe("v2.3 migration", async function () {
  this.timeout(TEST_TIMEOUT)

  let migration: Awaited<ReturnType<typeof migrate.main>>
  let oldGoDeployment: Deployment,
    oldSeniorPoolDeployment: Deployment,
    oldUniqueIdentityDeployment: Deployment,
    oldPoolTokensDeployment: Deployment,
    oldTranchedPoolDeployment: Deployment,
    oldGoldfinchConfigDeployment: Deployment

  let oldDeployments: {
    [key: string]: Deployment
  }

  before(async () => {
    // We need to store the old config address because deployments don't get reset
    // due to the use of keepExistingDeployments above (which is needed for mainnet-forking tests)
    oldGoDeployment = await deployments.get("Go")
    oldSeniorPoolDeployment = await deployments.get("SeniorPool")
    oldUniqueIdentityDeployment = await deployments.get("UniqueIdentity")
    oldPoolTokensDeployment = await deployments.get("PoolTokens")
    oldTranchedPoolDeployment = await deployments.get("TranchedPool")
    oldGoldfinchConfigDeployment = await deployments.get("GoldfinchConfig")
    oldDeployments = {
      PoolTokens: oldPoolTokensDeployment,
      UniqueIdentity: oldUniqueIdentityDeployment,
      SeniorPool: oldSeniorPoolDeployment,
      Go: oldGoDeployment,
    }
  })

  beforeEach(async () => {
    const {gf_deployer} = await getNamedAccounts()
    assertIsString(gf_deployer)
    await fundWithWhales(["ETH"], [gf_deployer])
  })

  context("token launch", async () => {
    let goldfinchConfigDeployment: Deployment, goldfinchConfig: GoldfinchConfig
    let goldfinchFactoryDeployment: Deployment, goldfinchFactory: GoldfinchFactory
    let goDeployment: Deployment, go: GoInstance
    beforeEach(async () => {
      migration = await performMigration()
      goldfinchConfigDeployment = await deployments.get("GoldfinchConfig")
      goldfinchConfig = await getEthersContract<GoldfinchConfig>("GoldfinchConfig", {
        at: goldfinchConfigDeployment.address,
      })
      goldfinchFactoryDeployment = await deployments.get("GoldfinchFactory")
      goldfinchFactory = await getEthersContract<GoldfinchFactory>("GoldfinchFactory", {
        at: goldfinchFactoryDeployment.address,
      })
      goDeployment = await deployments.get("Go")
      go = await getTruffleContract<GoInstance>("Go", {at: goDeployment.address})
    })
    it("upgrades new contracts", async () => {
      const updateConfigContracts = ["PoolTokens", "SeniorPool", "UniqueIdentity", "Go"]
      for (const contractName of updateConfigContracts) {
        const newDeployment: Deployment = await deployments.get(contractName)
        const newUpgradedContract = migration.upgradedContracts[contractName]
        expect(newDeployment.address).to.eq(oldDeployments[contractName]?.address)
        expect(newDeployment.address).to.eq(newUpgradedContract?.ProxyContract.address)
        expect(newDeployment.address).to.not.eq(newUpgradedContract?.UpgradedImplAddress)
        const contract = await getEthersContract(contractName)

        // UID has no knowledge of GoldfinchConfig
        if (contractName != "UniqueIdentity") {
          // config points to new contract
          expect(await goldfinchConfig.getAddress(CONFIG_KEYS[contractName])).to.eq(newDeployment.address)
          // contract points to goldfinch config
          expect(await contract.config()).to.eq(goldfinchConfig.address)
        }
      }
    })

    it("Deploy TranchedPool and set TranchedPoolImplementation to new contract", async () => {
      const newDeployment: Deployment = await deployments.get("TestTranchedPool")
      const newDeployedContract = migration.deployedContracts.tranchedPool
      expect(newDeployment.address).to.eq(newDeployedContract.address)
      expect(oldTranchedPoolDeployment.address).to.not.eq(newDeployment.address)

      // config points to new contract
      expect(await goldfinchConfig.getAddress(CONFIG_KEYS.TranchedPoolImplementation)).to.eq(
        newDeployedContract.address
      )
      // note: contract.config() is 0x because it is deployed by deployMinimal in createPool
    })

    it("Deploy BackerRewards", async () => {
      const newDeployment: Deployment = await deployments.get("TestBackerRewards")
      const newDeployedContract = migration.deployedContracts.backerRewards
      expect(newDeployment.address).to.eq(newDeployedContract.address)
      console.log(await goldfinchConfig.getAddress(CONFIG_KEYS.BackerRewards))

      // config points to new contract
      expect(await goldfinchConfig.getAddress(CONFIG_KEYS.BackerRewards)).to.eq(newDeployedContract.address)

      // contract points to goldfinch config
      const contract = await getEthersContract("TestBackerRewards")
      expect(await contract.config()).to.eq(goldfinchConfig.address)
    })

    describe("GoldfinchFactory", async () => {
      it("OWNER_ROLE is the admin of BORROWER_ROLE", async () => {
        const ownerRole = await goldfinchFactory.OWNER_ROLE()
        const borrowerRole = await goldfinchFactory.BORROWER_ROLE()
        expect(await goldfinchFactory.getRoleAdmin(borrowerRole)).to.be.eq(ownerRole)
      })
    })

    describe("Go", async () => {
      const KNOWN_ADDRESS_ON_GO_LIST = "0x483e2BaF7F4e0Ac7D90c2C3Efc13c3AF5050F3c2"
      const GOLDFINCH_CONFIG_ADDRESS_WITH_GO_LIST = "0x4eb844Ff521B4A964011ac8ecd42d500725C95CC"

      describe("allIdTypes", async () => {
        it("is initialized", async () => {
          expect(await go.allIdTypes(0)).to.bignumber.eq(await go.ID_TYPE_0())
          expect(await go.allIdTypes(1)).to.bignumber.eq(await go.ID_TYPE_1())
          expect(await go.allIdTypes(2)).to.bignumber.eq(await go.ID_TYPE_2())
          expect(await go.allIdTypes(3)).to.bignumber.eq(await go.ID_TYPE_3())
          expect(await go.allIdTypes(4)).to.bignumber.eq(await go.ID_TYPE_4())
          expect(await go.allIdTypes(5)).to.bignumber.eq(await go.ID_TYPE_5())
          expect(await go.allIdTypes(6)).to.bignumber.eq(await go.ID_TYPE_6())
          expect(await go.allIdTypes(7)).to.bignumber.eq(await go.ID_TYPE_7())
          expect(await go.allIdTypes(8)).to.bignumber.eq(await go.ID_TYPE_8())
          expect(await go.allIdTypes(9)).to.bignumber.eq(await go.ID_TYPE_9())
          expect(await go.allIdTypes(10)).to.bignumber.eq(await go.ID_TYPE_10())
        })
      })

      it("has the config with the go list set as the goListOverride", async () => {
        expect(await go.legacyGoList()).to.be.eq(GOLDFINCH_CONFIG_ADDRESS_WITH_GO_LIST)
      })

      it("goListOverride is working correctly", async () => {
        expect(await go.go(KNOWN_ADDRESS_ON_GO_LIST)).to.be.true
        const goldfinchConfigDeployment = await deployments.get("GoldfinchConfig")
        const goldfinchConfig = await getEthersContract<GoldfinchConfig>("GoldfinchConfig", {
          at: goldfinchConfigDeployment.address,
        })

        expect(await goldfinchConfig.goList(KNOWN_ADDRESS_ON_GO_LIST)).to.be.false
      })
    })

    // it(write tests for storage slots)
  })
})
