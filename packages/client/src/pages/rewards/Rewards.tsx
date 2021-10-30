import {assertUnreachable} from "@goldfinch-eng/utils/src/type"
import BigNumber from "bignumber.js"
import React, {useContext} from "react"
import {useMediaQuery} from "react-responsive"
import {Link} from "react-router-dom"
import {AppContext} from "../../App"
import RewardActionsContainer from "../../components/rewardActionsContainer"
import {WIDTH_TYPES} from "../../components/styleConstants"
import {CommunityRewardsGrant, MerkleDistributorLoaded} from "../../ethereum/communityRewards"
import {gfiFromAtomic, gfiInDollars, GFILoaded, gfiToDollarsAtomic} from "../../ethereum/gfi"
import {StakingRewardsLoaded, StakingRewardsPosition} from "../../ethereum/pool"
import {UserLoaded} from "../../ethereum/user"
import {useFromSameBlock} from "../../hooks/useFromSameBlock"
import {useMerkleDistributor} from "../../hooks/useMerkleDistributor"
import {displayDollars, displayNumber} from "../../utils"

interface RewardsSummaryProps {
  claimable: BigNumber | undefined
  unvested: BigNumber | undefined
  totalGFI: BigNumber | undefined
  totalUSD: BigNumber | undefined
  walletBalance: BigNumber | undefined
}

