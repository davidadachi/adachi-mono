import BigNumber from "bignumber.js"
import styled from "styled-components"
import {displayNumber, displayPercent} from "../../utils"
import StakingToken, {Platform} from "./StakingToken"
import {iconCarrotDown, iconCarrotUp} from "../icons"
import {mediaPoint} from "../../styles/mediaPoint"
import {ERC20Metadata} from "../../ethereum/erc20"

type StakingCardHeaderProps = {
  className?: string
  // Token to stake
  token: ERC20Metadata
  // Max amount available to stake (denominated in `token` decimals)
  maxAmountToStake: BigNumber
  // Max amount available to unstake (denominated in `token` decimals)
  maxAmountToUnstake: BigNumber
  // Staking reward APY
  rewardApy: BigNumber
  // Reward token recieved for staking
  rewardToken: ERC20Metadata
  // Platform of the staking token
  platform: Platform
  expanded?: boolean
  onToggle: () => any
}

export const HeaderGrid = styled.div`
  display: grid;
  grid-template-columns: 6fr 4fr 4fr 4fr 1fr;
  grid-column-gap: 30px;
  cursor: pointer;
  align-items: center;

  ${({theme}) => mediaPoint(theme).screenL} {
    grid-template-columns: 6fr 4fr 1fr;
    grid-column-gap: 20px;
  }
`

const ClickableHeaderGrid = styled(HeaderGrid)`
  cursor: pointer;
`

export const HeaderText = styled.div<{light?: boolean; justifySelf: string; hideOnSmallerScreens: boolean}>`
  display: block;
  font-size: 18px;
  font-weight: normal;
  justify-self: ${({justifySelf}) => justifySelf};
  color: ${({light}) => (!!light ? "#C3BEB7" : "inherit")};

  ${({theme}) => mediaPoint(theme).screenL} {
    display: ${({hideOnSmallerScreens}) => (hideOnSmallerScreens ? "none" : "block")};
  }
`

const Carrot = styled.button`
  > .icon {
    width: 20px;
  }
`

export default function StakingCardHeader({
  className,
  expanded,
  token,
  maxAmountToStake,
  maxAmountToUnstake,
  rewardApy,
  rewardToken,
  platform,
  onToggle,
}: StakingCardHeaderProps) {
  return (
    <ClickableHeaderGrid className={className} onClick={onToggle}>
      <StakingToken token={token} platform={platform} />
      <HeaderText justifySelf="end" hideOnSmallerScreens={false}>{`${displayPercent(rewardApy)} ${
        rewardToken.ticker
      }`}</HeaderText>
      <HeaderText justifySelf="end" light={maxAmountToStake.isZero()} hideOnSmallerScreens>
        {displayNumber(maxAmountToStake.div(new BigNumber(10).pow(token.decimals)))}
      </HeaderText>
      <HeaderText justifySelf="end" light={maxAmountToUnstake.isZero()} hideOnSmallerScreens>
        {displayNumber(maxAmountToUnstake.div(new BigNumber(10).pow(token.decimals)))}
      </HeaderText>
      <Carrot>{expanded ? iconCarrotUp : iconCarrotDown}</Carrot>
    </ClickableHeaderGrid>
  )
}
