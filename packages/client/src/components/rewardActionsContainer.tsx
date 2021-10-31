import {MerkleDistributorGrantInfo} from "@goldfinch-eng/protocol/blockchain_scripts/merkleDistributor/types"
import {assertUnreachable} from "@goldfinch-eng/utils/src/type"
import BigNumber from "bignumber.js"
import _ from "lodash"
import React, {useState} from "react"
import {useMediaQuery} from "react-responsive"
import {CommunityRewardsGrant, CommunityRewardsLoaded, MerkleDistributorLoaded} from "../ethereum/communityRewards"
import {gfiFromAtomic, gfiInDollars, GFILoaded, gfiToDollarsAtomic} from "../ethereum/gfi"
import {StakingRewardsLoaded, StakingRewardsPosition} from "../ethereum/pool"
import useSendFromUser from "../hooks/useSendFromUser"
import {
  Column,
  ColumnsContainer,
  Detail,
  DetailLabel,
  DetailsContainer,
  DetailValue,
  EtherscanLinkContainer,
} from "../pages/rewards/styles"
import {assertNonNullable, displayDollars, displayNumber} from "../utils"
import EtherscanLink from "./etherscanLink"
import {iconCarrotDown, iconCarrotUp, iconOutArrow} from "./icons"
import LoadingButton from "./loadingButton"
import {WIDTH_TYPES} from "./styleConstants"
import TransactionForm from "./transactionForm"

interface ActionButtonProps {
  text: string
  disabled: boolean
  onClick: () => Promise<void>
}

function ActionButton(props: ActionButtonProps) {
  const [isPending, setIsPending] = useState<boolean>(false)
  const isTabletOrMobile = useMediaQuery({query: `(max-width: ${WIDTH_TYPES.screenL})`})
  const disabledClass = props.disabled || isPending ? "disabled-button" : ""

  async function action(): Promise<void> {
    setIsPending(true)
    await props.onClick()
    setIsPending(false)
  }

  return (
    <button className={`${!isTabletOrMobile && "table-cell"} action ${disabledClass}`} onClick={action}>
      {props.text}
    </button>
  )
}

interface OpenDetailsProps {
  open: boolean
}

function OpenDetails(props: OpenDetailsProps) {
  if (props.open) {
    return <button className="expand close">{iconCarrotUp}</button>
  }

  return <button className="expand">{iconCarrotDown}</button>
}

interface DetailsProps {
  open: boolean
  disabled: boolean
  transactionDetails: string
  vestingSchedule: string
  claimStatus: string
  currentEarnRate: string
  vestingStatus: string
  etherscanAddress: string
}

function Details(props: DetailsProps) {
  return (
    <DetailsContainer open={props.open} disabled={props.disabled}>
      <ColumnsContainer>
        <Column>
          <Detail>
            <DetailLabel>Transaction details</DetailLabel>
            <DetailValue>{props.transactionDetails}</DetailValue>
          </Detail>
          <Detail>
            <DetailLabel>Vesting schedule</DetailLabel>
            <DetailValue>{props.vestingSchedule}</DetailValue>
          </Detail>
          <Detail>
            <DetailLabel>Claim status</DetailLabel>
            <DetailValue>{props.claimStatus}</DetailValue>
          </Detail>
        </Column>
        <Column>
          <Detail>
            <DetailLabel>Current earn rate</DetailLabel>
            <DetailValue>{props.currentEarnRate}</DetailValue>
          </Detail>
          <Detail>
            <DetailLabel>Vesting status</DetailLabel>
            <DetailValue>{props.vestingStatus}</DetailValue>
          </Detail>
        </Column>
      </ColumnsContainer>
      <EtherscanLinkContainer className="pool-links">
        <EtherscanLink address={props.etherscanAddress}>
          Etherscan<span className="outbound-link">{iconOutArrow}</span>
        </EtherscanLink>
      </EtherscanLinkContainer>
    </DetailsContainer>
  )
}

