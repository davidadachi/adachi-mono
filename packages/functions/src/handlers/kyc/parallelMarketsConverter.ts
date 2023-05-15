import { KycAccreditationStatus } from "@goldfinch-eng/utils"
import {PmAccreditationResponse, PmConsistencyLevel, PmIdentityDocumentValidity} from "../parallelmarkets/PmApiTypes"

// We don't need a separate fn for businesses and individuals because they have the same accreditation statuses
export const getAccreditationStatus = (accreditation: PmAccreditationResponse): {status: KycAccreditationStatus, expiresAt?: number} => {
  console.log(`Evaluating accreditation status for ${accreditation.type} ${accreditation.id}`)
  if (accreditation.indicatedUnaccredited) {
    return {status: "unaccredited", expiresAt: undefined}
  } else if (accreditation.accreditations.length == 0) {
    return {status: "pending_documents", expiresAt: undefined}
  } else {
    // Take the most recent accreditation attempt (sort by created at descending)
    const accreditationAttempts = accreditation.accreditations
    accreditationAttempts.sort((attempt1, attempt2) => {
      return attempt1.createdAt > attempt2.createdAt ? -1 : 1
    })
    const accreditationAttempt = accreditationAttempts.at(0) || {status: "pending", expiresAt: undefined}
    const {status, expiresAt} = accreditationAttempt
    switch (status) {
      case "pending":
        return {status: "pending_verification", expiresAt}
      case "submitter_pending":
      case "third_party_pending":
        return {status: "pending_documents", expiresAt}
      case "current":
        return {status: "approved", expiresAt}
      case "expired":
        return {status: "expired", expiresAt}
      case "rejected":
        return {status: "failed", expiresAt}
      default:
        return {status: "unknown", expiresAt}
    }
  }
}

export const getIndividualIdentityStatus = (
  overallRecordsMatchLevel: PmConsistencyLevel | null,
  idValidity: PmIdentityDocumentValidity | null,
) => {
  console.log(
    `Evaluating identity status overallRecordsMatchLevel ${overallRecordsMatchLevel}, and idValidity ${idValidity}`,
  )
  if (idValidity === null) {
    // We're still waiting for them to submit their identity documents
    return "pending_documents"
  } else if (idValidity === "valid" && overallRecordsMatchLevel === null) {
    return "pending_verification"
  } else if (idValidity === "expired") {
    return "expired"
  } else if (idValidity === "valid" && overallRecordsMatchLevel === "high") {
    return "approved"
  } else {
    // In this case either the id is not valid or the records level match is not strong.
    // We consider this a failure
    return "failed"
  }
}

export const getBusinessIdentityStatus = (overallRecordsMatchLevel: PmConsistencyLevel) => {
  if (overallRecordsMatchLevel === "high") {
    return "approved"
  } else if (overallRecordsMatchLevel === "none") {
    return "pending"
  } else {
    return "failed"
  }
}
