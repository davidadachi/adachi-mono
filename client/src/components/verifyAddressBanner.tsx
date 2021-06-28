import React, { useContext } from "react"
import { useHistory } from "react-router-dom"
import { iconInfo } from "./icons.js"
import useGeolocation from "../hooks/useGeolocation"
import { useForm, FormProvider } from "react-hook-form"
import LoadingButton from "./loadingButton"

export default function VerifyAddressBanner() {
  let geolocationData = useGeolocation()
  let history = useHistory()
  const formMethods = useForm()
  function verifyAddress(): Promise<void> {
    // TODO: change this to correct endpoint
    history.push("/verify")
    return Promise.resolve()
  }

  if (!geolocationData) {
    return null
  }

  let qualifyText =
    geolocationData.country === "US"
      ? "In order to supply to this pool as a U.S. person, you must qualify as an Accredited Investor."
      : "In order to supply to this pool, you need to verify your address."

  return (
    <FormProvider {...formMethods}>
      <div className="unlock-form background-container">
        <p>
          {iconInfo}
          {qualifyText}
        </p>
        <LoadingButton action={verifyAddress} text="Verify Address" />
      </div>
    </FormProvider>
  )
}
