// import * as crypto from "crypto"
import {Request, Response} from "@sentry/serverless/dist/gcpfunction/general"
import {genRequestHandler} from "../../helpers"
import {https} from "firebase-functions"
import * as functions from "firebase-functions"
// import {assertIsString} from "@goldfinch-eng/utils"
import {PmPayload} from "./PmApiTypes"
import {processAccreditationWebhook, processIdentityWebhook} from "./webhookHelpers"
import {getConfig} from "../../config"

// const PARALLEL_TIMESTAMP_HEADER = "Parallel-Timestamp"
// const PARALLEL_SIGNATURE_HEADER = "Parallel-Signature"

// // This authenticity check was adapted from PM's Webhooks Documentation code sample
// // https://developer.parallelmarkets.com/docs/webhooks/#verifying-webhook-authenticity
// const isValidPMRequest = (messageThatWasSigned: string, sig: string, webhookKey: string) => {
//   const decodedWebhookKey = Buffer.from(webhookKey, "base64")
//   const hmac = crypto.createHmac("sha256", decodedWebhookKey)
//   const recoveredSig = hmac.update(messageThatWasSigned).digest("base64")
//   return Buffer.from(sig).equals(Buffer.from(recoveredSig))
// }

export const parallelMarketsDemoWebhookProcessor = genRequestHandler({
  requireAuth: "none",
  cors: false,
  handler: async (request: Request, response: Response): Promise<Response> => {
    const firebaseRequest = request as https.Request

    // const unixTimestamp = firebaseRequest.get(PARALLEL_TIMESTAMP_HEADER)
    // const signature = firebaseRequest.get(PARALLEL_SIGNATURE_HEADER)

    // console.log(`Received timestamp ${unixTimestamp}`)
    // console.log(`Received signature ${signature}`)
    // console.log("Received rawBody")
    // console.log(firebaseRequest.rawBody.toString())

    // if (!unixTimestamp) {
    //   return response.status(400).send({status: "missing timestamp"})
    // }

    // if (!signature) {
    //   return response.status(400).send({status: "missing signature"})
    // }

    // const webhookKey = process.env.PM_WEBHOOK_KEY
    // assertIsString(webhookKey)

    // const isValidRequest = isValidPMRequest(unixTimestamp + firebaseRequest.rawBody.toString(), signature, webhookKey)
    // if (!isValidRequest) {
    //   return response.status(403).send({status: "invalid signature"})
    // }

    const payload = firebaseRequest.body as PmPayload

    console.log("Received payload")
    console.log(payload)

    if (payload.entity.id === "test") {
      return response.status(200).send({status: "received test payload"})
    }

    // Get the config and log all the variables just to verify that they are there
    const config = getConfig(functions)
    console.log("Extracted config")
    console.log(config)

    switch (payload.scope) {
      case "identity":
        await processIdentityWebhook(payload)
        break
      case "accreditation_status":
        await processAccreditationWebhook(payload)
        break
    }

    return response.status(200).send({status: "valid signature"})
  },
})
