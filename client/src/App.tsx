import React, { useState, useEffect } from "react"
import { BrowserRouter as Router, Switch, Route, Redirect } from "react-router-dom"
import Borrow from "./components/borrow.js"
import Earn from "./components/earn"
import Transactions from "./components/transactions.js"
import NetworkWidget from "./components/networkWidget"
import Sidebar from "./components/sidebar"
import TermsOfService from "./components/termsOfService.js"
import PrivacyPolicy from "./components/privacyPolicy.js"
import web3 from "./web3"
import { fetchPoolData } from "./ethereum/pool"
import { fetchCreditDeskData } from "./ethereum/creditDesk.js"
import { ERC20, Tickers } from "./ethereum/erc20"
import { refreshGoldfinchConfigData } from "./ethereum/goldfinchConfig"
import { getUserData, defaultUser, User } from "./ethereum/user"
import { mapNetworkToID, SUPPORTED_NETWORKS } from "./ethereum/utils"
import initSdk, { SafeInfo, SdkInstance } from "@gnosis.pm/safe-apps-sdk"
import { NetworkMonitor } from "./ethereum/networkMonitor"
import { SeniorFund } from "./ethereum/pool"
import { GoldfinchProtocol } from "./ethereum/GoldfinchProtocol"
import { GoldfinchConfig } from "./typechain/web3/GoldfinchConfig"

interface NetworkConfig {
  name?: string
  supported?: any
}

interface GlobalState {
  pool?: SeniorFund
  creditDesk?: any
  user: User
  usdc?: ERC20
  goldfinchConfig?: any
  network?: NetworkConfig
  goldfinchProtocol?: GoldfinchProtocol
  gnosisSafeInfo?: SafeInfo
  gnosisSafeSdk?: SdkInstance
  networkMonitor?: NetworkMonitor
  refreshUserData?: (overrideAddress?: string) => void
}

declare let window: any

const AppContext = React.createContext<GlobalState>({ user: defaultUser() })

function App() {
  const [pool, setPool] = useState<SeniorFund>()
  const [creditDesk, setCreditDesk] = useState<any>({})
  const [usdc, setUSDC] = useState<ERC20>()
  const [user, setUser] = useState<User>(defaultUser())
  const [goldfinchConfig, setGoldfinchConfig] = useState({})
  const [currentTXs, setCurrentTXs] = useState([])
  const [currentErrors, setCurrentErrors] = useState([])
  const [network, setNetwork] = useState<NetworkConfig>({})
  const [gnosisSafeInfo, setGnosisSafeInfo] = useState<SafeInfo>()
  const [gnosisSafeSdk, setGnosisSafeSdk] = useState<SdkInstance>()
  const [networkMonitor, setNetworkMonitor] = useState<NetworkMonitor>()
  const [goldfinchProtocol, setGoldfinchProtocol] = useState<GoldfinchProtocol>()

  useEffect(() => {
    setupWeb3()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    refreshUserData()
    // Admin function to be able to assume the role of any address
    window.setUserAddress = function(overrideAddress: string) {
      refreshUserData(overrideAddress)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gnosisSafeInfo, usdc, pool, creditDesk, network, goldfinchProtocol])

  async function setupWeb3() {
    if (!window.ethereum) {
      return
    }

    // Initialize gnosis safe
    const safeSdk = initSdk()
    safeSdk.addListeners({
      onSafeInfo: setGnosisSafeInfo,
      onTransactionConfirmation: () => {},
    })
    setGnosisSafeSdk(safeSdk)

    const networkName = await web3.eth.net.getNetworkType()
    const networkId = mapNetworkToID[networkName] || networkName
    const networkConfig: NetworkConfig = { name: networkId, supported: SUPPORTED_NETWORKS[networkId] }
    setNetwork(networkConfig)
    let usdc: ERC20,
      pool: SeniorFund,
      goldfinchConfigContract: any,
      creditDeskContract: any,
      protocol: GoldfinchProtocol
    if (networkConfig.supported) {
      protocol = new GoldfinchProtocol(networkConfig)
      await protocol.initialize()
      usdc = await protocol.getERC20(Tickers.USDC)
      pool = new SeniorFund(protocol)
      goldfinchConfigContract = protocol.getContract<GoldfinchConfig>("GoldfinchConfig")
      creditDeskContract = protocol.getContract("CreditDesk")
      pool.gf = await fetchPoolData(pool, usdc.contract)
      creditDeskContract.gf = await fetchCreditDeskData(creditDeskContract)
      setUSDC(usdc)
      setPool(pool)
      setCreditDesk(creditDeskContract)
      setGoldfinchConfig(await refreshGoldfinchConfigData(goldfinchConfigContract))
      setGoldfinchProtocol(protocol)
      const monitor = new NetworkMonitor(web3, {
        setCurrentTXs,
        setCurrentErrors,
      })
      monitor.initialize() // initialize async, no need to block on this
      setNetworkMonitor(monitor)
    }

    return () => safeSdk.removeListeners()
  }

  async function refreshUserData(overrideAddress?: string) {
    let data: any = defaultUser()
    const accounts = await web3.eth.getAccounts()
    data.web3Connected = true
    let userAddress =
      overrideAddress || (gnosisSafeInfo && gnosisSafeInfo.safeAddress) || (accounts && accounts[0]) || user.address
    if (userAddress) {
      data.address = userAddress
    }
    if (userAddress && goldfinchProtocol && creditDesk.loaded && pool?.loaded) {
      data = await getUserData(userAddress, goldfinchProtocol, pool, creditDesk, network.name)
    }
    setUser(data)
  }

  const store: GlobalState = {
    pool,
    creditDesk,
    user,
    usdc,
    goldfinchConfig,
    network,
    gnosisSafeInfo,
    gnosisSafeSdk,
    networkMonitor,
    refreshUserData,
    goldfinchProtocol,
  }

  return (
    <AppContext.Provider value={store}>
      <Router>
        <Sidebar />
        <NetworkWidget
          user={user}
          network={network}
          setUser={setUser}
          currentErrors={currentErrors}
          currentTXs={currentTXs}
          gnosisSafeInfo={gnosisSafeInfo}
          connectionComplete={setupWeb3}
        />
        <div>
          <Switch>
            <Route exact path="/">
              <Redirect to="/earn" />
            </Route>
            <Route path="/about">{/* <About /> */}</Route>
            <Route path="/borrow">
              <Borrow />
            </Route>
            <Route path="/earn">
              <Earn />
            </Route>
            <Route path="/transactions">
              <Transactions currentTXs={currentTXs} />
            </Route>
            <Route path="/terms">
              <TermsOfService />
            </Route>
            <Route path="/privacy">
              <PrivacyPolicy />
            </Route>
          </Switch>
        </div>
        <footer>
          <a href="/terms">Terms</a>
          <span className="divider">•</span>
          <a href="/privacy">Privacy</a>
        </footer>
      </Router>
    </AppContext.Provider>
  )
}

export { App, AppContext }
