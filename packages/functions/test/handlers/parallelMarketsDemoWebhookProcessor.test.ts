import * as firebaseTesting from "@firebase/rules-unit-testing"
import * as admin from "firebase-admin"
import {FirebaseConfig, setEnvForTest, getUsers} from "../../src/db"
import {parallelMarketsDemoWebhookProcessor} from "../../src"
import {Request} from "express"

import firestore = admin.firestore
import Firestore = firestore.Firestore
import {expectResponse} from "../utils"
import {processIdentityWebhook} from "../../src/handlers/parallelmarkets/webhookHelpers"
import {PmIdentity, PmIdentityPayload} from "../../src/handlers/parallelmarkets/types"

import sinon from "sinon"
import * as fetchModule from "node-fetch"
import {Response} from "node-fetch"
import {expect} from "chai"

const PENDING_ADDRESS = "0xA57415BeCcA125Ee98B04b229A0Af367f4144030"
const PENDING_USER = {
  address: PENDING_ADDRESS,
  countryCode: "CA",
  parallel_markets: {
    id: "test_id",
    identity_status: "pending",
    accreditation_status: "pending",
    legacy: false,
  },
}

interface PmRequest {
  headers: {
    timestamp?: string
    signature?: string
  }
  body: {
    entity: {
      id: string
      type: string
    }
    event: string
    scope: string
  }
  rawBody: Buffer
}

// This is a valid request taken from a test payload using the webhook key for OAuth client
// with id F4eUFc5LDqt6P8Nfjb4av
const VALID_REQUEST: PmRequest = {
  headers: {
    timestamp: "1680634750",
    signature: "bjHm0MvEgSjiwKLa8OQgzmlt24ECoLD0rFUt0sM7lnU=",
  },
  body: {
    entity: {
      id: "test",
      type: "individual",
    },
    event: "data_update",
    scope: "accreditation_status",
  },
  rawBody: Buffer.from(
    `{"entity":{"id":"test","type":"individual"},"event":"data_update","scope":"accreditation_status"}${""}`,
  ),
}

describe.skip("parallelMarketsDemoWebhookProcessor", async () => {
  const projectId = "goldfinch-frontend-test"

  let testFirestore: Firestore
  let testApp: admin.app.App
  let config: Omit<FirebaseConfig, "sentry">
  let users: firestore.CollectionReference<firestore.DocumentData>

  beforeEach(async () => {
    testApp = firebaseTesting.initializeAdminApp({projectId})
    testFirestore = testApp.firestore()
    config = {
      kyc: {allowed_origins: "http://localhost:3000"},
      slack: {token: "slackToken"},
      persona: {
        allowed_ips: "",
      },
    }
    setEnvForTest(testFirestore, config)
    users = getUsers(testFirestore)
  })

  afterEach(async () => {
    await firebaseTesting.clearFirestoreData({projectId})
  })

  const genRequest = (pmRequest: PmRequest): Request => {
    return {
      // Headers
      get: (key: string) => {
        // This (timestamp, sig) pair is a valid pair generated by sending a test payload from PM to our dev
        // webhook.
        switch (key) {
          case "Parallel-Timestamp":
            return pmRequest.headers.timestamp
          case "Parallel-Signature":
            return pmRequest.headers.signature
          default:
            throw new Error("Invalid Key")
        }
      },
      body: pmRequest.body,
      rawBody: pmRequest.rawBody,
    } as unknown as Request
  }

  describe("request validation", () => {
    describe("signature", () => {
      it.skip("returns 200 for valid signature", async () => {
        await parallelMarketsDemoWebhookProcessor(
          genRequest(VALID_REQUEST),
          expectResponse(200, {status: "valid signature"}),
        )
      })

      it("returns 403 for invalid signature", async () => {
        await parallelMarketsDemoWebhookProcessor(
          genRequest({
            ...VALID_REQUEST,
            headers: {
              ...VALID_REQUEST.headers,
              signature: VALID_REQUEST.headers.signature + "bad",
            },
          }),
          expectResponse(403, {status: "invalid signature"}),
        )
      })
    })

    describe("headers", () => {
      it("returns 400 for missing signature header", async () => {
        await parallelMarketsDemoWebhookProcessor(
          genRequest({
            ...VALID_REQUEST,
            headers: {
              timestamp: VALID_REQUEST.headers.timestamp,
            },
          }),
          expectResponse(400, {status: "missing signature"}),
        )
      })

      it("returns 400 for missing timestamp header", async () => {
        await parallelMarketsDemoWebhookProcessor(
          genRequest({
            ...VALID_REQUEST,
            headers: {
              signature: VALID_REQUEST.headers.signature,
            },
          }),
          expectResponse(400, {status: "missing timestamp"}),
        )
      })
    })
  })

  describe("identity event", () => {
    describe("data_update", () => {
      describe("id_validity is null", () => {
        describe("individual", () => {
          beforeEach(async () => {
            // Stub the Identity API request
            const stub = sinon.stub(fetchModule, "default")
            const missingDocumentsIdentityResponse: PmIdentity = {
              id: "test_id",
              type: "individual",
              identity_details: {
                birth_date: "1997-10-14",
                citizenship_country: "CA",
                completed_at: "1231239093809",
                consistency_summary: {
                  overall_records_level_match: "high",
                  id_validity: null,
                },
              },
              access_expires_at: null,
              access_revoked_by: null,
            }
            stub.returns(
              new Promise((resolve) =>
                resolve(new Response(JSON.stringify(missingDocumentsIdentityResponse), {status: 200})),
              ),
            )

            // Save some users in the user store
            await users.doc(PENDING_ADDRESS).set(PENDING_USER)
          })

          it("sets identity_status to pending", async () => {
            const payload: PmIdentityPayload = {
              entity: {
                id: "test_id",
                type: "individual",
              },
              event: "data_update",
              scope: "identity",
            }
            await processIdentityWebhook(payload)
            const user = await getUsers(admin.firestore()).doc(PENDING_ADDRESS).get()
            // Their status is still pending, so nothing should have changed
            expect(user.data()).to.deep.eq(PENDING_USER)
          })
        })
      })
    })
  })
})
