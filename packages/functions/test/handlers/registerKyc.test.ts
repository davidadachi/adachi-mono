import chai from "chai"
import chaiSubset from "chai-subset"
import * as firebaseTesting from "@firebase/rules-unit-testing"
import * as admin from "firebase-admin"
import {ethers} from "ethers"
import {setTestConfig} from "../../src/config"
import {setTestFirestore, getUsers} from "../../src/db"
import {Request} from "express"
import {fake, stub, restore} from "sinon"
import {BaseProvider} from "@ethersproject/providers"
import {mockGetBlockchain} from "../../src/helpers"
import {ParallelMarkets} from "../../src/handlers/parallelmarkets/PmApi"
import {
  PmAccreditationResponse,
  PmIdentity,
  PmOauthResponse,
  PmIndividualIdentityDetails,
  PmBusinessIdentityDetails,
} from "../../src/handlers/parallelmarkets/PmApiTypes"
chai.use(chaiSubset)
const expect = chai.expect

import firestore = admin.firestore
import Firestore = firestore.Firestore
import {registerKyc} from "../../src"
import {expectResponse} from "../utils"
import {assertNonNullable} from "@goldfinch-eng/utils"

type FakeBlock = {
  number: number
  timestamp: number
}

describe("registerKyc", async () => {
  const testAccount = {
    address: "0xc34461018f970d343d5a25e4Ed28C4ddE6dcCc3F",
    privateKey: "0x50f9c471e3c454b506f39536c06bde77233144784297a95d35896b3be3dfc9d8",
  }
  const testWallet = new ethers.Wallet(testAccount.privateKey)
  const projectId = "goldfinch-frontend-test"

  let testFirestore: Firestore
  let testApp: admin.app.App
  let users: firestore.CollectionReference<firestore.DocumentData>

  const genRegisterKycRequest = (
    address: string,
    key: string,
    signature: string,
    plaintext: string,
    signatureBlockNum?: number,
  ): Request => {
    return {
      headers: {
        "x-goldfinch-address": address,
        "x-goldfinch-signature": signature,
        "x-goldfinch-signature-block-num": signatureBlockNum,
        "x-goldfinch-signature-plaintext": plaintext,
      },
    } as unknown as Request
  }

  const currentBlockNum = 84
  const fiveMinAgoBlockNum = 80
  const futureBlockNum = 85
  const currentBlockTimestamp = 1629819124
  const timestampByBlockNum: {[blockNum: number]: number} = {
    [currentBlockNum]: currentBlockTimestamp,
    [fiveMinAgoBlockNum]: currentBlockTimestamp - 60 * 5 - 1,
    [futureBlockNum]: currentBlockTimestamp + 1,
  }

  before(async () => {
    const mock = fake.returns({
      getBlock: async (blockTag: string | number): Promise<FakeBlock> => {
        const blockNum = blockTag === "latest" ? currentBlockNum : typeof blockTag === "number" ? blockTag : undefined
        assertNonNullable(blockNum)
        const timestamp = timestampByBlockNum[blockNum]
        assertNonNullable(timestamp)
        return {
          number: blockNum,
          timestamp,
        }
      },
    } as BaseProvider)

    mockGetBlockchain(mock)
  })

  beforeEach(async () => {
    testApp = firebaseTesting.initializeAdminApp({projectId})
    testFirestore = testApp.firestore()
    setTestFirestore(testFirestore)
    setTestConfig({
      kyc: {allowed_origins: "http://localhost:3000"},
      slack: {token: "slackToken"},
      persona: {
        allowed_ips: "",
      },
    })
    users = getUsers()
  })

  afterEach(async () => {
    restore()
    await firebaseTesting.clearFirestoreData({projectId})
  })

  after(() => {
    mockGetBlockchain(undefined)
  })

  describe("parallel markets", () => {
    describe("validating payload", () => {
      it("ensures key is present", async () => {
        // Missing the key!
        const badPlaintext = JSON.stringify({
          provider: "parallel_markets",
        })
        const sig = await testWallet.signMessage(badPlaintext)
        const request = genRegisterKycRequest(testAccount.address, "test_key", sig, badPlaintext, currentBlockNum)
        await registerKyc(request, expectResponse(400, {error: "Missing key"}))
      })
    })

    describe("creating new user", () => {
      it("with correct fields for individual", async () => {
        const {address} = testWallet
        const oauthCode = "OAUTH_CODE"
        const plaintext = `Share your OAuth code with Goldfinch: ${oauthCode}`
        const sig = await testWallet.signMessage(plaintext)

        stub(ParallelMarkets, "tradeCodeForToken").returns(
          Promise.resolve({accessToken: "ACCESS_TOKEN"} as PmOauthResponse),
        )
        stub(ParallelMarkets, "getIdentityForAccessToken").returns(
          Promise.resolve({
            id: "IDENTITY_ID",
            type: "individual",
            identityDetails: {
              citizenshipCountry: "US",
              residenceLocation: "US",
              consistencySummary: {
                overallRecordsMatchLevel: "low",
                idValidity: "valid",
              },
              expiresAt: 123,
            } as unknown as PmIndividualIdentityDetails,
          } as PmIdentity),
        )
        stub(ParallelMarkets, "getAccreditationsForAccessToken").returns(
          Promise.resolve({
            id: "ACCREDITATION_ID",
            type: "individual",
            accreditations: [{status: "current", expiresAt: 1, createdAt: 0}],
          } as unknown as PmAccreditationResponse),
        )

        const request = genRegisterKycRequest(testAccount.address, "test_key", sig, plaintext, currentBlockNum)

        await registerKyc(request, expectResponse(200, {status: "success"}))

        const userDoc = await users.doc(address.toLowerCase()).get()
        expect(userDoc.exists).to.be.true
        expect(userDoc.data()).to.containSubset({
          address: address.toLowerCase(),
          countryCode: "US",
          kycProvider: "parallelMarkets",
          parallelMarkets: {
            accreditationAccessRevocationAt: null,
            accreditationExpiresAt: 1,
            accreditationStatus: "approved",
            id: "IDENTITY_ID",
            identityAccessRevocationAt: null,
            identityStatus: "failed",
            type: "individual",
          },
        })
      })

      it("with correct fields for business", async () => {
        const {address} = testWallet
        const oauthCode = "OAUTH_CODE"
        const plaintext = `Share your OAuth code with Goldfinch: ${oauthCode}`
        const sig = await testWallet.signMessage(plaintext)

        stub(ParallelMarkets, "tradeCodeForToken").returns(
          Promise.resolve({accessToken: "ACCESS_TOKEN"} as PmOauthResponse),
        )
        stub(ParallelMarkets, "getIdentityForAccessToken").returns(
          Promise.resolve({
            id: "IDENTITY_ID",
            type: "business",
            identityDetails: {
              incorporationCountry: "MX",
              principalLocation: "MX",
              consistencySummary: {
                overallRecordsMatchLevel: "high",
                idValidity: "valid",
              },
              expiresAt: 123,
            } as unknown as PmBusinessIdentityDetails,
          } as PmIdentity),
        )
        stub(ParallelMarkets, "getAccreditationsForAccessToken").returns(
          Promise.resolve({
            id: "ACCREDITATION_ID",
            type: "business",
            accreditations: [{status: "current", expiresAt: 1, createdAt: 0}],
          } as unknown as PmAccreditationResponse),
        )

        const request = genRegisterKycRequest(testAccount.address, "test_key", sig, plaintext, currentBlockNum)

        await registerKyc(request, expectResponse(200, {status: "success"}))

        const userDoc = await users.doc(address.toLowerCase()).get()
        expect(userDoc.exists).to.be.true
        expect(userDoc.data()).to.containSubset({
          address: address.toLowerCase(),
          countryCode: "MX",
          kycProvider: "parallelMarkets",
          parallelMarkets: {
            accreditationAccessRevocationAt: null,
            accreditationExpiresAt: 1,
            accreditationStatus: "approved",
            id: "IDENTITY_ID",
            identityAccessRevocationAt: null,
            identityStatus: "approved",
            type: "business",
          },
        })
      })

      it("gives no accreditation if all documents invalid", async () => {
        const {address} = testWallet
        const oauthCode = "OAUTH_CODE"
        const plaintext = `Share your OAuth code with Goldfinch: ${oauthCode}`
        const sig = await testWallet.signMessage(plaintext)

        stub(ParallelMarkets, "tradeCodeForToken").returns(
          Promise.resolve({accessToken: "ACCESS_TOKEN"} as PmOauthResponse),
        )
        stub(ParallelMarkets, "getIdentityForAccessToken").returns(
          Promise.resolve({
            id: "IDENTITY_ID",
            type: "individual",
            identityDetails: {
              citizenshipCountry: "US",
              residenceLocation: "US",
              consistencySummary: {
                overallRecordsMatchLevel: "low",
                idValidity: "valid",
              },
              expiresAt: 123,
            } as unknown as PmIndividualIdentityDetails,
          } as PmIdentity),
        )
        stub(ParallelMarkets, "getAccreditationsForAccessToken").returns(
          Promise.resolve({
            id: "ACCREDITATION_ID",
            type: "individual",
            accreditations: [{status: "rejected", expiresAt: 1, createdAt: 0}],
          } as unknown as PmAccreditationResponse),
        )

        const request = genRegisterKycRequest(testAccount.address, "test_key", sig, plaintext, currentBlockNum)

        await registerKyc(request, expectResponse(200, {status: "success"}))

        const userDoc = await users.doc(address.toLowerCase()).get()
        expect(userDoc.exists).to.be.true
        expect(userDoc.data()).to.containSubset({
          address: address.toLowerCase(),
          countryCode: "US",
          kycProvider: "parallelMarkets",
          parallelMarkets: {
            accreditationAccessRevocationAt: null,
            accreditationExpiresAt: 1,
            accreditationStatus: "failed",
            id: "IDENTITY_ID",
            identityAccessRevocationAt: null,
            identityStatus: "failed",
            type: "individual",
          },
        })
      })

      it("fails on accreditation and identity type mismatch", async () => {
        const oauthCode = "OAUTH_CODE"
        const plaintext = `Share your OAuth code with Goldfinch: ${oauthCode}`
        const sig = await testWallet.signMessage(plaintext)

        stub(ParallelMarkets, "tradeCodeForToken").returns(
          Promise.resolve({accessToken: "ACCESS_TOKEN"} as PmOauthResponse),
        )
        stub(ParallelMarkets, "getIdentityForAccessToken").returns(
          Promise.resolve({
            id: "IDENTITY_ID",
            type: "individual",
            identityDetails: {
              citizenshipCountry: "US",
              residenceLocation: "US",
              consistencySummary: {
                overallRecordsMatchLevel: "low",
                idValidity: "valid",
              },
              expiresAt: 123,
            } as unknown as PmIndividualIdentityDetails,
          } as PmIdentity),
        )
        stub(ParallelMarkets, "getAccreditationsForAccessToken").returns(
          Promise.resolve({
            id: "ACCREDITATION_ID",
            type: "business",
            accreditations: [{status: "rejected", expiresAt: 1, createdAt: 0}],
          } as unknown as PmAccreditationResponse),
        )

        const request = genRegisterKycRequest(testAccount.address, "test_key", sig, plaintext, currentBlockNum)

        await registerKyc(request, expectResponse(500, {status: "failed to save parallel markets data"}))
      })
    })

    describe("updatings existing user", () => {
      beforeEach(async () => {
        const {address} = testWallet

        await users.doc(address.toLowerCase()).set({
          address: address.toLowerCase(),
          countryCode: "CA",
          kycProvider: "parallelMarkets",
          parallelMarkets: {
            accreditationAccessRevocationAt: 123,
            accreditationExpiresAt: 1,
            accreditationStatus: "approved",
            id: "IDENTITY_ID",
            identityAccessRevocationAt: 456,
            identityStatus: "failed",
            type: "individual",
          },
          persona: {
            shouldStayHere: "here",
          },
        })
      })

      it("resets revocations, overwrites fields", async () => {
        const {address} = testWallet
        const oauthCode = "OAUTH_CODE"
        const plaintext = `Share your OAuth code with Goldfinch: ${oauthCode}`
        const sig = await testWallet.signMessage(plaintext)

        stub(ParallelMarkets, "tradeCodeForToken").returns(
          Promise.resolve({accessToken: "ACCESS_TOKEN"} as PmOauthResponse),
        )
        stub(ParallelMarkets, "getIdentityForAccessToken").returns(
          Promise.resolve({
            id: "IDENTITY_ID",
            type: "individual",
            identityDetails: {
              citizenshipCountry: "US",
              residenceLocation: "US",
              consistencySummary: {
                overallRecordsMatchLevel: "high",
                idValidity: "valid",
              },
              expiresAt: 123,
            } as unknown as PmIndividualIdentityDetails,
          } as PmIdentity),
        )
        stub(ParallelMarkets, "getAccreditationsForAccessToken").returns(
          Promise.resolve({
            id: "ACCREDITATION_ID",
            type: "individual",
            accreditations: [{status: "current", expiresAt: 1, createdAt: 0}],
          } as unknown as PmAccreditationResponse),
        )

        const request = genRegisterKycRequest(testAccount.address, "test_key", sig, plaintext, currentBlockNum)

        await registerKyc(request, expectResponse(200, {status: "success"}))

        const userDoc = await users.doc(address.toLowerCase()).get()
        expect(userDoc.exists).to.be.true
        expect(userDoc.data()).to.containSubset({
          address: address.toLowerCase(),
          countryCode: "US",
          kycProvider: "parallelMarkets",
          parallelMarkets: {
            accreditationAccessRevocationAt: null,
            accreditationExpiresAt: 1,
            accreditationStatus: "approved",
            id: "IDENTITY_ID",
            identityAccessRevocationAt: null,
            identityStatus: "approved",
            type: "individual",
          },
          persona: {
            shouldStayHere: "here",
          },
        })
      })
    })
  })
})
