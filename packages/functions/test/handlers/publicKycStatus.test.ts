import _ from "lodash"
import {Request} from "express"
import {publicKycStatus} from "../../src"
import {expectResponse, initializeFirebaseTestEnv} from "../utils"
import {RulesTestEnvironment, RulesTestContext} from "@firebase/rules-unit-testing"
import firebase from "firebase/compat/app"

describe("publicKycStatus", () => {
  const ADDRESS = "0x4F7280C3ba9a9Cef45e468165a1Bf611129157c9"
  let testEnv: RulesTestEnvironment
  let testContext: RulesTestContext
  let users: firebase.firestore.CollectionReference<firebase.firestore.DocumentData>

  beforeEach(async () => {
    ;({testEnv, testContext} = await initializeFirebaseTestEnv("goldfinch-frontend-test"))
    users = testContext.firestore().collection("test_users")
  })

  afterEach(async () => {
    await testEnv.clearFirestore()
  })

  const generateDocumentExpiryRequest = (address?: string): Request => {
    return {
      headers: {},
      query: {
        address,
      },
    } as unknown as Request
  }

  describe("request validation", () => {
    it("returns 400 when address not in query params", async () => {
      const badRequest = generateDocumentExpiryRequest()
      await publicKycStatus(badRequest, expectResponse(400, {message: "Missing address from request query parameters"}))
    })
  })

  describe("persona user", () => {
    it("returns empty body for persona user", async () => {
      await users.doc(ADDRESS.toLowerCase()).set({
        address: ADDRESS,
        kycProvider: "persona",
        persona: {
          id: "inq_asdfasdfs",
          status: "approved",
        },
      })
      await publicKycStatus(generateDocumentExpiryRequest(ADDRESS), expectResponse(200, {}))
    })
  })

  describe("parallel markets user", () => {
    const PM_USER_WITHOUT_EXPIRIES = {
      address: ADDRESS,
      kycProvider: "parallelMarkets",
      parallelMarkets: {
        id: "asdlfjs",
        type: "individual",
        accreditationStatus: "approved",
        identityStatus: "approved",
      },
    }

    it("returns empty body if expirations aren't present", async () => {
      await users.doc(ADDRESS.toLowerCase()).set(PM_USER_WITHOUT_EXPIRIES)
      await publicKycStatus(generateDocumentExpiryRequest(ADDRESS), expectResponse(200, {}))
    })

    it("returns the identity expiry when it's present", async () => {
      const user = _.cloneDeep(PM_USER_WITHOUT_EXPIRIES) as any
      user.parallelMarkets.identityExpiresAt = 2304983098434
      await users.doc(ADDRESS.toLowerCase()).set(user)
      await publicKycStatus(
        generateDocumentExpiryRequest(ADDRESS),
        expectResponse(200, {
          identityExpiresAt: 2304983098434,
        }),
      )
    })

    it("returns the accreditation expiry when it's present", async () => {
      const user = _.cloneDeep(PM_USER_WITHOUT_EXPIRIES) as any
      user.parallelMarkets.accreditationExpiresAt = 39083098345
      await users.doc(ADDRESS.toLowerCase()).set(user)
      await publicKycStatus(
        generateDocumentExpiryRequest(ADDRESS),
        expectResponse(200, {
          accreditationExpiresAt: 39083098345,
        }),
      )
    })

    it("returns the identity and accreditation expiries when they're present", async () => {
      const user = _.cloneDeep(PM_USER_WITHOUT_EXPIRIES) as any
      user.parallelMarkets.identityExpiresAt = 2304983098434
      user.parallelMarkets.accreditationExpiresAt = 39083098345
      await users.doc(ADDRESS.toLowerCase()).set(user)
      await publicKycStatus(
        generateDocumentExpiryRequest(ADDRESS),
        expectResponse(200, {
          identityExpiresAt: 2304983098434,
          accreditationExpiresAt: 39083098345,
        }),
      )
    })
  })
})
