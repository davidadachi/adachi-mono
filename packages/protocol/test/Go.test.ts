/* global web3 */
import hre from "hardhat"
import {constants as ethersConstants} from "ethers"
import {asNonNullable} from "@goldfinch-eng/utils"
import {getCurrentTimestamp, SECONDS_PER_DAY, ZERO_ADDRESS} from "./testHelpers"
import {getTruffleContract, GO_LISTER_ROLE, OWNER_ROLE, PAUSER_ROLE} from "../blockchain_scripts/deployHelpers"
import {
  GoInstance,
  GoldfinchConfigInstance,
  StakingRewardsInstance,
  TestUniqueIdentityInstance,
} from "../typechain/truffle"
import {burn, mint} from "./uniqueIdentityHelpers"
import {BN} from "ethereumjs-tx/node_modules/ethereumjs-util"
import {deployBaseFixture} from "./util/fixtures"
const {deployments} = hre

const setupTest = deployments.createFixture(async ({deployments}) => {
  const {deploy} = deployments
  const [_owner, _anotherUser, _anotherUser2, _anotherUser3] = await web3.eth.getAccounts()
  const owner = asNonNullable(_owner)
  const anotherUser = asNonNullable(_anotherUser)
  const anotherUser2 = asNonNullable(_anotherUser2)
  const uninitializedGoDeployer = asNonNullable(_anotherUser3)

  const deployed = await deployBaseFixture()

  const goldfinchConfig = deployed.goldfinchConfig
  const uniqueIdentity = deployed.uniqueIdentity
  const go = deployed.go

  const uninitializedGoDeployResult = await deploy("Go", {
    from: uninitializedGoDeployer,
    gasLimit: 4000000,
  })
  const uninitializedGo = await getTruffleContract<GoInstance>("Go", {
    at: uninitializedGoDeployResult.address,
  })

  return {
    owner,
    anotherUser,
    anotherUser2,
    go,
    uninitializedGo,
    uninitializedGoDeployer,
    goldfinchConfig,
    uniqueIdentity,
  }
})

