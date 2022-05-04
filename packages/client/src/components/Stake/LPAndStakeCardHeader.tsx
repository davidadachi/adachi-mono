import BigNumber from "bignumber.js"
import styled from "styled-components"
import {ERC20Metadata} from "../../ethereum/erc20"
import {mediaPoint} from "../../styles/mediaPoint"
import {displayNumber, displayPercent} from "../../utils"
import {iconCarrotDown, iconCarrotUp} from "../icons"
import LPAndStakeTokens, {Platform} from "./LPAndStakeTokens"
import {HeaderText} from "./StakingCardHeader"

type LPAndStakeCardHeaderProps = {
  className?: string
  // Token to deposit
  depositToken: ERC20Metadata
  // LP token received in exchange
  poolToken: ERC20Metadata
  // Max amount available to deposit (denominated in depositToken decimals)
  maxAmountToDeposit: BigNumber
  // Reward APY when LP token is staked
  rewardApy: BigNumber
  // Reward token received when LP token is staked
  rewardToken: ERC20Metadata
  // Platform of the liquidity pool
  platform: Platform
  expanded?: boolean
  onToggle: () => any
}

export const HeaderGrid = styled.div`
  display: grid;
  grid-template-columns: 8fr 4fr 4fr 1fr;
  grid-column-gap: 30px;
  align-items: center;

  ${({theme}) => mediaPoint(theme).screenL} {
    grid-template-columns: 6fr 3fr 1fr;
    grid-column-gap: 20px;
  }
`

const ClickableHeaderGrid = styled(HeaderGrid)`
  cursor: pointer;
`

const Carrot = styled.button`
  > .icon {
    width: 20px;
  }
`

export default function LPAndStakeCardHeader({
  className,
  expanded,
  depositToken,
  poolToken,
  maxAmountToDeposit,
  rewardApy,
  rewardToken,
  platform,
  onToggle,
}: LPAndStakeCardHeaderProps) {
  return (
    <ClickableHeaderGrid className={className} onClick={onToggle}>
      <LPAndStakeTokens depositToken={depositToken} poolToken={poolToken} platform={platform} />
      <HeaderText justifySelf="end" hideOnSmallerScreens={false}>{`${displayPercent(rewardApy)} ${
        rewardToken.ticker
      }`}</HeaderText>
      <HeaderText justifySelf="end" light={maxAmountToDeposit.isZero()} hideOnSmallerScreens>
        {displayNumber(maxAmountToDeposit.div(new BigNumber(10).pow(depositToken.decimals)))}
      </HeaderText>
      <Carrot>{expanded ? iconCarrotUp : iconCarrotDown}</Carrot>
    </ClickableHeaderGrid>
  )
}
