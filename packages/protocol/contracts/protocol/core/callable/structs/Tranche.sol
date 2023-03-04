// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import {MathUpgradeable as Math} from "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

using TrancheLogic for Tranche global;

struct Tranche {
  uint256 _principalDeposited;
  uint256 _principalPaid;
  uint256 _principalReserved;
  uint256 _interestPaid;
  // TODO: verify that this works for upgradeability
  uint[50] __padding;
}

library TrancheLogic {
  function settleReserves(Tranche storage t) internal {
    t._principalPaid += t._principalReserved;
    t._principalReserved = 0;
  }

  function pay(Tranche storage t, uint256 principalAmount, uint256 interestAmount) internal {
    assert(t._principalPaid + t._principalReserved + principalAmount <= t.principalDeposited());

    t._interestPaid += interestAmount;
    t._principalPaid += principalAmount;
  }

  function reserve(Tranche storage t, uint256 principalAmount, uint256 interestAmount) internal {
    assert(t._principalPaid + t._principalReserved + principalAmount <= t.principalDeposited());

    t._interestPaid += interestAmount;
    t._principalReserved += principalAmount;
  }

  /**
   * Returns principal outstanding, omitting _principalReserve.
   */
  function principalOutstandingWithoutReserves(Tranche storage t) internal view returns (uint256) {
    return t._principalDeposited - t._principalPaid;
  }

  /**
   * Returns principal outstanding, taking into account any _principalReserve.
   */
  function principalOutstandingWithReserves(Tranche storage t) internal view returns (uint256) {
    return t._principalDeposited - t._principalPaid - t._principalReserved;
  }

  /**
   * @notice Withdraw principal from tranche - effectively nullifying the deposit.
   * @dev reverts if interest has been paid to tranche
   */
  function withdraw(Tranche storage t, uint256 principal) internal {
    assert(t._interestPaid == 0);
    t._principalDeposited -= principal;
    t._principalPaid -= principal;
  }

  ///@notice remove `principalOutstanding` from the Tranche and its corresponding interest.
  ///        Take as much reserved principal as possible.
  ///        Only applicable to the uncalled tranche.
  ///@dev    IT: Invalid take - principal depositeed must always be larger than principalPaid + principalReserved
  function take(
    Tranche storage t,
    uint256 principalOutstandingToTake
  )
    internal
    returns (
      uint256 principalDepositedTaken,
      uint256 principalPaidTaken,
      uint256 principalReservedTaken,
      uint256 interestTaken
    )
  {
    require(principalOutstandingToTake <= t._principalDeposited - t._principalPaid, "TOO_MUCH");
    principalReservedTaken = Math.min(t._principalReserved, principalOutstandingToTake);
    principalPaidTaken =
      (t._principalPaid * principalOutstandingToTake) /
      (t._principalDeposited - t._principalPaid);

    principalDepositedTaken = principalOutstandingToTake + principalPaidTaken;
    interestTaken = (t._interestPaid * principalDepositedTaken) / t._principalDeposited;

    t._principalPaid -= principalPaidTaken;
    t._interestPaid -= interestTaken;
    t._principalDeposited -= principalDepositedTaken;
    t._principalReserved -= principalReservedTaken;
    require(t._principalDeposited >= t._principalPaid + t._principalReserved, "IT");
  }

  // depositing into the tranche for the first time(uncalled)
  function deposit(Tranche storage t, uint256 principal) internal {
    // SAFETY but gas cost
    assert(t._interestPaid == 0);
    t._principalDeposited += principal;
    // NOTE: this is so that principalOutstanding = 0 before drawdown
    t._principalPaid += principal;
  }

  function addToBalances(
    Tranche storage t,
    uint256 addToPrincipalDeposited,
    uint256 addToPrincipalPaid,
    uint256 addToPrincipalReserved,
    uint256 addToInterestPaid
  ) internal {
    t._principalDeposited += addToPrincipalDeposited;
    t._principalPaid += addToPrincipalPaid;
    t._principalReserved += addToPrincipalReserved;
    t._interestPaid += addToInterestPaid;
  }

  function principalDeposited(Tranche storage t) internal view returns (uint256) {
    return t._principalDeposited;
  }

  /// @notice Returns the amount of principal paid to the tranche
  function principalPaid(Tranche storage t) internal view returns (uint256) {
    return t._principalPaid;
  }

  /// @notice Returns the amount of principal paid to the tranche
  function principalReserved(Tranche storage t) internal view returns (uint256) {
    return t._principalReserved;
  }

  /// @notice Returns the amount of principal paid + principal reserved
  function principalPaidAfterSettlement(Tranche storage t) internal view returns (uint256) {
    return t._principalPaid + t._principalReserved;
  }

  function interestPaid(Tranche storage t) internal view returns (uint256) {
    return t._interestPaid;
  }

  // returns principal, interest withdrawable
  function proportionalInterestAndPrincipalAvailableAfterApplyingReserves(
    Tranche storage t,
    uint256 principalAmount,
    uint256 feePercent
  ) internal view returns (uint256, uint256) {
    return (
      t.proportionalInterestWithdrawable(principalAmount, feePercent),
      t.proportionalPrincipalAvailableAfterApplyingReserves(principalAmount)
    );
  }

  function proportionalInterestAndPrincipalAvailable(
    Tranche storage t,
    uint256 principalAmount,
    uint256 feePercent
  ) internal view returns (uint256, uint256) {
    return (
      t.proportionalInterestWithdrawable(principalAmount, feePercent),
      t.proportionalPrincipalWithdrawable(principalAmount)
    );
  }

  function proportionalPrincipalAvailableAfterApplyingReserves(
    Tranche storage t,
    uint256 principalAmount
  ) internal view returns (uint256) {
    return ((t.principalPaid() + t._principalReserved) * principalAmount) / t.principalDeposited();
  }

  function proportionalPrincipalWithdrawable(
    Tranche storage t,
    uint256 principalAmount
  ) internal view returns (uint256) {
    return (t.principalPaid() * principalAmount) / t.principalDeposited();
  }

  function proportionalPrincipalOutstandingWithoutReserves(
    Tranche storage t,
    uint256 principalAmount
  ) internal view returns (uint256) {
    return (t.principalOutstandingWithoutReserves() * principalAmount) / t.principalDeposited();
  }

  function proportionalInterestWithdrawable(
    Tranche storage t,
    uint256 principalAmount,
    uint256 feePercent
  ) internal view returns (uint256) {
    return
      (t.interestPaid() * principalAmount * percentLessFee(feePercent)) /
      (t.principalDeposited() * 100);
  }

  /// Updates the tranche as the result of a drawdown
  /// @dev DP: drawdown principal amount exceeds principal paid
  function drawdown(Tranche storage t, uint256 principalAmount) internal {
    require(principalAmount <= t._principalPaid, "EP");
    t._principalPaid -= principalAmount;
  }

  function percentLessFee(uint256 feePercent) private pure returns (uint256) {
    return 100 - feePercent;
  }
}
