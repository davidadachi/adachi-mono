import { gql } from "@apollo/client";
import { BigNumber, FixedNumber } from "ethers";

import { FIDU_DECIMALS, USDC_DECIMALS } from "@/constants";
import {
  SupportedCrypto,
  TranchedPoolStatusFieldsFragment,
  UserEligibilityFieldsFragment,
  UidType,
} from "@/lib/graphql/generated";

/**
 * Include this graphQL fragment on a query for TranchedPool to ensure it has the correct fields for computing PoolStatus
 */
export const TRANCHED_POOL_STATUS_FIELDS = gql`
  fragment TranchedPoolStatusFields on TranchedPool {
    id
    isPaused
    remainingCapacity
    fundableAt
    creditLine {
      id
      balance
      termEndTime
    }
  }
`;

export enum PoolStatus {
  Paused,
  Repaid,
  Full,
  ComingSoon,
  Open,
}

/**
 * Get the current status of the tranched pool
 * @param pool TranchedPool to get the status for. Use the TranchedPoolStatusFields fragment to guarantee your query has the right fields for this computation.
 * @returns the status of the pool
 */
export function getTranchedPoolStatus(pool: TranchedPoolStatusFieldsFragment) {
  if (pool.isPaused) {
    return PoolStatus.Paused;
  } else if (
    pool.creditLine.balance.isZero() &&
    pool.creditLine.termEndTime.gt(0)
  ) {
    return PoolStatus.Repaid;
  } else if (pool.remainingCapacity.isZero()) {
    return PoolStatus.Full;
  } else if (
    pool.creditLine.termEndTime.isZero() &&
    Date.now() / 1000 < parseInt(pool.fundableAt.toString())
  ) {
    return PoolStatus.ComingSoon;
  } else {
    return PoolStatus.Open;
  }
}

export function computeApyFromGfiInFiat(
  apyFromGfiRaw: FixedNumber,
  fiatPerGfi: number
): FixedNumber {
  return apyFromGfiRaw.mulUnsafe(FixedNumber.fromString(fiatPerGfi.toString()));
}

/**
 * A utility function for converting senior pool shares to a USDC amount
 * @param numShares Number of shares. This could be staked or unstaked FIDU balance, for example.
 * @param sharePrice `sharePrice` as it is reported from the Senior Pool contract
 * @returns a `CryptoAmount` in USDC
 */
export function sharesToUsdc(numShares: BigNumber, sharePrice: BigNumber) {
  const usdcMantissa = BigNumber.from(10).pow(USDC_DECIMALS);
  const fiduMantissa = BigNumber.from(10).pow(FIDU_DECIMALS);
  const sharePriceMantissa = fiduMantissa;
  const amount = numShares
    .mul(sharePrice)
    .div(fiduMantissa)
    .div(sharePriceMantissa.div(usdcMantissa));
  return { token: SupportedCrypto.Usdc, amount };
}

export const USER_ELIGIBILITY_FIELDS = gql`
  fragment UserEligibilityFields on User {
    id
    isUsEntity
    isNonUsEntity
    isUsAccreditedIndividual
    isUsNonAccreditedIndividual
    isNonUsIndividual
    isGoListed
  }
`;

export function canUserParticipateInPool(
  poolAllowedUids: UidType[],
  user: UserEligibilityFieldsFragment
): boolean {
  if (user.isGoListed) {
    return true;
  }
  if (
    user.isNonUsIndividual &&
    poolAllowedUids.includes(UidType.NonUsIndividual)
  ) {
    return true;
  }
  if (
    user.isUsAccreditedIndividual &&
    poolAllowedUids.includes(UidType.UsAccreditedIndividual)
  ) {
    return true;
  }
  if (
    user.isUsNonAccreditedIndividual &&
    poolAllowedUids.includes(UidType.UsNonAccreditedIndividual)
  ) {
    return true;
  }
  if (user.isUsEntity && poolAllowedUids.includes(UidType.UsEntity)) {
    return true;
  }
  if (user.isNonUsEntity && poolAllowedUids.includes(UidType.NonUsEntity)) {
    return true;
  }
  return false;
}