function RewardsSummary(props: RewardsSummaryProps) {
  const {claimable, unvested, totalGFI, totalUSD, walletBalance} = props

  const valueDisabledClass = totalGFI && totalGFI.gt(0) ? "value" : "disabled-value"

  return (
    <div className="rewards-summary background-container">
      <div className="rewards-summary-left-item">
        <span className="total-gfi-balance">Total GFI balance</span>
        <span className="total-gfi">{displayNumber(totalGFI ? gfiFromAtomic(totalGFI) : undefined, 2)}</span>
        <span className="total-usd">{displayDollars(totalUSD)}</span>
      </div>

      <div className="rewards-summary-right-item">
        <div className="details-item">
          <span>Wallet balance</span>
          <div>
            <span className={valueDisabledClass}>
              {displayNumber(walletBalance ? gfiFromAtomic(walletBalance) : undefined, 2)}
            </span>
            <span>GFI</span>
          </div>
        </div>
        <div className="details-item">
          <span>Claimable</span>
          <div>
            <span className={valueDisabledClass}>
              {displayNumber(claimable ? gfiFromAtomic(claimable) : undefined, 2)}
            </span>
            <span>GFI</span>
          </div>
        </div>
        <div className="details-item">
          <span>Still vesting</span>
          <div>
            <span className={valueDisabledClass}>
              {displayNumber(unvested ? gfiFromAtomic(unvested) : undefined, 2)}
            </span>
            <span>GFI</span>
          </div>
        </div>
        <div className="details-item total-balance">
          <span>Total balance</span>
          <div>
            <span className={valueDisabledClass}>
              {displayNumber(totalGFI ? gfiFromAtomic(totalGFI) : undefined, 2)}
            </span>
            <span>GFI</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function NoRewards() {
  return (
    <li className="table-row rewards-list-item no-rewards background-container">
      You have no rewards. You can earn rewards by supplying to&nbsp;
      <Link to="/pools/senior">
        <span className="senior-pool-link">pools</span>
      </Link>
      .
    </li>
  )
}

type SortableRewards =
  | {
      type: "stakingRewards"
      value: StakingRewardsPosition
    }
  | {
      type: "communityRewards"
      value: CommunityRewardsGrant
    }

const getStartTime = (sortable: SortableRewards): number => {
  switch (sortable.type) {
    case "stakingRewards":
      return sortable.value.storedPosition.rewards.startTime
    case "communityRewards":
      return sortable.value.rewards.startTime
    default:
      assertUnreachable(sortable)
  }
}
const getClaimable = (sortable: SortableRewards): BigNumber => {
  switch (sortable.type) {
    case "stakingRewards":
      return sortable.value.claimable
    case "communityRewards":
      return sortable.value.claimable
    default:
      assertUnreachable(sortable)
  }
}

function getSortedRewards(
  stakingRewards: StakingRewardsLoaded,
  merkleDistributor: MerkleDistributorLoaded
): SortableRewards[] {
  /* NOTE: First order by 0 or >0 claimable rewards (0 claimable at the bottom), then group by type
   (e.g. all the staking together, then all the airdrops), then order by most recent first */
  const stakes = stakingRewards.info.value.positions
  const grants = merkleDistributor.info.value.communityRewards.info.value.grants

  const sorted: SortableRewards[] = [
    ...stakes.map(
      (value): SortableRewards => ({
        type: "stakingRewards",
        value,
      })
    ),
    ...grants.map(
      (value): SortableRewards => ({
        type: "communityRewards",
        value,
      })
    ),
  ]
  sorted.sort((i1, i2) => getStartTime(i1) - getStartTime(i2))
  sorted.sort((i1, i2) => {
    const comparedByClaimable = getClaimable(i1).minus(getClaimable(i2))
    if (!comparedByClaimable.isZero()) return comparedByClaimable.isPositive() ? -1 : 1

    if (i1.type === "stakingRewards" && i2.type === "communityRewards") {
      return -1
    }

    if (i1.type === "communityRewards" && i2.type === "stakingRewards") {
      return 1
    }

    return getStartTime(i2) - getStartTime(i1)
  })
  return sorted
}

function Rewards() {
  const {stakingRewards: _stakingRewards, gfi: _gfi, user: _user} = useContext(AppContext)
  const isTabletOrMobile = useMediaQuery({query: `(max-width: ${WIDTH_TYPES.screenL})`})
  const _merkleDistributor = useMerkleDistributor()
  const consistent = useFromSameBlock<StakingRewardsLoaded, GFILoaded, MerkleDistributorLoaded, UserLoaded>(
    _stakingRewards,
    _gfi,
    _merkleDistributor,
    _user
  )

  let loaded: boolean = false
  let claimable: BigNumber | undefined
  let unvested: BigNumber | undefined
  let granted: BigNumber | undefined
  let totalUSD: BigNumber | undefined
  let gfiBalance: BigNumber | undefined
  let rewards: React.ReactNode | undefined
  if (consistent) {
    const stakingRewards = consistent[0]
    const gfi = consistent[1]
    const merkleDistributor = consistent[2]
    const user = consistent[3]

    loaded = merkleDistributor.info.loaded && stakingRewards.info.loaded

    const sortedRewards = getSortedRewards(stakingRewards, merkleDistributor)

    const emptyRewards =
      !merkleDistributor.info.value.communityRewards.info.value.grants.length &&
      !merkleDistributor.info.value.actionRequiredAirdrops.length &&
      !stakingRewards.info.value.positions.length

    claimable = stakingRewards.info.value.claimable.plus(merkleDistributor.info.value.claimable)
    unvested = stakingRewards.info.value.unvested.plus(merkleDistributor.info.value.unvested)
    granted = stakingRewards.info.value.granted.plus(merkleDistributor.info.value.granted)

    gfiBalance = user.info.value.gfiBalance

    totalUSD = gfiInDollars(gfiToDollarsAtomic(granted, gfi.info.value.price))

    rewards = emptyRewards ? (
      <NoRewards />
    ) : (
      <>
        {merkleDistributor &&
          merkleDistributor.info.value.actionRequiredAirdrops.map((item) => (
            <RewardActionsContainer
              key={`airdrop-${item.index}`}
              item={item}
              gfi={gfi}
              merkleDistributor={merkleDistributor}
              stakingRewards={stakingRewards}
            />
          ))}

        {sortedRewards &&
          sortedRewards.map((item) => {
            return (
              <RewardActionsContainer
                key={`${item.type}-${item.value.tokenId}`}
                item={item.value}
                gfi={gfi}
                merkleDistributor={merkleDistributor}
                stakingRewards={stakingRewards}
              />
            )
          })}
      </>
    )
  }

  return (
    <div className="content-section">
      <div className="page-header">
        <h1>Rewards</h1>
      </div>

      <RewardsSummary
        claimable={claimable}
        unvested={unvested}
        totalGFI={granted}
        totalUSD={totalUSD}
        walletBalance={gfiBalance}
      />

      <div className="gfi-rewards table-spaced">
        <div className="table-header background-container-inner">
          <h2 className="table-cell col32 title">GFI Rewards</h2>
          {!isTabletOrMobile && (
            <>
              <div className="table-cell col20 numeric balance break-granted-column">Granted GFI</div>
              <div className="table-cell col20 numeric limit break-claimable-column">Claimable GFI</div>
            </>
          )}
        </div>
        <ul className="rewards-list">{loaded ? rewards : <span>Loading...</span>}</ul>
      </div>
    </div>
  )
}

export default Rewards
