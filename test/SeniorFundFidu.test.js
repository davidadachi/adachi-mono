/* global artifacts web3 */
const {expect, bigVal, getDeployedAsTruffleContract, expectAction} = require("./testHelpers.js")
const {OWNER_ROLE} = require("../blockchain_scripts/deployHelpers")
const hre = require("hardhat")
const {CONFIG_KEYS} = require("../blockchain_scripts/configKeys")
const {deployments} = hre
const GoldfinchConfig = artifacts.require("GoldfinchConfig")
const SeniorFundFidu = artifacts.require("SeniorFundFidu")

describe("SeniorFundFidu", () => {
  const testSetup = deployments.createFixture(async ({deployments, getNamedAccounts}) => {
    // Just to be crystal clear
    const {protocol_owner} = await getNamedAccounts()
    owner = protocol_owner

    await deployments.run("base_deploy")
    const fidu = await getDeployedAsTruffleContract(deployments, "SeniorFundFidu")

    return {fidu, goldfinchConfig}
  })

  let owner, person2, goldfinchConfig, fidu, accounts
  beforeEach(async () => {
    // Pull in our unlocked accounts
    accounts = await web3.eth.getAccounts()
    ;[owner, person2] = accounts

    goldfinchConfig = await GoldfinchConfig.new({from: owner})
    await goldfinchConfig.initialize(owner)

    fidu = await SeniorFundFidu.new({from: owner})
    await fidu.__initialize__(owner, "SeniorFundFidu", "sFIDU", goldfinchConfig.address)
  })

  describe("initialization", async () => {
    it("should not allow it to be called twice", async () => {
      return expect(
        fidu.__initialize__(person2, "SeniorFundFidu", "sFIDU", goldfinchConfig.address)
      ).to.be.rejectedWith(/has already been initialized/)
    })
  })

  describe("ownership", async () => {
    it("should be owned by the owner", async () => {
      expect(await fidu.hasRole(OWNER_ROLE, owner)).to.be.true
    })
  })

  describe("updateGoldfinchConfig", () => {
    describe("setting it", async () => {
      it("should allow the owner to set it", async () => {
        await goldfinchConfig.setAddress(CONFIG_KEYS.GoldfinchConfig, person2)
        return expectAction(() => fidu.updateGoldfinchConfig({from: owner})).toChange([
          [() => fidu.config(), {to: person2}],
        ])
      })
      it("should disallow non-owner to set", async () => {
        return expect(fidu.updateGoldfinchConfig({from: person2})).to.be.rejectedWith(/Must have minter role/)
      })
    })
  })

  describe("mintTo", async () => {
    beforeEach(async () => {
      // Use the full deployment so we have a pool, and the
      // mintTo function doesn't fail early on the assets/liabilites check
      const deployments = await testSetup()
      fidu = deployments.fidu
    })
    it("should allow the minter to call it", async () => {
      return expect(fidu.mintTo(person2, bigVal(0), {from: owner})).to.be.fulfilled
    })
    it("should not allow anyone else to call it", async () => {
      return expect(fidu.mintTo(person2, bigVal(0), {from: person2})).to.be.rejectedWith(/minter role/)
    })
  })
})
