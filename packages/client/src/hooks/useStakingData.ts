import BigNumber from "bignumber.js"
import {useContext, useEffect, useState} from "react"
import {AppContext} from "../App"
import {fetchCapitalProviderData, StakedPositionType, StakingRewardsPosition} from "../ethereum/pool"
import {AssertionError, assertNonNullable} from "../utils"
import {useFromSameBlock} from "./useFromSameBlock"
import useSendFromUser from "./useSendFromUser"
import {
  DEPOSIT_TO_CURVE_AND_STAKE_TX_TYPE,
  DEPOSIT_TO_CURVE_TX_TYPE,
  STAKE_TX_TYPE,
  UNSTAKE_MULTIPLE_TX_TYPE,
  ZAP_STAKE_TO_CURVE_TX_TYPE,
} from "../types/transactions"
import {gfiToDollarsAtomic} from "../ethereum/gfi"
import {ONE_YEAR_SECONDS} from "../ethereum/utils"
import useApprove from "./useApprove"
import {getERC20Metadata, Ticker, toAtomic} from "../ethereum/erc20"

const CURVE_FIDU_USDC_DECIMALS = new BigNumber(String(10 ** getERC20Metadata(Ticker.CURVE_FIDU_USDC).decimals))

type StakingData = {
  fiduStaked: BigNumber
  fiduUnstaked: BigNumber
  fiduUSDCCurveStaked: BigNumber
  fiduUSDCCurveUnstaked: BigNumber
  usdcUnstaked: BigNumber
  estimatedFiduStakingApy: BigNumber
  estimatedCurveStakingApy: BigNumber
  stake: (BigNumber, StakedPositionType) => Promise<any>
  unstake: (BigNumber, StakedPositionType) => Promise<any>
  depositToCurve: (fiduAmount: BigNumber, usdcAmount: BigNumber) => Promise<any>
  depositToCurveAndStake: (fiduAmount: BigNumber, usdcAmount: BigNumber) => Promise<any>
  zapStakeToCurve: (fiduAmount: BigNumber, usdcAmount: BigNumber) => Promise<any>
}

