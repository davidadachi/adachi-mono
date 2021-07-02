import React, { useState, useEffect, useContext } from "react"
import ConnectionNotice from "./connectionNotice"
import { fetchCapitalProviderData, fetchPoolData } from "../ethereum/pool"
import { AppContext } from "../App"
import { ERC20 } from "../ethereum/erc20"

function Earn(props) {
  const { pool, usdc, user } = useContext(AppContext)
  const [capitalProvider, setCapitalProvider] = useState<any>({})
  const [, setPoolData] = useState({})

  useEffect(() => {
    async function refreshAllData() {
      const capitalProviderAddress = user.loaded && user.address
      refreshPoolData(pool, usdc!)
      refreshCapitalProviderData(pool, capitalProviderAddress)
    }

    if (pool) {
      refreshAllData()
    }
  }, [pool, usdc, user])

  async function refreshCapitalProviderData(pool: any, address: string | boolean) {
    const capitalProvider = await fetchCapitalProviderData(pool, address)
    setCapitalProvider(capitalProvider)
  }

  async function refreshPoolData(pool: any, usdc: ERC20) {
    const poolData = await fetchPoolData(pool, usdc && usdc.contract)
    setPoolData(poolData)
  }

  let earnMessage = "Loading..."
  if (capitalProvider.loaded || user.noWeb3) {
    earnMessage = "Earn Portfolio"
  }

  return (
    <div className="content-section">
      <div className="page-header">{earnMessage}</div>
      <ConnectionNotice />
    </div>
  )
}

export default Earn
