// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;
pragma experimental ABIEncoderV2;

// import {console2 as console} from "forge-std/console2.sol";

import {ISchedule} from "../../../../interfaces/ISchedule.sol";
import {IGoldfinchConfig} from "../../../../interfaces/IGoldfinchConfig.sol";
import {SaturatingSub} from "../../../../library/SaturatingSub.sol";
import {InterestUtil} from "../../../../library/InterestUtil.sol";

import {Waterfall, WaterfallLogic, TrancheLogic, Tranche} from "./Waterfall.sol";
import {PaymentSchedule, PaymentScheduleLogic} from "../../schedule/PaymentSchedule.sol";
import {ConfigNumbersHelper} from "../../ConfigNumbersHelper.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

struct StaleCallableCreditLine {
  CallableCreditLine _cpcl;
}

using StaleCallableCreditLineLogic for StaleCallableCreditLine global;
using CallableCreditLineLogic for CallableCreditLine global;

library StaleCallableCreditLineLogic {
  using SaturatingSub for uint256;
  using ConfigNumbersHelper for IGoldfinchConfig;

  function initialize(
    StaleCallableCreditLine storage cl,
    IGoldfinchConfig _config,
    uint _interestApr,
    ISchedule _schedule,
    uint _lateAdditionalApr,
    uint _limit
  ) internal {
    cl._cpcl.initialize(_config, _interestApr, _schedule, _lateAdditionalApr, _limit);
  }

  function checkpoint(
    StaleCallableCreditLine storage cl
  ) internal returns (CallableCreditLine storage) {
    cl._cpcl.checkpoint();
    return cl._cpcl;
  }

  function schedule(StaleCallableCreditLine storage cl) internal view returns (ISchedule) {
    return cl.paymentSchedule().schedule;
  }

  function termStartTime(StaleCallableCreditLine storage cl) internal view returns (uint) {
    return cl._cpcl.termStartTime();
  }

  function isLate(StaleCallableCreditLine storage cl) internal view returns (bool) {
    return cl._cpcl.isLate();
  }

  function paymentSchedule(
    StaleCallableCreditLine storage cl
  ) internal view returns (PaymentSchedule storage) {
    return cl._cpcl._paymentSchedule;
  }
}

struct CallableCreditLine {
  IGoldfinchConfig _config;
  uint256 _limit;
  uint256 _interestApr;
  uint256 _lateAdditionalApr;
  // TODO: Need config properties for when call request periods rollover/lock
  uint256 _checkpointedAsOf;
  uint256 _bufferedPayments;
  uint256 _lastFullPaymentTime;
  uint256 _totalInterestOwed;
  uint256 _totalInterestAccruedAtLastCheckpoint;
  PaymentSchedule _paymentSchedule;
  Waterfall _waterfall;
  uint[50] __padding;
}

/**
 * Handles the accounting of borrower obligations in a callable loan.
 * Allows
 *  - Deposit of funds before the loan is drawn down.
 *  - Drawdown of funds which should start the loan.
 *  - Repayment of drawndown funds which should reduce the borrower's obligations according to the payment waterfall.
 *  - Withdrawal of undrawndown funds whi
 */