export default function useStakingData(): StakingData {
  const sendFromUser = useSendFromUser()
  const approve = useApprove()

  const {
    pool: _pool,
    user: _user,
    gfi: _gfi,
    stakingRewards: _stakingRewards,
    zapper: _zapper,
    currentBlock,
  } = useContext(AppContext)
  const consistent = useFromSameBlock({setAsLeaf: false}, currentBlock, _pool, _user, _gfi, _stakingRewards, _zapper)
  const pool = consistent?.[0]
  const user = consistent?.[1]
  const gfi = consistent?.[2]
  const stakingRewards = consistent?.[3]
  const zapper = consistent?.[4]

  const [stakedPositions, setStakedPositions] = useState<StakingRewardsPosition[]>([])
  const [fiduStaked, setFiduStaked] = useState(new BigNumber(0))
  const [fiduUnstaked, setFiduUnstaked] = useState(new BigNumber(0))
  const [fiduUSDCCurveStaked, setFiduUSDCCurveStaked] = useState(new BigNumber(0))
  const [fiduUSDCCurveUnstaked, setFiduUSDCCurveUnstaked] = useState(new BigNumber(0))
  const [usdcUnstaked, setUSDCUnstaked] = useState(new BigNumber(0))
  const [estimatedCurveStakingApy, setEstimatedCurveStakingApy] = useState<BigNumber>(new BigNumber(0))
  const [estimatedFiduStakingApy, setEstimatedFiduStakingApy] = useState<BigNumber>(new BigNumber(0))

  useEffect(() => {
    if (pool && user && currentBlock) {
      setUnstakedData()
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBlock, pool, user])

  useEffect(() => {
    if (currentBlock && pool && stakingRewards && gfi && user) {
      setStakedData()
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBlock, pool, stakingRewards, gfi, user])

  useEffect(() => {
    if (stakingRewards) {
      const curveLPTokenPrice = stakingRewards.info.value.curveLPTokenPrice
      const currentEarnRatePerYearPerFidu = stakingRewards.info.value.currentEarnRate.multipliedBy(ONE_YEAR_SECONDS)
      const currentEarnRatePerYearPerCurveToken = currentEarnRatePerYearPerFidu
        .div(stakingRewards.info.value.curveLPTokenMultiplier)
        .multipliedBy(curveLPTokenPrice)

      const estimatedApyFromGfi = gfiToDollarsAtomic(currentEarnRatePerYearPerCurveToken, curveLPTokenPrice)
        ?.multipliedBy(
          // This might be better thought of as the share-price mantissa, which happens to be the
          // same as `CURVE_FIDU_USDC_DECIMALS`.
          CURVE_FIDU_USDC_DECIMALS
        )
        .dividedBy(curveLPTokenPrice)
        .dividedBy(CURVE_FIDU_USDC_DECIMALS)
      setEstimatedCurveStakingApy(estimatedApyFromGfi || new BigNumber(0))
    }
  }, [currentBlock, stakingRewards])

  async function setStakedData() {
    assertNonNullable(pool)
    assertNonNullable(stakingRewards)
    assertNonNullable(gfi)
    assertNonNullable(user)

    const capitalProviderData = await fetchCapitalProviderData(pool, stakingRewards, gfi, user)

    const unstakeablePositions = capitalProviderData.value.unstakeablePositions
    setStakedPositions(unstakeablePositions)

    const unstakeableFiduPositions = unstakeablePositions.filter(
      (position) => position.storedPosition.positionType === StakedPositionType.Fidu
    )
    const unstakeableCurvePositions = unstakeablePositions.filter(
      (position) => position.storedPosition.positionType === StakedPositionType.CurveLP
    )

    setFiduStaked(
      unstakeableFiduPositions.reduce((total, position) => {
        return total.plus(position.storedPosition.amount)
      }, new BigNumber(0))
    )
    setFiduUSDCCurveStaked(
      unstakeableCurvePositions.reduce((total, position) => {
        return total.plus(position.storedPosition.amount)
      }, new BigNumber(0))
    )

    setEstimatedFiduStakingApy(pool.info.value.poolData.estimatedApyFromGfi || new BigNumber(0))
  }

  async function setUnstakedData() {
    assertNonNullable(stakingRewards)
    assertNonNullable(pool)
    assertNonNullable(user)
    const unstakedFidu = new BigNumber(
      await pool.fidu.userWallet.methods.balanceOf(user.address).call(undefined, "latest")
    )

    const unstakedCurve = new BigNumber(
      await stakingRewards.curveLPToken.userWallet.methods.balanceOf(user.address).call(undefined, "latest")
    )
    const unstakedUSDC = new BigNumber(
      await pool.usdc.userWallet.methods.balanceOf(user.address).call(undefined, "latest")
    )

    setFiduUnstaked(unstakedFidu)
    setFiduUSDCCurveUnstaked(unstakedCurve)
    setUSDCUnstaked(unstakedUSDC)
  }

  async function stake(amount: BigNumber, positionType: StakedPositionType) {
    assertNonNullable(stakingRewards)
    assertNonNullable(user)

    const ticker: Ticker = tickerForStakedPositionType(positionType)

    return approve(amount, ticker, stakingRewards.address).then(() =>
      sendFromUser(stakingRewards.contract.userWallet.methods.stake(amount.toString(10), positionType), {
        type: STAKE_TX_TYPE,
        data: {
          amount: toAtomic(amount, ticker),
          ticker: getERC20Metadata(ticker).ticker.toString(),
        },
      })
    )
  }

  async function unstake(amount: BigNumber, positionType: StakedPositionType) {
    assertNonNullable(stakingRewards)

    const optimalPositionsToUnstake = getOptimalPositionsToUnstake(amount, positionType)
    const tokenIds = optimalPositionsToUnstake.map(({tokenId}) => tokenId)
    const amounts = optimalPositionsToUnstake.map(({amount}) => amount.toString(10))

    sendFromUser(stakingRewards.contract.userWallet.methods.unstakeMultiple(tokenIds, amounts), {
      type: UNSTAKE_MULTIPLE_TX_TYPE,
      data: {
        totalAmount: amount.toString(10),
        tokens: optimalPositionsToUnstake.map(({tokenId, amount}) => {
          return {id: tokenId, amount: amount.toString(10)}
        }),
      },
    })
  }

  async function depositToCurve(fiduAmount: BigNumber, usdcAmount: BigNumber) {
    assertNonNullable(stakingRewards)

    return approve(fiduAmount, Ticker.FIDU, stakingRewards.address)
      .then(() => approve(usdcAmount, Ticker.USDC, stakingRewards.address))
      .then(() =>
        sendFromUser(
          stakingRewards.contract.userWallet.methods.depositToCurve(fiduAmount.toString(10), usdcAmount.toString(10)),
          {
            type: DEPOSIT_TO_CURVE_TX_TYPE,
            data: {
              fiduAmount: toAtomic(fiduAmount, Ticker.FIDU),
              usdcAmount: toAtomic(usdcAmount, Ticker.USDC),
            },
          }
        )
      )
  }

  async function depositToCurveAndStake(fiduAmount: BigNumber, usdcAmount: BigNumber) {
    assertNonNullable(stakingRewards)

    return approve(fiduAmount, Ticker.FIDU, stakingRewards.address)
      .then(() => approve(usdcAmount, Ticker.USDC, stakingRewards.address))
      .then(() =>
        sendFromUser(
          stakingRewards.contract.userWallet.methods.depositToCurveAndStake(
            fiduAmount.toString(10),
            usdcAmount.toString(10)
          ),
          {
            type: DEPOSIT_TO_CURVE_AND_STAKE_TX_TYPE,
            data: {
              fiduAmount: toAtomic(fiduAmount, Ticker.FIDU),
              usdcAmount: toAtomic(usdcAmount, Ticker.USDC),
            },
          }
        )
      )
  }

  async function zapStakeToCurve(fiduAmount: BigNumber, usdcAmount: BigNumber): Promise<void> {
    assertNonNullable(stakedPositions)
    assertNonNullable(zapper)

    assertNonNullable(stakingRewards)

    const optimalPositionsToUnstake = getOptimalPositionsToUnstake(fiduAmount, StakedPositionType.Fidu)

    Promise.all(
      optimalPositionsToUnstake.map(({tokenId, amount}) =>
        sendFromUser(
          // TODO(@emilyhsia): Calculate USDC amount to unstake
          zapper.contract.userWallet.methods.zapStakeToCurve(tokenId, amount.toString(10), usdcAmount.toString(10)),
          {
            type: ZAP_STAKE_TO_CURVE_TX_TYPE,
            data: {
              tokenId,
              fiduAmount: amount.toString(10),
            },
          }
        )
      )
    )
  }

  function getOptimalPositionsToUnstake(
    amount: BigNumber,
    positionType: StakedPositionType
  ): {tokenId: string; amount: BigNumber}[] {
    assertNonNullable(stakedPositions)
    assertNonNullable(stakingRewards)

    const unstakeableAmount = stakedPositions
      .filter((position) => position.storedPosition.positionType === positionType)
      .reduce((total, position) => total.plus(position.storedPosition.amount), new BigNumber(0))

    if (unstakeableAmount.isLessThan(amount)) {
      throw new AssertionError(`Cannot unstake more than ${unstakeableAmount}.`)
    }

    // To be user-friendly, we exit these positions in reverse order of their vesting
    // end time; positions whose rewards vesting schedule has not completed will be exited before positions whose
    // rewards vesting schedule has completed, which is desirable for the user as that maximizes the rate at which
    // they continue to earn vested (i.e. claimable) rewards. Also, note that among the (unstakeable) positions
    // whose rewards vesting schedule has completed, there is no reason to prefer exiting one position versus
    // another, as all such positions earn rewards at the same rate.
    const sortedUnstakeablePositions = stakedPositions
      .filter((position) => position.storedPosition.positionType === positionType)
      .slice()
      .sort((a, b) => b.storedPosition.rewards.endTime - a.storedPosition.rewards.endTime)

    let amountRemaining = new BigNumber(amount)

    return sortedUnstakeablePositions
      .reduce((acc: {tokenId: string; amount: BigNumber}[], position) => {
        const tokenId = position.tokenId
        const positionAmount = position.storedPosition.amount

        const amountToUnstake = BigNumber.min(positionAmount, amountRemaining)
        amountRemaining = amountRemaining.minus(amountToUnstake)

        return acc.concat([{tokenId, amount: amountToUnstake}])
      }, [])
      .filter(({amount}) => amount.isGreaterThan(new BigNumber(0)))
  }

  function tickerForStakedPositionType(positionType: StakedPositionType): Ticker {
    switch (positionType) {
      case StakedPositionType.Fidu:
        return Ticker.FIDU
      case StakedPositionType.CurveLP:
        return Ticker.CURVE_FIDU_USDC
      default:
        throw new Error(`Unexpected positionType: ${positionType}`)
    }
  }

  return {
    fiduStaked,
    fiduUnstaked,
    fiduUSDCCurveStaked,
    fiduUSDCCurveUnstaked,
    usdcUnstaked,
    estimatedFiduStakingApy,
    estimatedCurveStakingApy,
    stake,
    unstake,
    depositToCurve,
    depositToCurveAndStake,
    zapStakeToCurve,
  }
}
