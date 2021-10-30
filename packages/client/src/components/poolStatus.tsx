import {BigNumber} from "bignumber.js"
import {useContext} from "react"
import {AppContext} from "../App"
import {usdcFromAtomic} from "../ethereum/erc20"
import {SeniorPoolLoaded} from "../ethereum/pool"
import {displayDollars, displayPercent} from "../utils"
import {iconOutArrow} from "./icons"
import InfoSection from "./infoSection"
import RecentRepayments from "./recentRepayments"

interface PoolStatusProps {
  pool: SeniorPoolLoaded | undefined
}

function PoolStatus({pool}: PoolStatusProps) {
  const {goldfinchConfig} = useContext(AppContext)

  function deriveRows() {
    let defaultRate: BigNumber | undefined
    let poolBalance: string | undefined
    let totalLoansOutstanding: string | undefined
    let capacityRemaining: BigNumber | undefined
    const maxPoolCapacity: BigNumber | undefined = goldfinchConfig ? goldfinchConfig.totalFundsLimit : undefined
    if (pool && maxPoolCapacity) {
      const poolData = pool.info.value.poolData
      defaultRate = poolData.defaultRate
      poolBalance = usdcFromAtomic(poolData.totalPoolAssets)
      totalLoansOutstanding = usdcFromAtomic(poolData.totalLoansOutstanding)
      capacityRemaining = poolData.remainingCapacity(maxPoolCapacity)
    }

    return [
      {label: "Total pool balance", value: displayDollars(poolBalance)},
      {
        label: "Max pool capacity",
        value: displayDollars(maxPoolCapacity ? usdcFromAtomic(maxPoolCapacity) : undefined),
      },
      {
        label: "Remaining capacity",
        value: displayDollars(capacityRemaining ? usdcFromAtomic(capacityRemaining) : undefined),
      },
      {label: "Loans outstanding", value: displayDollars(totalLoansOutstanding)},
      {label: "Default rate", value: displayPercent(defaultRate)},
    ]
  }

  return (
    <div className={`pool-status background-container ${pool ? "" : "placeholder"}`}>
      <h2>Pool Status</h2>
      <InfoSection rows={deriveRows()} />
      <RecentRepayments />
      <div className="pool-links">
        <a href={"https://dune.xyz/goldfinch/goldfinch"} target="_blank" rel="noopener noreferrer">
          Dashboard<span className="outbound-link">{iconOutArrow}</span>
        </a>
        <a href={pool ? `https://etherscan.io/address/${pool.address}` : ""} target="_blank" rel="noopener noreferrer">
          Pool<span className="outbound-link">{iconOutArrow}</span>
        </a>
      </div>
    </div>
  )
}

export default PoolStatus
export type {PoolStatusProps}