interface ClaimFormProps {
  totalUSD: BigNumber
  claimable: BigNumber
  disabled: boolean
  onCloseForm: () => void
  action: () => Promise<void>
}

function ClaimForm(props: ClaimFormProps) {
  function renderForm({formMethods}) {
    return (
      <div className="info-banner background-container subtle">
        <div className="message">
          Claim the total available {displayNumber(gfiFromAtomic(props.claimable), 2)} GFI ($
          {displayDollars(props.totalUSD)}) that has vested.
        </div>
        <LoadingButton text="Submit" action={props.action} disabled={props.disabled} />
      </div>
    )
  }

  return <TransactionForm headerMessage="Claim" render={renderForm} closeForm={props.onCloseForm} />
}

enum RewardStatus {
  Acceptable,
  Claimable,
  TemporarilyAllClaimed,
  PermanentlyAllClaimed,
}

function getActionButtonProps(props: RewardsListItemProps): ActionButtonProps {
  const baseProps: Pick<ActionButtonProps, "onClick"> = {
    onClick: props.handleOnClick,
  }
  switch (props.status) {
    case RewardStatus.Acceptable:
      return {
        ...baseProps,
        text: "Accept",
        disabled: false,
      }
    case RewardStatus.Claimable:
      return {
        ...baseProps,
        text: "Claim GFI",
        disabled: false,
      }
    case RewardStatus.TemporarilyAllClaimed:
      return {
        ...baseProps,
        text: "Claim GFI",
        disabled: true,
      }
    case RewardStatus.PermanentlyAllClaimed:
      return {
        ...baseProps,
        text: "Claimed",
        disabled: true,
      }
    default:
      assertUnreachable(props.status)
  }
}

interface RewardsListItemProps {
  title: string
  grantedGFI: BigNumber
  claimableGFI: BigNumber
  status: RewardStatus
  handleOnClick: () => Promise<void>
}

function RewardsListItem(props: RewardsListItemProps) {
  const [open, setOpen] = useState<boolean>(false)
  const isTabletOrMobile = useMediaQuery({query: `(max-width: ${WIDTH_TYPES.screenL})`})

  const disabledText = props.status === RewardStatus.Acceptable
  const valueDisabledClass = disabledText ? "disabled-text" : ""

  const actionButtonComponent = <ActionButton {...getActionButtonProps(props)} />

  // TODO: remove when using real data
  const fakeDetailsObject = {
    transactionDetails: "16,179.69 FIDU staked on Nov 1, 2021",
    vestingSchedule: "Linear until 100% on Nov 1, 2022",
    claimStatus: "0 GFI claimed of your total vested 4.03 GFI",
    currentEarnRate: "+10.21 granted per week",
    vestingStatus: "8.0% (4.03 GFI) vested so far",
    etherscanAddress: "",
  }

  const detailsComponent = (
    <Details
      open={open}
      disabled={disabledText}
      transactionDetails={fakeDetailsObject.transactionDetails}
      vestingSchedule={fakeDetailsObject.vestingSchedule}
      claimStatus={fakeDetailsObject.claimStatus}
      currentEarnRate={fakeDetailsObject.currentEarnRate}
      vestingStatus={fakeDetailsObject.vestingStatus}
      etherscanAddress={fakeDetailsObject.etherscanAddress}
    />
  )

  return (
    <>
      {isTabletOrMobile ? (
        <li onClick={() => setOpen(!open)}>
          <div className="rewards-list-item background-container clickable mobile">
            <div className="item-header">
              <div>{props.title}</div>
              <OpenDetails open={open} />
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
          </div>
          {open && detailsComponent}
        </li>
      ) : (
        <li onClick={() => setOpen(!open)}>
          <div className="rewards-list-item table-row background-container clickable">
            <div className="table-cell col32">{props.title}</div>
            <div className={`table-cell col20 numeric ${valueDisabledClass}`}>
              {displayNumber(gfiFromAtomic(props.grantedGFI), 2)}
            </div>
            <div className={`table-cell col20 numeric ${valueDisabledClass}`}>
              {displayNumber(gfiFromAtomic(props.claimableGFI), 2)}
            </div>
            {actionButtonComponent}
            <OpenDetails open={open} />
          </div>
          {open && detailsComponent}
        </li>
      )}
    </>
  )
}

