import React, {useState} from "react"
import _ from "lodash"
import BigNumber from "bignumber.js"
import {Link} from "react-router-dom"
import {gfiFromAtomic} from "../../ethereum/gfi"
import {useGFIBalance, useRewards} from "../../hooks/useStakingRewards"
import {displayDollars, displayNumber} from "../../utils"
import {iconCarrotDown} from "../../components/icons"
import {useMediaQuery} from "react-responsive"
import {WIDTH_TYPES} from "../../components/styleConstants"
import {CommunityRewardsVesting, MerkleDistributor} from "../../ethereum/communityRewards"
import {StakedPosition, StakingRewards} from "../../ethereum/pool"

interface RewardsSummaryProps {
  claimable: BigNumber
  unvested: BigNumber
  totalGFI: BigNumber
  totalUSD: BigNumber
  walletBalance: BigNumber
}

function RewardsSummary(props: RewardsSummaryProps) {
  return (
    <div className="rewards-summary background-container">
      <div className="rewards-summary-left-item">
        <span className="total-gfi-balance">Total GFI balance</span>
        <span className="total-gfi">{displayNumber(gfiFromAtomic(props.totalGFI), 2)}</span>
        <span className="total-usd">${displayDollars(props.totalUSD)}</span>
      </div>

      <div className="rewards-summary-right-item">
        <div className="details-item">
          <span>Wallet balance</span>
          <div>
            <span className="value">{displayNumber(gfiFromAtomic(props.walletBalance), 2)}</span>
            <span>GFI</span>
          </div>
        </div>
        <div className="details-item">
          <span>Claimable</span>
          <div>
            <span className="value">{displayNumber(gfiFromAtomic(props.claimable), 2)}</span>
            <span>GFI</span>
          </div>
        </div>
        <div className="details-item">
          <span>Still vesting</span>
          <div>
            <span className="value">{displayNumber(gfiFromAtomic(props.unvested), 2)}</span>
            <span>GFI</span>
          </div>
        </div>
        <div className="details-item total-balance">
          <span>Total balance</span>
          <div>
            <span className="value">{displayNumber(gfiFromAtomic(props.totalGFI), 2)}</span>
            <span>GFI</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function NoRewards(props) {
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

function ActionButton(props) {
  const isTabletOrMobile = useMediaQuery({query: `(max-width: ${WIDTH_TYPES.screenL})`})
  const disabledClass = props.disabled ? "disabled-button" : ""

  return (
    <button className={`${!isTabletOrMobile && "table-cell"} action ${disabledClass}`} onClick={props.onClick}>
      {props.text}
    </button>
  )
}

interface RewardsListItemProps {
  isAcceptRequired: boolean
  title: string
  grantedGFI: BigNumber
  claimableGFI: BigNumber
}

function RewardsListItem(props: RewardsListItemProps) {
  const [accepted, setAccepted] = useState(!props.isAcceptRequired)
  const isTabletOrMobile = useMediaQuery({query: `(max-width: ${WIDTH_TYPES.screenL})`})

  function handleAccept() {
    setAccepted(!accepted)
  }

  const valueDisabledClass = !accepted ? "disabled-text" : ""

  const actionButtonComponent = !accepted ? (
    <ActionButton text="Accept" onClick={handleAccept} />
  ) : (
    <ActionButton text="Claim GFI" onClick={() => console.error("error")} disabled={props.claimableGFI.eq(0)} />
  )

  return (
    <>
      {!isTabletOrMobile && (
        <li className="rewards-list-item table-row background-container clickable">
          <div className="table-cell col32">{props.title}</div>
          <div className={`table-cell col20 numeric ${valueDisabledClass}`}>
            {displayNumber(gfiFromAtomic(props.grantedGFI), 2)}
          </div>
          <div className={`table-cell col20 numeric ${valueDisabledClass}`}>
            {displayNumber(gfiFromAtomic(props.claimableGFI), 2)}
          </div>
          {actionButtonComponent}
          <button className="expand">{iconCarrotDown}</button>
        </li>
      )}

      {isTabletOrMobile && (
        <li className="rewards-list-item background-container clickable mobile">
          <div className="item-header">
            <div>{props.title}</div>
            <button className="expand">{iconCarrotDown}</button>
          </div>
          <div className="item-details">
            <div className="detail-container">
              <span className="detail-label">Granted GFI</span>
              <div className={`${valueDisabledClass}`}>{displayNumber(gfiFromAtomic(props.grantedGFI), 2)}</div>
            </div>
            <div className="detail-container">
              <span className="detail-label">Claimable GFI</span>
              <div className={`${valueDisabledClass}`}>{displayNumber(gfiFromAtomic(props.claimableGFI), 2)}</div>
            </div>
          </div>
          {actionButtonComponent}
        </li>
      )}
    </>
  )
}

function getSortedRewards(
  stakingRewards: StakingRewards | undefined,
  merkleDistributor: MerkleDistributor | undefined
): (StakedPosition | CommunityRewardsVesting)[] {
  /* NOTE: First order by 0 or >0 claimable rewards (0 claimable at the bottom), then group by type
   (e.g. all the staking together, then all the airdrops), then order by most recent first */
  const stakes = stakingRewards?.positions || []
  const airdrops = merkleDistributor?.communityRewards?.grants || []

  const rewards: (StakedPosition | CommunityRewardsVesting)[] = [...stakes, ...airdrops]
  rewards.sort((i1, i2) => {
    let val = i1.claimable.minus(i2.claimable)
    if (!val.isZero()) return val.isPositive() ? -1 : 1

    if (i1 instanceof StakedPosition && i2 instanceof CommunityRewardsVesting) {
      return 1
    }

    if (i1 instanceof CommunityRewardsVesting && i2 instanceof StakedPosition) {
      return -1
    }

    if (i1 instanceof StakedPosition && i2 instanceof StakedPosition) {
      return i2.rewards.startTime - i1.rewards.startTime
    }

    return i2.rewards.startTime - i1.rewards.startTime
  })
  return rewards
}

function Rewards(props) {
  const isTabletOrMobile = useMediaQuery({query: `(max-width: ${WIDTH_TYPES.screenL})`})
  const {stakingRewards, merkleDistributor} = useRewards()
  const gfiBalance = useGFIBalance()

  let claimable
  let unvested
  let granted
  if (stakingRewards?.totalClaimable || merkleDistributor?.totalClaimable) {
    let val = stakingRewards?.totalClaimable || new BigNumber(0)
    claimable = val.plus(merkleDistributor?.totalClaimable || new BigNumber(0))
  }

  if (stakingRewards?.unvested || merkleDistributor?.unvested) {
    let val = stakingRewards?.unvested || new BigNumber(0)
    unvested = val.plus(merkleDistributor?.unvested || new BigNumber(0))
  }

  if (stakingRewards?.granted || merkleDistributor?.granted) {
    let val = stakingRewards?.granted || new BigNumber(0)
    granted = val.plus(merkleDistributor?.granted || new BigNumber(0))
  }

  function capitalizeReason(reason: string): string {
    return reason
      .split("_")
      .map((s) => _.capitalize(s))
      .join(" ")
  }

  const rewards = getSortedRewards(stakingRewards, merkleDistributor)
  const emptyRewards =
    (!merkleDistributor?.communityRewards.grants &&
      !merkleDistributor?.actionRequiredAirdrops &&
      !stakingRewards?.positions) ||
    (!merkleDistributor?.communityRewards?.grants?.length &&
      !merkleDistributor?.actionRequiredAirdrops?.length &&
      !stakingRewards?.positions?.length)
  return (
    <div className="content-section">
      <div className="page-header">
        <h1>Rewards</h1>
      </div>

      <RewardsSummary
        claimable={claimable}
        unvested={unvested}
        totalGFI={granted}
        totalUSD={new BigNumber("")} // TODO: this needs to be updated once we have a price for GFI in USD.
        walletBalance={gfiBalance || new BigNumber(0)}
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
        <ul className="rewards-list">
          {merkleDistributor?.loaded && stakingRewards?.loaded && emptyRewards ? (
            <NoRewards />
          ) : (
            <>
              {rewards &&
                rewards.map((item) => {
                  return (
                    <RewardsListItem
                      key={`reward-${item.rewards.startTime}`}
                      isAcceptRequired={false}
                      title={capitalizeReason(item.reason)}
                      grantedGFI={item.granted}
                      claimableGFI={item.claimable}
                    />
                  )
                })}

              {merkleDistributor?.actionRequiredAirdrops &&
                merkleDistributor.actionRequiredAirdrops.map((item) => (
                  <RewardsListItem
                    key={`${item.reason}-${item.index}`}
                    isAcceptRequired={true}
                    title={capitalizeReason(item.reason)}
                    grantedGFI={new BigNumber(item.grant.amount)}
                    claimableGFI={new BigNumber(0)}
                  />
                ))}
            </>
          )}
        </ul>
      </div>
    </div>
  )
}

export default Rewards
