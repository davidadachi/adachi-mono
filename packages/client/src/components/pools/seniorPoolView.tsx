import {useContext, useEffect, useState} from "react"
import {AppContext} from "../../App"
import {usdcFromAtomic} from "../../ethereum/erc20"
import {CapitalProvider, fetchCapitalProviderData, SeniorPoolLoaded, StakingRewardsLoaded} from "../../ethereum/pool"
import {useStaleWhileRevalidating} from "../../hooks/useAsync"
import {eligibleForSeniorPool, useKYC} from "../../hooks/useKYC"
import {useStakingRewards} from "../../hooks/useStakingRewards"
import {Loadable} from "../../types/loadable"
import {assertNonNullable, displayDollars} from "../../utils"
import ConnectionNotice from "../connectionNotice"
import EarnActionsContainer from "../earnActionsContainer"
import InvestorNotice from "../investorNotice"
import PoolStatus from "../poolStatus"
import StakeFiduBanner from "../stakeFiduBanner"

function SeniorPoolView(): JSX.Element {
  const {pool, user, goldfinchConfig, refreshCurrentBlock} = useContext(AppContext)
  const [capitalProvider, setCapitalProvider] = useState<Loadable<CapitalProvider>>({
    loaded: false,
    value: undefined,
  })
  const stakingRewards = useStakingRewards()
  const kycResult = useKYC()
  const kyc = useStaleWhileRevalidating(kycResult)

  useEffect(() => {
    if (pool && stakingRewards && user.address) {
      refreshCapitalProviderData(pool, stakingRewards, user.address)
    }
  }, [pool, stakingRewards, user.address])

  async function refreshCapitalProviderData(
    pool: SeniorPoolLoaded,
    stakingRewards: StakingRewardsLoaded,
    address: string
  ) {
    if (pool.info.value.currentBlock.number === stakingRewards.info.value.currentBlock.number) {
      const capitalProvider = await fetchCapitalProviderData(pool, stakingRewards, address)
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
  let maxCapacity = goldfinchConfig.totalFundsLimit
  if (pool && goldfinchConfig && pool.info.value.poolData.remainingCapacity(maxCapacity).isEqualTo("0")) {
    maxCapacityNotice = (
      <div className="info-banner background-container">
        <div className="message">
          <span>
            The pool has reached its max capacity of {displayDollars(usdcFromAtomic(maxCapacity))}. Join our{" "}
            <a href="https://discord.gg/HVeaca3fN8">Discord</a> for updates on when the cap is raised.
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
        isPaused={pool?.info.value.isPaused}
      />
      {maxCapacityNotice}
      <InvestorNotice />
      <EarnActionsContainer
        poolData={pool?.info.loaded ? pool.info.value.poolData : undefined}
        capitalProvider={capitalProvider.loaded ? capitalProvider.value : undefined}
        actionComplete={actionComplete}
        kyc={kyc}
      />
      <StakeFiduBanner
        poolData={pool?.info.loaded ? pool.info.value.poolData : undefined}
        capitalProvider={capitalProvider.loaded ? capitalProvider.value : undefined}
        actionComplete={actionComplete}
        kyc={kyc}
      />
      <PoolStatus pool={pool} />
    </div>
  )
}

export default SeniorPoolView