library CallableCreditLineLogic {
  using SaturatingSub for uint256;
  using ConfigNumbersHelper for IGoldfinchConfig;

  uint256 internal constant SECONDS_PER_DAY = 60 * 60 * 24;

  function initialize(
    CallableCreditLine storage cl,
    IGoldfinchConfig _config,
    uint _interestApr,
    ISchedule _schedule,
    uint _lateAdditionalApr,
    uint _limit
  ) internal {
    require(cl._checkpointedAsOf == 0, "NI");
    cl._config = _config;
    cl._limit = _limit;
    cl._paymentSchedule = PaymentSchedule(_schedule, 0);
    cl._waterfall.initialize(_schedule.totalPrincipalPeriods());
    cl._interestApr = _interestApr;
    cl._lateAdditionalApr = _lateAdditionalApr;
    cl._checkpointedAsOf = block.timestamp;

    // Zero out cumulative/settled values
    cl._lastFullPaymentTime = 0;
    cl._totalInterestAccruedAtLastCheckpoint = 0;
    cl._totalInterestOwed = 0;
    cl._bufferedPayments = 0;
    // MT - Waterfall must have at minimum 2 tranches in order to submit call requests
    require(cl._waterfall.numTranches() >= 2, "MT");
  }

  function pay(
    CallableCreditLine storage cl,
    uint256 principalAmount,
    uint256 interestAmount
  ) internal {
    // console.log("pay 1");
    // console.log(cl._paymentSchedule.currentPrincipalPeriod());
    // console.log("pay2");
    cl._bufferedPayments = cl._waterfall.payUntil(
      principalAmount,
      interestAmount,
      cl._paymentSchedule.currentPrincipalPeriod()
    );
  }

  // Scenario to test:
  // 1. Checkpoint behavior (e.g. pay)
  // 2. Drawdown 1000
  // 3. Submit call request
  // 4. Interest owed, accrued (forced redemption), and principal owed should all be accounted for correctly.
  function drawdown(CallableCreditLine storage cl, uint256 amount) internal {
    if (!cl._paymentSchedule.isActive()) {
      cl._paymentSchedule.startAt(block.timestamp);
    }

    // TODO: COnditions for valid drawdown.
    require(
      amount + cl._waterfall.totalPrincipalOutstanding() <= cl._limit,
      "Cannot drawdown more than the limit"
    );
    cl._waterfall.drawdown(amount);
  }

  function submitCall(CallableCreditLine storage cl, uint256 amount) internal {
    // console.log("call 1");
    uint256 activeCallTranche = cl._paymentSchedule.currentPrincipalPeriod();
    // console.log("call 2");
    require(
      activeCallTranche < cl.uncalledCapitalTrancheIndex(),
      "Cannot call during the last call request period"
    );
    // console.log("call 3");
    // console.log("cl.uncalledCapitalTrancheIndex(): ", cl.uncalledCapitalTrancheIndex());
    // console.log("activeCallTranche: ", activeCallTranche);

    cl._waterfall.move(amount, cl.uncalledCapitalTrancheIndex(), activeCallTranche);
  }

  function deposit(CallableCreditLine storage cl, uint256 amount) internal {
    cl._waterfall.deposit(cl.uncalledCapitalTrancheIndex(), amount);
  }

  /**
   * Withdraws funds from the uncalled capital tranche.
   */
  function withdraw(CallableCreditLine storage cl, uint256 amount) internal {
    cl._waterfall.withdraw(amount, cl.uncalledCapitalTrancheIndex());
  }

  /**
   * Withdraws funds from the specified tranche.
   */
  function withdraw(CallableCreditLine storage cl, uint256 trancheId, uint256 amount) internal {
    cl._waterfall.withdraw(amount, trancheId);
  }

  /**
   * 1. Calculates interest owed up until the last interest due time.
   * 2. Applies any outstanding bufferedPayments.
   */
  function checkpoint(CallableCreditLine storage cl) internal {
    if (!cl._paymentSchedule.isActive()) {
      return;
    }
    uint256 activePrincipalPeriod = cl._paymentSchedule.currentPrincipalPeriod();
    uint256 activePrincipalPeriodAtLastCheckpoint = cl._paymentSchedule.principalPeriodAt(
      cl._checkpointedAsOf
    );
    uint256 lastInterestDueTime = cl._paymentSchedule.previousInterestDueTimeAt(block.timestamp);
    bool needToApplyBuffer = activePrincipalPeriod > activePrincipalPeriodAtLastCheckpoint &&
      cl._bufferedPayments > 0;

    if (needToApplyBuffer) {
      uint256 interestOwedWhenApplyingBuffer = cl.interestOwedAt(
        cl._paymentSchedule.nextPrincipalDueTimeAt(cl._checkpointedAsOf)
      );
      uint256 firstInterestPayment = MathUpgradeable.min(
        interestOwedWhenApplyingBuffer,
        cl._bufferedPayments
      );

      // Tranche storage checkpointedTranche = cl._waterfall._tranches[
      //   activePrincipalPeriodAtLastCheckpoint
      // ];
      // uint256 bufferedPrincipalOutstanding = checkpointedTranche.principalOutstanding();
      // uint256 firstPrincipalPayment = MathUpgradeable.min(
      //   bufferedPrincipalOutstanding,
      //   cl._bufferedPayments - firstInterestPayment
      // );

      // applyBuffer function needs to know how much
      //   - "Making a payment exactly when principal + interest is due should be
      //     indistinguishable from applying a prepaid buffer"
      //   - principalOutstanding is in remaining buckets
      //   - Allocate to uncalled capital tranche, and remaining buffer depending
      //     on amount of principal outstanding in remaining called tranches.

      /**
       * Pay interest owed up until the end of the buffered principal period,
       * then apply the buffer to ONLY the buffered principal period.
       * TODO: This should be able to pay interest to all tranches with remaining principal
       *       outstanding.
       */
      uint256 bufferedPaymentsRemainder = cl._waterfall.payUntil(
        firstInterestPayment,
        cl._bufferedPayments - firstInterestPayment,
        cl._paymentSchedule.currentPrincipalPeriod()
      );

      // uint256 bufferedPaymentsRemainder = cl
      //   ._bufferedPayments
      //   .saturatingSub(firstInterestPayment)
      //   .saturatingSub(firstPrincipalPayment);
      if (bufferedPaymentsRemainder > 0) {
        cl._bufferedPayments = cl._waterfall.payUntil(
          0,
          bufferedPaymentsRemainder,
          cl.uncalledCapitalTrancheIndex()
        );
      }

      // TODO: Pay any remaining balance to later interest then tranches.
      cl._totalInterestOwed = cl.totalInterestOwedAt(lastInterestDueTime);
      cl._checkpointedAsOf = block.timestamp;

      cl._bufferedPayments = 0;
      // Recalculate totalInterestAccrued after updating waterfall with buffered payments.
      cl._totalInterestAccruedAtLastCheckpoint = cl.totalInterestAccruedAt(block.timestamp);
    } else {
      if (lastInterestDueTime > cl._checkpointedAsOf) {
        cl._totalInterestOwed = cl.totalInterestOwedAt(lastInterestDueTime);
      }
      cl._totalInterestAccruedAtLastCheckpoint = cl.totalInterestAccruedAt(block.timestamp);
    }
  }

  ////////////////////////////////////////////////////////////////////////////////
  // VIEW STORAGE
  ////////////////////////////////////////////////////////////////////////////////
  function uncalledCapitalTrancheIndex(
    CallableCreditLine storage cl
  ) internal view returns (uint32) {
    return uint32(cl._waterfall.numTranches() - 1);
  }

  function nextDueTimeAt(
    CallableCreditLine storage cl,
    uint timestamp
  ) internal view returns (uint) {
    return cl._paymentSchedule.nextDueTimeAt(timestamp);
  }

  function termStartTime(CallableCreditLine storage cl) internal view returns (uint) {
    return cl._paymentSchedule.termStartTime();
  }

  function termEndTime(CallableCreditLine storage cl) internal view returns (uint) {
    return cl._paymentSchedule.termEndTime();
  }

  // TODO: Should account for end of term.
  function principalOwedAt(
    CallableCreditLine storage cl,
    uint timestamp
  ) internal view returns (uint returnedPrincipalOwed) {
    require(timestamp > block.timestamp, "Cannot query past principal owed");
    uint endTrancheIndex = cl._paymentSchedule.principalPeriodAt(timestamp);
    for (uint i = cl.earliestPrincipalOutstandingTrancheIndex(); i < endTrancheIndex; i++) {
      returnedPrincipalOwed += cl._waterfall.getTranche(i).principalOutstanding();
    }
  }

  function principalOwed(CallableCreditLine storage cl) internal view returns (uint) {
    return cl.principalOwedAt(block.timestamp);
  }

  function totalPrincipalOwed(CallableCreditLine storage cl) internal view returns (uint256) {
    return cl.totalPrincipalOwedAt(block.timestamp);
  }

  function totalPrincipalOwedAt(
    CallableCreditLine storage cl,
    uint timestamp
  ) internal view returns (uint) {
    uint endTrancheIndex = cl._paymentSchedule.principalPeriodAt(timestamp);
    return cl._waterfall.totalPrincipalOwedUpToTranche(endTrancheIndex);
  }

  function totalPrincipalPaid(CallableCreditLine storage cl) internal view returns (uint) {
    return cl._waterfall.totalPrincipalPaid();
  }

  function totalPrincipalOwedBeforeTranche(
    CallableCreditLine storage cl,
    uint trancheIndex
  ) internal view returns (uint principalDeposited) {
    for (uint i = 0; i < trancheIndex; i++) {
      principalDeposited += cl._waterfall.getTranche(i).principalDeposited();
    }
  }

  function totalInterestOwed(CallableCreditLine storage cl) internal view returns (uint) {
    return cl.totalInterestOwedAt(block.timestamp);
  }

  /**
   * Calculates total interest owed at a given timestamp.
   * IT: Invalid timestamp - timestamp must be after the last checkpoint.
   */
  function totalInterestOwedAt(
    CallableCreditLine storage cl,
    uint timestamp
  ) internal view returns (uint) {
    require(timestamp >= cl._checkpointedAsOf, "IT");
    // After loan maturity there is no concept of additional interest. All interest accrued
    // automatically becomes interest owed.
    if (timestamp > cl.termEndTime()) {
      return cl.totalInterestAccruedAt(timestamp);
    }

    if (timestamp > cl._paymentSchedule.previousInterestDueTimeAt(block.timestamp)) {
      return cl.totalInterestAccruedAt(timestamp);
    }

    return cl._totalInterestAccruedAtLastCheckpoint + cl.interestAccruedAt(timestamp);
  }

  function interestOwed(CallableCreditLine storage cl) internal view returns (uint) {
    cl.interestOwedAt(block.timestamp);
  }

  /**
   * Calculates total interest owed at a given timestamp.
   * Assumes that principal outstanding is constant from now until the given `timestamp`.
   */
  function interestOwedAt(
    CallableCreditLine storage cl,
    uint timestamp
  ) internal view returns (uint) {
    /// @dev IT: Invalid timestamp
    require(timestamp >= cl._checkpointedAsOf, "IT");
    return cl.totalInterestOwedAt(timestamp).saturatingSub(cl._waterfall.totalInterestPaid());
  }

  /**
   * Interest accrued up to `timestamp`
   * IT: Invalid timestamp - timestamp must be now or in the future.
   * // TODO: Verify behavior - intention is unclear here.
   */
  function interestAccruedAt(
    CallableCreditLine storage cl,
    uint timestamp
  ) internal view returns (uint) {
    require(timestamp >= block.timestamp, "IT");
    return
      cl.totalInterestAccruedAt(timestamp) -
      ((MathUpgradeable.max(cl._waterfall.totalInterestPaid(), cl.totalInterestOwedAt(timestamp))));
  }

  /**
   * Test cases
   * S = Start B = Buffer Applied At L = Late Fees Start At E = End
    SBLE
    SBEL
    SLEB
    SLBE
    SELB
    SEBL

    LSEB
    LSBE
    LBSE(INVALID)
    LBES(INVALID)
    LESB(INVALID)
    LEBS(INVALID) 

    BSLE (INVALID)
    BSEL (INVALID)
    BLSE (INVALID)
    BLES (INVALID)
    BESL (INVALID)
    BELS (INVALID)
   */

  /**
   * Calculates interest accrued over the duration bounded by the `cl._checkpointedAsOf` and `end` timestamps.
   * Assumes cl._waterfall.totalPrincipalOutstanding() for the principal balance that the interest is applied to.
   */
  function totalInterestAccruedAt(
    CallableCreditLine storage cl,
    uint256 end
  ) internal view returns (uint256 totalInterestAccruedReturned) {
    require(end >= cl._checkpointedAsOf, "IT");
    if (!cl._paymentSchedule.isActive()) {
      return 0;
    }
    uint256 applyBufferAt = cl._paymentSchedule.nextPrincipalDueTimeAt(cl._checkpointedAsOf);
    uint256 lateFeesStartAt = MathUpgradeable.max(
      cl._checkpointedAsOf,
      cl._paymentSchedule.nextDueTimeAt(cl._lastFullPaymentTime) +
        (cl._config.getLatenessGracePeriodInDays() * (SECONDS_PER_DAY))
    );

    // Calculate interest accrued before the payment buffer is applied.
    totalInterestAccruedReturned = InterestUtil.calculateInterest(
      cl._checkpointedAsOf,
      MathUpgradeable.min(applyBufferAt, end),
      lateFeesStartAt,
      cl._waterfall.totalPrincipalOutstanding(),
      cl._interestApr,
      cl._lateAdditionalApr
    );
    if (cl._bufferedPayments > 0 && applyBufferAt < end) {
      // Calculate interest accrued after the payment buffer is applied.
      totalInterestAccruedReturned += InterestUtil.calculateInterest(
        MathUpgradeable.min(applyBufferAt, end),
        end,
        lateFeesStartAt,
        cl._waterfall.totalPrincipalOutstanding(),
        cl._interestApr,
        cl._lateAdditionalApr
      );
    }
  }

  function earliestPrincipalOutstandingTrancheIndex(
    CallableCreditLine storage cl
  ) internal view returns (uint) {
    Tranche storage tranche;
    for (uint i = 0; i < cl._waterfall.numTranches(); i++) {
      tranche = cl._waterfall.getTranche(i);
      if (tranche.principalOutstanding() == 0) {
        return i;
      }
    }
  }

  function principalPeriodAt(
    CallableCreditLine storage cl,
    uint timestamp
  ) internal view returns (uint) {
    return cl._paymentSchedule.principalPeriodAt(timestamp);
  }

  function isLate(CallableCreditLine storage cl) internal view returns (bool) {
    cl.isLate(block.timestamp);
  }

  function isLate(CallableCreditLine storage cl, uint256 timestamp) internal view returns (bool) {
    uint256 gracePeriodInSeconds = cl._config.getLatenessGracePeriodInDays() * SECONDS_PER_DAY;
    uint256 oldestUnpaidDueTime = cl._paymentSchedule.nextDueTimeAt(cl._lastFullPaymentTime);
    return
      cl._waterfall.totalPrincipalOutstanding() > 0 &&
      timestamp > oldestUnpaidDueTime + gracePeriodInSeconds;
  }

  function interestApr(CallableCreditLine storage cl) internal view returns (uint) {
    return cl._interestApr;
  }

  function lateFeeAdditionalApr(CallableCreditLine storage cl) internal view returns (uint) {
    return cl._lateAdditionalApr;
  }

  function limit(CallableCreditLine storage cl) internal view returns (uint) {
    return cl._limit;
  }

  function balance(CallableCreditLine storage cl) internal view returns (uint256) {
    return cl.interestOwed() + cl.principalOwed();
  }

  function totalPrincipalDeposited(CallableCreditLine storage cl) internal view returns (uint256) {
    return cl._waterfall.totalPrincipalDeposited();
  }

  function principalOutstanding(CallableCreditLine storage cl) internal view returns (uint256) {
    return cl._waterfall.totalPrincipalOutstanding();
  }

  function totalInterestAccrued(CallableCreditLine storage cl) internal view returns (uint256) {
    return cl.totalInterestAccruedAt(block.timestamp);
  }

  function principalRemaining(
    CallableCreditLine storage cl,
    uint256 trancheId,
    uint256 principalAmount
  ) internal view returns (uint256) {
    return cl._waterfall.getTranche(trancheId).cumulativePrincipalRemaining(principalAmount);
  }

  /*
   * Returns the index of the tranche which current call requests should be submitted to.
   */
  function activeCallSubmissionTranche(
    CallableCreditLine storage cl
  ) internal view returns (uint activeTrancheIndex) {
    return cl._paymentSchedule.currentPrincipalPeriod();
  }

  // TODO:
  /**
   * Returns the lifetime amount withdrawable
   */
  function cumulativeAmountWithdrawable(
    CallableCreditLine storage cl,
    uint trancheId,
    uint256 principal
  ) internal view returns (uint, uint) {
    return cl._waterfall.cumulativeAmountWithdrawable(trancheId, principal);
  }

  ////////////////////////////////////////////////////////////////////////////////
  // END VIEW STORAGE
  ////////////////////////////////////////////////////////////////////////////////
}
