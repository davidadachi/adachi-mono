import {ethers} from "ethers"
import {useCallback, useContext, useState, useEffect} from "react"
import {AppContext} from "../App"
import {assertNonNullable, getBlockInfo, getCurrentBlock, secondsSinceEpoch} from "../utils"
import web3 from "../web3"
import {SESSION_DATA_VERSION} from "../types/session"

export type UnknownSession = {status: "unknown"}
export type KnownSession = {status: "known"}
export type AuthenticatedSession = {status: "authenticated"; signature: string; signatureBlockNum: number}
export type Session = UnknownSession | KnownSession | AuthenticatedSession

type GetSessionInfo =
  | {
      address: string
      signature: undefined
      signatureBlockNum: undefined
    }
  | {
      address: string
      signature: string
      signatureBlockNum: number
      signatureBlockNumTimestamp: number
      version: number
    }

interface SessionLocalStorageType {
  localStorageValue: any
  setLocalStorageValue: (value: any) => void
}

function getSession(info: GetSessionInfo): Session {
  if (info.address && info.signature) {
    const signature = info.signature
    const signatureBlockNum = info.signatureBlockNum
    return {status: "authenticated", signature, signatureBlockNum}
  }
  if (info.address && !info.signature) {
    return {status: "known"}
  }
  return {status: "unknown"}
}

export function useSession(): Session {
  const {sessionData, user} = useContext(AppContext)
  return getSession(
    sessionData
      ? {
          address: user.address,
          signature: sessionData.signature,
          signatureBlockNum: sessionData.signatureBlockNum,
          signatureBlockNumTimestamp: sessionData.signatureBlockNumTimestamp,
          version: sessionData.version,
        }
      : {address: user.address, signature: undefined, signatureBlockNum: undefined}
  )
}

export function useSignIn(): [status: Session, signIn: () => Promise<Session>] {
  const {setSessionData, user} = useContext(AppContext)
  const session = useSession()

  const signIn = useCallback(
    async function () {
      assertNonNullable(setSessionData)

      const provider = new ethers.providers.Web3Provider(web3.currentProvider as any)
      const signer = provider.getSigner(user.address)

      const currentBlock = getBlockInfo(await getCurrentBlock())
      const signatureBlockNum = currentBlock.number
      const signatureBlockNumTimestamp = currentBlock.timestamp
      const version = SESSION_DATA_VERSION
      const signature = await signer.signMessage(`Sign in to Goldfinch: ${signatureBlockNum}`)
      setSessionData({signature, signatureBlockNum, signatureBlockNumTimestamp, version})
      return getSession({address: user.address, signature, signatureBlockNum, signatureBlockNumTimestamp, version})
    },
    [user, setSessionData]
  )

  return [session, signIn]
}

function isSessionDataFormatInvalid(storedInfo: Object): boolean {
  if (!Boolean(storedInfo)) {
    return true
  }

  const schema = {
    signature: (value) => typeof value === "string" && value !== undefined,
    signatureBlockNum: (value) => typeof value === "number" && value !== undefined,
    signatureBlockNumTimestamp: (value) => typeof value === "number" && value !== undefined,
    version: (value) => typeof value === "number" && value !== undefined,
  }

  const validate = (object, schema) =>
    Object.keys(schema)
      .filter((key) => !schema[key](object[key]))
      .map((key) => new Error(`${key} is invalid.`))

  const errors = validate(storedInfo, schema)

  return errors.length > 0
}

const EXPIRY_IN_SECONDS = 24 * 60 * 60 // 24 hours in seconds

function isSessionDataExpired(timestamp: number): boolean {
  const currentTimestamp = secondsSinceEpoch()
  const difference = currentTimestamp - timestamp

  return EXPIRY_IN_SECONDS < difference
}

function getLocalStorageOrDefault(key: string, defaultValue: any): any {
  const stored = localStorage.getItem(key)
  if (!stored) {
    return defaultValue
  }

  try {
    const sessionData = JSON.parse(stored)

    if (isSessionDataFormatInvalid(sessionData) || isSessionDataExpired(sessionData?.signatureBlockNumTimestamp)) {
      localStorage.removeItem(key)
      return defaultValue
    }

    return sessionData
  } catch (e) {
    // This protects against the corruption of localStorage value, due to some manual edit or frontend version upgrade.
    localStorage.removeItem(key)
    return defaultValue
  }
}

export function useSessionLocalStorage(key: string, defaultValue: any): SessionLocalStorageType {
  const [localStorageValue, setLocalStorageValue] = useState(getLocalStorageOrDefault(key, defaultValue))

  useEffect(() => {
    const value = isSessionDataFormatInvalid(localStorageValue) ? defaultValue : localStorageValue
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, localStorageValue, defaultValue])

  return {localStorageValue, setLocalStorageValue}
}