function capitalizeMerkleDistributorGrantReason(reason: string): string {
  return reason
    .split("_")
    .map((s) => _.startCase(s))
    .join(" ")
}

interface RewardActionsContainerProps {
  gfi: GFILoaded
  merkleDistributor: MerkleDistributorLoaded
  stakingRewards: StakingRewardsLoaded
  communityRewards: CommunityRewardsLoaded
  item: CommunityRewardsGrant | StakingRewardsPosition | MerkleDistributorGrantInfo
}

function RewardActionsContainer(props: RewardActionsContainerProps) {
  const sendFromUser = useSendFromUser()
  const [showAction, setShowAction] = useState<boolean>(false)
  const {item} = props

  function onCloseForm() {
    setShowAction(false)
  }

  function handleClaim(rewards: CommunityRewardsLoaded | StakingRewardsLoaded, tokenId: string) {
    assertNonNullable(rewards)
    return sendFromUser(rewards.contract.methods.getReward(tokenId), {
      type: "Claim",
    })
  }

  function handleAccept(info: MerkleDistributorGrantInfo): Promise<void> {
    assertNonNullable(props.merkleDistributor)
    return sendFromUser(
      props.merkleDistributor.contract.methods.acceptGrant(
        info.index,
        info.account,
        info.grant.amount,
        info.grant.vestingLength,
        info.grant.cliffLength,
        info.grant.vestingInterval,
        info.proof
      ),
      {
        type: "Accept",
        index: info.index,
      }
    )
  }

  if (item instanceof CommunityRewardsGrant || item instanceof StakingRewardsPosition) {
    const title =
      item instanceof StakingRewardsPosition ? item.reason : capitalizeMerkleDistributorGrantReason(item.reason)

    if (item.claimable.eq(0)) {
      const status: RewardStatus =
        item instanceof CommunityRewardsGrant
          ? item.claimed.lt(item.granted)
            ? RewardStatus.TemporarilyAllClaimed
            : RewardStatus.PermanentlyAllClaimed
          : // Staking rewards are never "permanently" all-claimed; even after vesting is finished, stakings keep
            // earning rewards that vest immediately.
            RewardStatus.TemporarilyAllClaimed
      return (
        <RewardsListItem
          status={status}
          title={title}
          grantedGFI={item.granted}
          claimableGFI={item.claimable}
          handleOnClick={() => Promise.resolve()}
        />
      )
    } else if (!showAction) {
      return (
        <RewardsListItem
          status={RewardStatus.Claimable}
          title={title}
          grantedGFI={item.granted}
          claimableGFI={item.claimable}
          handleOnClick={async () => setShowAction(true)}
        />
      )
    }

    const reward = item instanceof StakingRewardsPosition ? props.stakingRewards : props.communityRewards
    return (
      <ClaimForm
        action={async (): Promise<void> => {
          await handleClaim(reward, item.tokenId)
          onCloseForm()
        }}
        disabled={item.claimable.eq(0)}
        claimable={item.claimable}
        totalUSD={gfiInDollars(gfiToDollarsAtomic(item.claimable, props.gfi.info.value.price))}
        onCloseForm={onCloseForm}
      />
    )
  } else {
    const title = capitalizeMerkleDistributorGrantReason(item.reason)
    return (
      <RewardsListItem
        status={RewardStatus.Acceptable}
        title={title}
        grantedGFI={new BigNumber(item.grant.amount)}
        claimableGFI={new BigNumber(0)}
        handleOnClick={() => handleAccept(item)}
      />
    )
  }
}

export default RewardActionsContainer
