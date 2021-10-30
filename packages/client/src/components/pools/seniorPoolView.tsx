import {useContext, useEffect, useState} from "react"
import {AppContext} from "../../App"
import {usdcFromAtomic} from "../../ethereum/erc20"
import {GFILoaded} from "../../ethereum/gfi"
import {CapitalProvider, fetchCapitalProviderData, SeniorPoolLoaded, StakingRewardsLoaded} from "../../ethereum/pool"
import {useStaleWhileRevalidating} from "../../hooks/useAsync"
import {eligibleForSeniorPool, useKYC} from "../../hooks/useKYC"
import {Loadable} from "../../types/loadable"
import {assertNonNullable, displayDollars} from "../../utils"
import ConnectionNotice from "../connectionNotice"
import EarnActionsContainer from "../earnActionsContainer"
import InvestorNotice from "../investorNotice"
import PoolStatus from "../poolStatus"
import StakeFiduBanner from "../stakeFiduBanner"

function SeniorPoolView(): JSX.Element {
  const {pool, user, goldfinchConfig, stakingRewards, gfi, refreshCurrentBlock} = useContext(AppContext)
  const [capitalProvider, setCapitalProvider] = useState<Loadable<CapitalProvider>>({
    loaded: false,
    value: undefined,
  })
  const kycResult = useKYC()
  const kyc = useStaleWhileRevalidating(kycResult)

  useEffect(() => {
    if (pool && stakingRewards && gfi && user.address) {
      refreshCapitalProviderData(pool, stakingRewards, gfi, user.address)
    }
  }, [pool, stakingRewards, gfi, user.address])

  async function refreshCapitalProviderData(
    pool: SeniorPoolLoaded,
    stakingRewards: StakingRewardsLoaded,
    gfi: GFILoaded,
    address: string
  ) {
    // TODO Would be ideal to refactor this component so that the child components it renders all
    // receive state that is consistent, i.e. using `pool.poolData`, `capitalProvider` state,
    // `stakingRewards`, and `gfi` that are guaranteed to be based on the same block number. For now,
    // here we ensure that the derivation of `capitalProvider` state is done using `pool.poolData`,
    // `stakingRewards`, and `gfi` that are consistent with each other.
    const poolBlockNumber = pool.info.value.currentBlock.number
    const stakingRewardsBlockNumber = stakingRewards.info.value.currentBlock.number
    const gfiBlockNumber = gfi.info.value.currentBlock.number
    if (poolBlockNumber === stakingRewardsBlockNumber && poolBlockNumber === gfiBlockNumber) {
      const capitalProvider = await fetchCapitalProviderData(pool, stakingRewards, gfi, address)
      setCapitalProvider(capitalProvider)
    }
  }

  async function actionComplete() {
    assertNonNullable(refreshCurrentBlock)
    refreshCurrentBlock()
  }

  let earnMessage = "Loading..."
  if (capitalProvider.loaded || user.noWeb3) {
    earnMessage = "Pools / Senior Pool"
  }

  let maxCapacityNotice = <></>
  if (
    pool &&
    goldfinchConfig &&
    pool.info.value.poolData.remainingCapacity(goldfinchConfig.totalFundsLimit).isEqualTo("0")
  ) {
    maxCapacityNotice = (
      <div className="info-banner background-container">
        <div className="message">
          <span>
            The pool has reached its max capacity of {displayDollars(usdcFromAtomic(goldfinchConfig.totalFundsLimit))}.
            Join our <a href="https://discord.gg/HVeaca3fN8">Discord</a> for updates on when the cap is raised.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="content-section">
      <div className="page-header"> {earnMessage}</div>
      <ConnectionNotice
        requireUnlock={false}
        requireKYC={{kyc: kycResult, condition: (kyc) => eligibleForSeniorPool(kyc, user)}}
        isPaused={pool?.info.loaded ? pool.info.value.isPaused : undefined}
      />
      {maxCapacityNotice}
      <InvestorNotice />
      <EarnActionsContainer
        capitalProvider={capitalProvider.loaded ? capitalProvider.value : undefined}
        actionComplete={actionComplete}
        kyc={kyc}
      />
      <StakeFiduBanner
        capitalProvider={capitalProvider.loaded ? capitalProvider.value : undefined}
        actionComplete={actionComplete}
        kyc={kyc}
      />
      <PoolStatus />
    </div>
  )
}

export default SeniorPoolView
