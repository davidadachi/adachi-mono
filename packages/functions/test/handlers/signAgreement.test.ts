import chai from "chai"
import chaiSubset from "chai-subset"
import {BaseProvider} from "@ethersproject/providers"
import * as firebaseTesting from "@firebase/rules-unit-testing"
import * as admin from "firebase-admin"
import {fake} from "sinon"

import {FirebaseConfig, getAgreements, setEnvForTest} from "../../src/db"
import {signAgreement} from "../../src"

chai.use(chaiSubset)
const expect = chai.expect
import firestore = admin.firestore
import Firestore = firestore.Firestore
import {Request} from "express"
import {assertNonNullable} from "@goldfinch-eng/utils"
import {mockGetBlockchain} from "../../src/helpers"
import {expectResponse} from "../utils"

type FakeBlock = {
  number: number
  timestamp: number
}

describe("signAgreement", async () => {
  let testFirestore: Firestore
  let testApp: admin.app.App
  let config: Omit<FirebaseConfig, "sentry">
  const projectId = "goldfinch-frontend-test"
  const address = "0xb5c52599dFc7F9858F948f003362A7f4B5E678A5"
  const validSignature =
    "0x46855997425525c8ae449fde8624668ce1f72485886900c585d08459822de466363faa239b8070393a2c3d1f97abe50abc48019be415258615e128b59cfd91a31c"
  let agreements: firestore.CollectionReference<firestore.DocumentData>

  const currentBlockNum = 84
  const yesterdayBlockNum = 80
  const futureBlockNum = 85

  const currentBlockTimestamp = 1629819124
  const timestampByBlockNum: {[blockNum: number]: number} = {
    [currentBlockNum]: currentBlockTimestamp,
    [yesterdayBlockNum]: currentBlockTimestamp - 60 * 60 * 24 - 1,
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

  beforeEach(() => {
    testApp = firebaseTesting.initializeAdminApp({projectId: projectId})
    testFirestore = testApp.firestore()
    config = {
      kyc: {allowed_origins: "http://localhost:3000"},
      persona: {allowed_ips: ""},
    }
    setEnvForTest(testFirestore, config)
    agreements = getAgreements(testFirestore)
  })

  after(async () => {
    mockGetBlockchain(undefined)
  })

  afterEach(async () => {
    await firebaseTesting.clearFirestoreData({projectId})
  })

  const generateAgreementRequest = (
    address: string,
    pool: string,
    fullName: string,
    signature: string,
    signatureBlockNum: number | string | undefined,
  ) => {
    return {
      headers: {
        "x-goldfinch-address": address,
        "x-goldfinch-signature": signature,
        "x-goldfinch-signature-block-num": signatureBlockNum,
      },
      body: {pool, fullName},
    } as unknown as Request
  }
  const pool = "0x1234asdADF"

  describe("validation", async () => {
    it("checks if address is present", async () => {
      await signAgreement(
        generateAgreementRequest("", "", "", "", currentBlockNum),
        expectResponse(403, {error: "Invalid address"}),
      )
    })
  })

  describe("valid request", async () => {
    it("saves the provided details to the agreements collection", async () => {
      const key = `${pool.toLowerCase()}-${address.toLowerCase()}`

      expect((await agreements.doc(key).get()).exists).to.be.false

      await signAgreement(
        generateAgreementRequest(address, pool, "Test User", validSignature, currentBlockNum),
        expectResponse(200, {status: "success"}),
      )

      const agreementDoc = await agreements.doc(key).get()
      expect(agreementDoc.exists).to.be.true
      expect(agreementDoc.data()).to.containSubset({address: address, fullName: "Test User", pool: pool})
    })

    it("updates the details if submitted twice", async () => {
      const key = `${pool.toLowerCase()}-${address.toLowerCase()}`

      await signAgreement(
        generateAgreementRequest(address, pool, "Test User", validSignature, currentBlockNum),
        expectResponse(200, {status: "success"}),
      )

      let agreementDoc = await agreements.doc(key).get()
      expect(agreementDoc.data()).to.containSubset({fullName: "Test User"})

      await signAgreement(
        generateAgreementRequest(address, pool, "Test User 2", validSignature, currentBlockNum),
        expectResponse(200, {status: "success"}),
      )

      agreementDoc = await agreements.doc(key).get()
      expect(agreementDoc.data()).to.containSubset({fullName: "Test User 2"})
    })
  })
})