describe("Go", () => {
  let owner: string,
    anotherUser: string,
    anotherUser2: string,
    go: GoInstance,
    uninitializedGoDeployer: string,
    uninitializedGo: GoInstance,
    goldfinchConfig: GoldfinchConfigInstance,
    uniqueIdentity: TestUniqueIdentityInstance

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({
      owner,
      anotherUser,
      anotherUser2,
      go,
      uninitializedGoDeployer,
      uninitializedGo,
      goldfinchConfig,
      uniqueIdentity,
    } = await setupTest())
  })

  async function pause(): Promise<void> {
    expect(await go.paused()).to.equal(false)
    await go.pause()
    expect(await go.paused()).to.equal(true)
  }

  describe("setLegacyGoList", async () => {
    const testAddress = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

    describe("when set with a valid GoldfinchConfig address", async () => {
      let goldfinchConfigWithGoList: GoldfinchConfigInstance
      beforeEach(async () => {
        const newConfigDeployment = await deployments.deploy("GoldfinchConfig", {
          from: owner,
        })
        goldfinchConfigWithGoList = await getTruffleContract<GoldfinchConfigInstance>("GoldfinchConfig", {
          at: newConfigDeployment.address,
        })

        await goldfinchConfigWithGoList.initialize(owner)
        await goldfinchConfigWithGoList.addToGoList(testAddress, {from: owner})
        await go.setLegacyGoList(goldfinchConfigWithGoList.address)
      })

      it("it should use the other config for the go list", async () => {
        expect(await go.go(testAddress)).to.be.true
      })
    })

    describe("by default", async () => {
      it("works correctly", async () => {
        expect(await go.go(testAddress)).to.be.false
        await goldfinchConfig.addToGoList(testAddress, {from: owner})
        expect(await go.go(testAddress)).to.be.true
      })
    })
  })

  describe("initialize", () => {
    it("rejects zero address owner", async () => {
      const initialized = uninitializedGo.initialize(
        ethersConstants.AddressZero,
        goldfinchConfig.address,
        uniqueIdentity.address
      )
      await expect(initialized).to.be.rejectedWith(/Owner and config and UniqueIdentity addresses cannot be empty/)
    })
    it("rejects zero address config", async () => {
      const initialized = uninitializedGo.initialize(owner, ethersConstants.AddressZero, uniqueIdentity.address)
      await expect(initialized).to.be.rejectedWith(/Owner and config and UniqueIdentity addresses cannot be empty/)
    })
    it("rejects zero address uniqueIdentity", async () => {
      const initialized = uninitializedGo.initialize(owner, goldfinchConfig.address, ethersConstants.AddressZero)
      await expect(initialized).to.be.rejectedWith(/Owner and config and UniqueIdentity addresses cannot be empty/)
    })
    it("grants owner the owner and pauser roles", async () => {
      await uninitializedGo.initialize(owner, goldfinchConfig.address, uniqueIdentity.address, {
        from: uninitializedGoDeployer,
      })
      expect(await uninitializedGo.hasRole(OWNER_ROLE, owner)).to.equal(true)
      expect(await uninitializedGo.hasRole(PAUSER_ROLE, owner)).to.equal(true)

      expect(await go.hasRole(OWNER_ROLE, owner)).to.equal(true)
      expect(await go.hasRole(PAUSER_ROLE, owner)).to.equal(true)
    })
    it("does not grant deployer the owner and pauser roles", async () => {
      await uninitializedGo.initialize(owner, goldfinchConfig.address, uniqueIdentity.address, {
        from: uninitializedGoDeployer,
      })
      expect(await uninitializedGo.hasRole(OWNER_ROLE, uninitializedGoDeployer)).to.equal(false)
      expect(await uninitializedGo.hasRole(PAUSER_ROLE, uninitializedGoDeployer)).to.equal(false)
    })
    it("sets config and uniqueIdentity addresses in state", async () => {
      await uninitializedGo.initialize(owner, goldfinchConfig.address, uniqueIdentity.address, {
        from: uninitializedGoDeployer,
      })
      expect(await uninitializedGo.config()).to.equal(goldfinchConfig.address)
      expect(await uninitializedGo.uniqueIdentity()).to.equal(uniqueIdentity.address)

      expect(await go.config()).to.equal(goldfinchConfig.address)
      expect(await go.uniqueIdentity()).to.equal(uniqueIdentity.address)
    })
    it("cannot be called twice", async () => {
      await uninitializedGo.initialize(owner, goldfinchConfig.address, uniqueIdentity.address, {
        from: uninitializedGoDeployer,
      })
      await expect(
        uninitializedGo.initialize(anotherUser2, goldfinchConfig.address, uniqueIdentity.address, {
          from: uninitializedGoDeployer,
        })
      ).to.be.rejectedWith(/Contract instance has already been initialized/)
    })
  })

  describe("go", () => {
    context("go", () => {
      it("works for any id", async () => {
        for (let i = 0; i < go.allIdTypes.length; i++) {
          const tokenId = new BN(i)
          const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)

          // by induction, this demonstrates the account never had any uids for this whole test
          expect(await uniqueIdentity.balanceOf(anotherUser, tokenId)).to.bignumber.equal(new BN(0))

          await mint(hre, uniqueIdentity, tokenId, expiresAt, new BN(0), owner, undefined, anotherUser)
          expect(await uniqueIdentity.balanceOf(anotherUser, tokenId)).to.bignumber.equal(new BN(1))

          expect(await go.go(anotherUser)).to.equal(true)

          // cleanup
          await burn(hre, uniqueIdentity, anotherUser, tokenId, expiresAt, new BN(0), owner)
          expect(await uniqueIdentity.balanceOf(anotherUser, tokenId)).to.bignumber.equal(new BN(0))
        }
      })

      it("works for legacy go-list", async () => {
        expect(await goldfinchConfig.goList(anotherUser)).to.equal(false)
        await goldfinchConfig.addToGoList(anotherUser, {from: owner})
        expect(await goldfinchConfig.goList(anotherUser)).to.equal(true)

        expect(await go.go(anotherUser)).to.equal(true)
      })

      it("fails for no id", async () => {
        expect(await go.go(anotherUser)).to.equal(false)
      })
    })

    context("goOnlyIdTypes", () => {
      const tokenId0 = new BN(0)
      const tokenId1 = new BN(1)

      it("Validates zero address", async () => {
        await expect(go.goOnlyIdTypes(ZERO_ADDRESS, [])).to.be.rejectedWith(/Zero address is not go-listed/)
      })

      it("returns false for no ids", async () => {
        expect(await go.goOnlyIdTypes(anotherUser, [])).to.equal(false)
      })

      context("account with no UID", () => {
        beforeEach(async () => {
          expect(await goldfinchConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
          expect(await uniqueIdentity.balanceOf(anotherUser, tokenId0)).to.bignumber.equal(new BN(0))
        })

        it("account is on legacy go-list", async () => {
          expect(await goldfinchConfig.goList(anotherUser)).to.equal(false)
          await goldfinchConfig.addToGoList(anotherUser, {from: owner})
          expect(await goldfinchConfig.goList(anotherUser)).to.equal(true)

          expect(await go.goOnlyIdTypes(anotherUser, [0])).to.equal(true)
        })

        it("account is on legacy go-list, UID > 0", async () => {
          expect(await goldfinchConfig.goList(anotherUser)).to.equal(false)
          await goldfinchConfig.addToGoList(anotherUser, {from: owner})
          expect(await goldfinchConfig.goList(anotherUser)).to.equal(true)

          expect(await go.goOnlyIdTypes(anotherUser, [1])).to.equal(false)
        })

        it("account is not on legacy go-list", async () => {
          expect(await go.goOnlyIdTypes(anotherUser, [0])).to.equal(false)
        })
      })

      context("account with UID 0", () => {
        beforeEach(async () => {
          expect(await goldfinchConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)

          const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
          await uniqueIdentity.setSupportedUIDTypes([tokenId0, tokenId1], [true, true])
          await mint(hre, uniqueIdentity, tokenId0, expiresAt, new BN(0), owner, undefined, anotherUser)
          expect(await uniqueIdentity.balanceOf(anotherUser, tokenId0)).to.bignumber.equal(new BN(1))
        })

        context("calls for UIDs containing id 0", () => {
          it("passes if on legacy go-list", async () => {
            expect(await goldfinchConfig.goList(anotherUser)).to.equal(false)
            await goldfinchConfig.addToGoList(anotherUser, {from: owner})
            expect(await goldfinchConfig.goList(anotherUser)).to.equal(true)

            expect(await go.goOnlyIdTypes(anotherUser, [0])).to.equal(true)
          })

          it("passes", async () => {
            expect(await go.goOnlyIdTypes(anotherUser, [tokenId0])).to.equal(true)
          })

          context("through other contract", () => {
            it("approved address", async () => {
              await uniqueIdentity.setApprovalForAll(anotherUser2, true, {from: anotherUser})
              expect(await go.goOnlyIdTypes(anotherUser2, [tokenId0], {from: anotherUser})).to.equal(true)
            })

            it("approved address, wrong token", async () => {
              await uniqueIdentity.setApprovalForAll(anotherUser2, true, {from: anotherUser})
              expect(await go.goOnlyIdTypes(anotherUser2, [tokenId1], {from: anotherUser})).to.equal(false)
            })

            it("unapproved address", async () => {
              expect(await go.goOnlyIdTypes(anotherUser2, [tokenId0], {from: anotherUser})).to.equal(false)
            })
          })
        })

        context("calls for UIDs not containing id 0", () => {
          it("fails", async () => {
            expect(await go.goOnlyIdTypes(anotherUser, [tokenId1])).to.equal(false)
          })
        })
      })

      context("account with UID 1", () => {
        beforeEach(async () => {
          expect(await goldfinchConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)

          const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
          await uniqueIdentity.setSupportedUIDTypes([tokenId0, tokenId1], [true, true])
          await mint(hre, uniqueIdentity, tokenId1, expiresAt, new BN(0), owner, undefined, anotherUser)
          expect(await uniqueIdentity.balanceOf(anotherUser, tokenId1)).to.bignumber.equal(new BN(1))
        })

        context("calls for UIDs containing id 1", () => {
          it("passes", async () => {
            expect(await go.goOnlyIdTypes(anotherUser, [tokenId1])).to.equal(true)
          })

          context("through other contract", () => {
            it("approved address", async () => {
              await uniqueIdentity.setApprovalForAll(anotherUser2, true, {from: anotherUser})
              expect(await go.goOnlyIdTypes(anotherUser2, [tokenId1], {from: anotherUser})).to.equal(true)
            })

            it("approved address, wrong token", async () => {
              await uniqueIdentity.setApprovalForAll(anotherUser2, true, {from: anotherUser})
              expect(await go.goOnlyIdTypes(anotherUser2, [tokenId0], {from: anotherUser})).to.equal(false)
            })

            it("unapproved address", async () => {
              expect(await go.goOnlyIdTypes(anotherUser2, [tokenId1], {from: anotherUser})).to.equal(false)
            })
          })
        })

        context("calls for UIDs not containing id 1", () => {
          it("fails", async () => {
            expect(await go.goOnlyIdTypes(anotherUser, [tokenId0])).to.equal(false)
          })
        })
      })

      it("returns true if has UID and not legacy golisted", async () => {
        const tokenId = new BN(0)
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([tokenId], [true])
        await mint(hre, uniqueIdentity, tokenId, expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(await uniqueIdentity.balanceOf(anotherUser, tokenId)).to.bignumber.equal(new BN(1))
        expect(await goldfinchConfig.goList(anotherUser)).to.equal(false)
        expect(await go.goOnlyIdTypes(anotherUser, [tokenId])).to.equal(true)
      })

      it("returns true if legacy golisted and doesnt have UID", async () => {
        const tokenId = new BN(0)
        expect(await goldfinchConfig.goList(anotherUser)).to.equal(false)
        await goldfinchConfig.addToGoList(anotherUser, {from: owner})
        expect(await goldfinchConfig.goList(anotherUser)).to.equal(true)
        expect(await go.goOnlyIdTypes(anotherUser, [tokenId])).to.equal(true)
      })

      it("returns false if not legacy golisted and no included UID", async () => {
        const tokenId = new BN(0)
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([tokenId], [true])
        await mint(hre, uniqueIdentity, tokenId, expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(await uniqueIdentity.balanceOf(anotherUser, tokenId)).to.bignumber.equal(new BN(1))
        expect(await goldfinchConfig.goList(anotherUser)).to.equal(false)
        expect(await go.goOnlyIdTypes(anotherUser, [1])).to.equal(false)
      })
    })

    it("getSeniorPoolIdTypes", async () => {
      expect(await (await go.getSeniorPoolIdTypes()).map((x) => x.toNumber())).to.deep.equal([0, 1, 3, 4])
    })

    context("goSeniorPool", () => {
      it("Validates zero address", async () => {
        await expect(go.goSeniorPool(ZERO_ADDRESS)).to.be.rejectedWith(/Zero address is not go-listed/)
      })

      it("returns true if called by staking rewards contract", async () => {
        const uidTokenId = await uniqueIdentity.ID_TYPE_0()
        await uniqueIdentity.setSupportedUIDTypes([], [])
        expect(await uniqueIdentity.balanceOf(anotherUser, uidTokenId)).to.bignumber.equal(new BN(0))
        const stakingRewardsContract = await getTruffleContract<StakingRewardsInstance>("StakingRewards")
        await expect(go.goSeniorPool(stakingRewardsContract.address)).to.be.fulfilled
      })

      it("returns true if has non-US UID and not legacy golisted", async () => {
        const uidTokenId = await uniqueIdentity.ID_TYPE_0()
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([uidTokenId], [true])
        await mint(hre, uniqueIdentity, uidTokenId, expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(await uniqueIdentity.balanceOf(anotherUser, uidTokenId)).to.bignumber.equal(new BN(1))
        expect(await goldfinchConfig.goList(anotherUser)).to.equal(false)
        expect(await goldfinchConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
        expect(await go.goSeniorPool(anotherUser)).to.equal(true)
      })

      it("returns true if has US accredited UID and not legacy golisted", async () => {
        const uidTokenId = await uniqueIdentity.ID_TYPE_1()
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([uidTokenId], [true])
        await mint(hre, uniqueIdentity, uidTokenId, expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(await uniqueIdentity.balanceOf(anotherUser, uidTokenId)).to.bignumber.equal(new BN(1))
        expect(await goldfinchConfig.goList(anotherUser)).to.equal(false)
        expect(await goldfinchConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
        expect(await go.goSeniorPool(anotherUser)).to.equal(true)
      })

      it("returns true if has US entity UID and not legacy golisted", async () => {
        const uidTokenId = await uniqueIdentity.ID_TYPE_3()
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([uidTokenId], [true])
        await mint(hre, uniqueIdentity, uidTokenId, expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(await uniqueIdentity.balanceOf(anotherUser, uidTokenId)).to.bignumber.equal(new BN(1))
        expect(await goldfinchConfig.goList(anotherUser)).to.equal(false)
        expect(await goldfinchConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
        expect(await go.goSeniorPool(anotherUser)).to.equal(true)
      })

      it("returns true if has non US entity UID and not legacy golisted", async () => {
        const uidTokenId = await uniqueIdentity.ID_TYPE_4()
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([uidTokenId], [true])
        await mint(hre, uniqueIdentity, uidTokenId, expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(await uniqueIdentity.balanceOf(anotherUser, uidTokenId)).to.bignumber.equal(new BN(1))
        expect(await goldfinchConfig.goList(anotherUser)).to.equal(false)
        expect(await goldfinchConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
        expect(await go.goSeniorPool(anotherUser)).to.equal(true)
      })

      it("returns true if legacy golisted", async () => {
        expect(await goldfinchConfig.goList(anotherUser)).to.equal(false)
        expect(await goldfinchConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
        await goldfinchConfig.addToGoList(anotherUser, {from: owner})
        expect(await goldfinchConfig.goList(anotherUser)).to.equal(true)
        expect(await go.goSeniorPool(anotherUser)).to.equal(true)
      })

      it("returns false if not legacy golisted and no included UID", async () => {
        const uidTokenId = await uniqueIdentity.ID_TYPE_2()
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([uidTokenId], [true])
        await mint(hre, uniqueIdentity, uidTokenId, expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(await uniqueIdentity.balanceOf(anotherUser, uidTokenId)).to.bignumber.equal(new BN(1))
        expect(await goldfinchConfig.goList(anotherUser)).to.equal(false)
        expect(await goldfinchConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
        expect(await go.goSeniorPool(anotherUser)).to.equal(false)
      })

      it("returns true if account has ZAPPER_ROLE", async () => {
        await go.initZapperRole()
        expect(await go.goSeniorPool(anotherUser)).to.eq(false)
        await go.grantRole(await go.ZAPPER_ROLE(), anotherUser)
        expect(await go.goSeniorPool(anotherUser)).to.eq(true)
      })
    })

    context("initZapperRole", async () => {
      it("is only callable by admin", async () => {
        await expect(go.initZapperRole({from: anotherUser})).to.be.rejectedWith(/Must have admin role/)
        await expect(go.initZapperRole({from: owner})).to.be.fulfilled
      })

      it("initializes ZAPPER_ROLE", async () => {
        await go.initZapperRole({from: owner})
        // Owner has OWNER_ROLE and can therefore grant ZAPPER_ROLE
        await expect(go.grantRole(await go.ZAPPER_ROLE(), anotherUser, {from: owner})).to.be.fulfilled
      })
    })

    context("paused", () => {
      beforeEach(async () => {
        const uidTokenId = await uniqueIdentity.ID_TYPE_0()
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([uidTokenId], [true])
        await mint(hre, uniqueIdentity, uidTokenId, expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(await uniqueIdentity.balanceOf(anotherUser, uidTokenId)).to.bignumber.equal(new BN(1))
      })

      it("returns anyway", async () => {
        await pause()
        expect(await go.go(anotherUser)).to.equal(true)
      })
    })
  })

  describe("upgradeability", () => {
    it("is upgradeable", async () => {
      // TODO
    })
  })
})
