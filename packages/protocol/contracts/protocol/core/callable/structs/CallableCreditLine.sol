// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;
pragma experimental ABIEncoderV2;

import {ISchedule} from "../../../../interfaces/ISchedule.sol";
import {IGoldfinchConfig} from "../../../../interfaces/IGoldfinchConfig.sol";
import {SaturatingSub} from "../../../../library/SaturatingSub.sol";

import {Waterfall, WaterfallLogic, TrancheLogic, Tranche} from "./Waterfall.sol";
import {PaymentSchedule, PaymentScheduleLogic} from "../../schedule/PaymentSchedule.sol";
import {ConfigNumbersHelper} from "../../ConfigNumbersHelper.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

import {console2 as console} from "forge-std/console2.sol";

struct CallableCreditLine {
  CheckpointedCallableCreditLine _ccl;
}

struct CheckpointedCallableCreditLine {
  IGoldfinchConfig _config;
  // TODO: Need config properties for when call request periods rollover/lock
  uint256 _checkpointedAsOf;
  uint256 _bufferedPayments;
  uint256 _interestApr;
  uint256 _lateAdditionalApr;
  uint256 _lastFullPaymentTime;
  uint256 _limit;
  uint256 _totalInterestOwed;
  uint256 _totalInterestAccruedAtLastCheckpoint;
  uint256 _settledPrincipalBalance;
  PaymentSchedule _paymentSchedule;
  Waterfall _waterfall;
  uint[50] __padding;
}

library CallableCreditLineLogic {
  using CheckpointedCallableCreditLineLogic for CheckpointedCallableCreditLine;
  using CallableCreditLineLogic for CallableCreditLine;
  using PaymentScheduleLogic for PaymentSchedule;
  using WaterfallLogic for Waterfall;
  using TrancheLogic for Tranche;
  using SaturatingSub for uint256;
  using ConfigNumbersHelper for IGoldfinchConfig;

  function initialize(
    CallableCreditLine storage cl,
    IGoldfinchConfig _config,
    uint _interestApr,
    ISchedule _schedule,
    uint _lateAdditionalApr,
    uint _limit
  ) internal {
    cl._ccl.initialize(_config, _interestApr, _schedule, _lateAdditionalApr, _limit);
  }

  function checkpoint(
    CallableCreditLine storage cl
  ) internal returns (CheckpointedCallableCreditLine storage) {
    cl._ccl.checkpoint();
    return cl._ccl;
  }

  function previewCheckpoint(
    CallableCreditLine storage cl
  ) internal view returns (CheckpointedCallableCreditLine storage) {
    return cl._ccl.previewCheckpoint();
  }
}

/**
 * Handles the accounting of borrower obligations in a callable loan.
 * Allows
 *  - Deposit of funds before the loan is drawn down.
 *  - Drawdown of funds which should start the loan.
 *  - Repayment of drawndown funds which should reduce the borrower's obligations according to the payment waterfall.
 *  - Withdrawal of undrawndown funds whi
 */
library CheckpointedCallableCreditLineLogic {
  using CallableCreditLineLogic for CallableCreditLine;
  using CheckpointedCallableCreditLineLogic for CheckpointedCallableCreditLine;
  using CallableCreditLineLogic for CallableCreditLine;
  using PaymentScheduleLogic for PaymentSchedule;
  using WaterfallLogic for Waterfall;
  using TrancheLogic for Tranche;
  using SaturatingSub for uint256;
  using ConfigNumbersHelper for IGoldfinchConfig;

  uint256 internal constant INTEREST_DECIMALS = 1e18;
  uint256 internal constant SECONDS_PER_DAY = 60 * 60 * 24;
  uint256 internal constant SECONDS_PER_YEAR = SECONDS_PER_DAY * 365;

  function initialize(
    CheckpointedCallableCreditLine storage cl,
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

  function copyToMemory(
    CheckpointedCallableCreditLine storage cl
  ) internal view returns (CheckpointedCallableCreditLine memory) {
    return
      CheckpointedCallableCreditLine(
        cl._config,
        cl._checkpointedAsOf,
        cl._bufferedPayments,
        cl._interestApr,
        cl._lateAdditionalApr,
        cl._lastFullPaymentTime,
        cl._limit,
        cl._totalInterestOwed,
        cl._totalInterestAccruedAtLastCheckpoint,
        cl._settledPrincipalBalance,
        cl._paymentSchedule,
        cl._waterfall,
        cl.__padding
      );
  }

  function pay(
    CheckpointedCallableCreditLine storage cl,
    uint256 principalAmount,
    uint256 interestAmount
  ) internal {
    cl._bufferedPayments = cl._waterfall.payUntil(
      principalAmount,
      interestAmount,
      cl._paymentSchedule.currentPrincipalPeriod() - 1
    );
  }

  // Scenario to test:
  // 1. Checkpoint behavior (e.g. pay)
  // 2. Drawdown 1000
  // 3. Submit call request
  // 4. Interest owed, accrued (forced redemption), and principal owed should all be accounted for correctly.
  function drawdown(CheckpointedCallableCreditLine storage cl, uint256 amount) internal {
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

  function call(CheckpointedCallableCreditLine storage cl, uint256 amount) internal {
    uint256 activeCallTranche = cl._paymentSchedule.currentPrincipalPeriod();
    require(
      activeCallTranche < cl.uncalledCapitalIndex(),
      "Cannot call during the last call request period"
    );
    cl._waterfall.move(
      amount,
      cl.uncalledCapitalIndex(),
      cl._paymentSchedule.currentPrincipalPeriod()
    );
  }

  function deposit(CheckpointedCallableCreditLine storage cl, uint256 amount) internal {
    cl._waterfall.deposit(cl.uncalledCapitalIndex(), amount);
  }

  /**
   * Withdraws funds from the uncalled capital tranche.
   */
  function withdraw(CheckpointedCallableCreditLine storage cl, uint256 amount) internal {
    cl._waterfall.withdraw(amount, cl.uncalledCapitalIndex());
  }

  /**
   * Withdraws funds from the specified tranche.
   */
  function withdraw(
    CheckpointedCallableCreditLine storage cl,
    uint256 trancheId,
    uint256 amount
  ) internal {
    cl._waterfall.withdraw(amount, trancheId);
  }

  /**
   * 1. Calculates interest owed up until the last interest due time.
   * 2. Applies any outstanding bufferedPayments.
   */
  function checkpoint(
    CheckpointedCallableCreditLine storage cl
  ) internal returns (CheckpointedCallableCreditLine storage cl) {
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
          cl.uncalledCapitalIndex()
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

  /**
   * 1. Calculates interest owed up until the last interest due time.
   * 2. Applies any outstanding bufferedPayments.
   */
  function previewCheckpoint(
    CheckpointedCallableCreditLine storage cl
  ) internal view returns (CheckpointedCallableCreditLine storage cl) {
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
      // (uint256 bufferedPaymentsRemainder) = cl._waterfall.previewPayUntil(
      //   firstInterestPayment,
      //   cl._bufferedPayments - firstInterestPayment,
      //   cl._paymentSchedule.currentPrincipalPeriod()
      // );

      // uint256 bufferedPaymentsRemainder = cl
      //   ._bufferedPayments
      //   .saturatingSub(firstInterestPayment)
      //   .saturatingSub(firstPrincipalPayment);
      // if (bufferedPaymentsRemainder > 0) {
      //   // cl._bufferedPayments = cl._waterfall.previewPayUntil(
      //   //   0,
      //   //   bufferedPaymentsRemainder,
      //   //   cl.uncalledCapitalIndex()
      //   // );
      // }

      // TODO: Pay any remaining balance to later interest then tranches.
      cl.totalInterestOwed = cl.totalInterestOwedAt(lastInterestDueTime);
      cl.checkpointedAsOf = block.timestamp;

      cl.bufferedPayments = 0;
      // Recalculate totalInterestAccrued after updating waterfall with buffered payments.
      cl.totalInterestAccruedAtLastCheckpoint = cl.totalInterestAccruedAt(block.timestamp);
    } else {
      if (lastInterestDueTime > cl._checkpointedAsOf) {
        cl.totalInterestOwed = cl.totalInterestOwedAt(lastInterestDueTime);
      }
      cl.totalInterestAccruedAtLastCheckpoint = cl.totalInterestAccruedAt(block.timestamp);
    }
  }

  ////////////////////////////////////////////////////////////////////////////////
  // VIEW STORAGE - DUPLICATE TO VIEW MEMORY VERSIONS
  ////////////////////////////////////////////////////////////////////////////////
  function uncalledCapitalIndex(
    CheckpointedCallableCreditLine storage cl
  ) internal view returns (uint32) {
    return cl._waterfall.numTranches() - 1;
  }

  function nextDueTimeAt(
    CheckpointedCallableCreditLine storage cl,
    uint timestamp
  ) internal view returns (uint) {
    return cl._paymentSchedule.nextDueTimeAt(timestamp);
  }

  function termStartTime(CheckpointedCallableCreditLine storage cl) internal view returns (uint) {
    return cl._paymentSchedule.termStartTime();
  }

  function termEndTime(CheckpointedCallableCreditLine storage cl) internal view returns (uint) {
    return cl._paymentSchedule.termEndTime();
  }

  // TODO: Should account for end of term.
  function principalOwedAt(
    CheckpointedCallableCreditLine storage cl,
    uint timestamp
  ) internal view returns (uint principalOwed) {
    require(timestamp > block.timestamp, "Cannot query past principal owed");
    uint endTrancheIndex = cl._paymentSchedule.principalPeriodAt(timestamp);
    for (uint i = cl.earliestPrincipalOutstandingTrancheIndex(); i < endTrancheIndex; i++) {
      principalOwed += cl._waterfall.getTranche(i).principalOutstanding();
    }
  }

  function principalOwed(CheckpointedCallableCreditLine storage cl) internal view returns (uint) {
    return cl.principalOwedAt(block.timestamp);
  }

  function totalPrincipalOwed(
    CheckpointedCallableCreditLine storage cl
  ) internal view returns (uint256) {
    return cl.totalPrincipalOwedAt(block.timestamp);
  }

  function totalPrincipalOwedAt(
    CheckpointedCallableCreditLine storage cl,
    uint timestamp
  ) internal view returns (uint) {
    uint endTrancheIndex = cl._paymentSchedule.principalPeriodAt(timestamp);
    return cl._waterfall.totalPrincipalOwedUpToTranche(endTrancheIndex);
  }

  function totalPrincipalPaid(
    CheckpointedCallableCreditLine storage cl
  ) internal view returns (uint) {
    return cl._waterfall.totalPrincipalPaid();
  }

  function totalPrincipalOwedBeforeTranche(
    CheckpointedCallableCreditLine storage cl,
    uint trancheIndex
  ) internal view returns (uint principalDeposited) {
    for (uint i = 0; i < trancheIndex; i++) {
      principalDeposited += cl._waterfall.getTranche(i).principalDeposited();
    }
  }

  function totalInterestOwed(
    CheckpointedCallableCreditLine storage cl
  ) internal view returns (uint) {
    return cl.totalInterestOwedAt(block.timestamp);
  }

  /**
   * Calculates total interest owed at a given timestamp.
   * IT: Invalid timestamp - timestamp must be after the last checkpoint.
   */
  function totalInterestOwedAt(
    CheckpointedCallableCreditLine storage cl,
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

  function interestOwed(CheckpointedCallableCreditLine storage cl) internal view returns (uint) {
    cl.interestOwedAt(block.timestamp);
  }

  /**
   * Calculates total interest owed at a given timestamp.
   * Assumes that principal outstanding is constant from now until the given `timestamp`.
   */
  function interestOwedAt(
    CheckpointedCallableCreditLine storage cl,
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
    CheckpointedCallableCreditLine storage cl,
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
    CheckpointedCallableCreditLine storage cl,
    uint256 end
  ) internal view returns (uint256 totalInterestAccrued) {
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
    totalInterestAccrued = _calculateInterest(
      cl._checkpointedAsOf,
      MathUpgradeable.min(applyBufferAt, end),
      lateFeesStartAt,
      cl._waterfall.totalPrincipalOutstanding(),
      cl._interestApr,
      cl._lateAdditionalApr
    );
    if (cl._bufferedPayments > 0 && applyBufferAt < end) {
      // Calculate interest accrued after the payment buffer is applied.
      totalInterestAccrued += _calculateInterest(
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
    CheckpointedCallableCreditLine storage cl
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
    CheckpointedCallableCreditLine storage cl,
    uint timestamp
  ) internal view returns (uint) {
    return cl._paymentSchedule.principalPeriodAt(timestamp);
  }

  function isLate(CheckpointedCallableCreditLine storage cl) internal view returns (bool) {
    cl.isLate(block.timestamp);
  }

  function isLate(
    CheckpointedCallableCreditLine storage cl,
    uint256 timestamp
  ) internal view returns (bool) {
    uint256 gracePeriodInSeconds = cl._config.getLatenessGracePeriodInDays() * SECONDS_PER_DAY;
    uint256 oldestUnpaidDueTime = cl._paymentSchedule.nextDueTimeAt(cl._lastFullPaymentTime);
    return
      cl._waterfall.totalPrincipalOutstanding() > 0 &&
      timestamp > oldestUnpaidDueTime + gracePeriodInSeconds;
  }

  function interestApr(CheckpointedCallableCreditLine storage cl) public view returns (uint) {
    return cl._interestApr;
  }

  function lateFeeAdditionalApr(
    CheckpointedCallableCreditLine storage cl
  ) public view returns (uint) {
    return cl._lateAdditionalApr;
  }

  function limit(CheckpointedCallableCreditLine storage cl) public view returns (uint) {
    return cl._limit;
  }

  function balance(CheckpointedCallableCreditLine storage cl) internal view returns (uint256) {
    return cl.interestOwed() + cl.principalOwed();
  }

  function totalPrincipalDeposited(
    CheckpointedCallableCreditLine storage cl
  ) internal view returns (uint256) {
    return cl._waterfall.totalPrincipalDeposited();
  }

  function principalOutstanding(
    CheckpointedCallableCreditLine storage cl
  ) internal view returns (uint256) {
    return cl._waterfall.totalPrincipalOutstanding();
  }

  function totalInterestAccrued(
    CheckpointedCallableCreditLine storage cl
  ) internal view returns (uint256) {
    return cl.totalInterestAccruedAt(block.timestamp);
  }

  ////////////////////////////////////////////////////////////////////////////////
  // END VIEW STORAGE - DUPLICATE ABOVE SECTION TO VIEW MEMORY VERSIONS
  ////////////////////////////////////////////////////////////////////////////////

  ////////////////////////////////////////////////////////////////////////////////
  // VIEW MEMORY
  ////////////////////////////////////////////////////////////////////////////////

  // TODO: Should account for end of term.
  function principalOwedAt(
    CheckpointedCallableCreditLine storage cl,
    uint timestamp
  ) internal view returns (uint principalOwed) {
    require(timestamp > block.timestamp, "Cannot query past principal owed");
    uint endTrancheIndex = cl._paymentSchedule.principalPeriodAt(timestamp);
    for (uint i = cl.earliestPrincipalOutstandingTrancheIndex(); i < endTrancheIndex; i++) {
      principalOwed += cl._waterfall.getTranche(i).principalOutstanding();
    }
  }

  function principalOwed(CheckpointedCallableCreditLine storage cl) internal view returns (uint) {
    return cl.principalOwedAt(block.timestamp);
  }

  function totalPrincipalOwed(
    CheckpointedCallableCreditLine storage cl
  ) internal view returns (uint256) {
    return cl.totalPrincipalOwedAt(block.timestamp);
  }

  function totalPrincipalOwedAt(
    CheckpointedCallableCreditLine storage cl,
    uint timestamp
  ) internal view returns (uint) {
    uint endTrancheIndex = cl._paymentSchedule.principalPeriodAt(timestamp);
    return cl._waterfall.totalPrincipalOwedUpToTranche(endTrancheIndex);
  }

  function totalPrincipalPaid(
    CheckpointedCallableCreditLine storage cl
  ) internal view returns (uint) {
    return cl._waterfall.totalPrincipalPaid();
  }

  function totalPrincipalOwedBeforeTranche(
    CheckpointedCallableCreditLine storage cl,
    uint trancheIndex
  ) internal view returns (uint principalDeposited) {
    for (uint i = 0; i < trancheIndex; i++) {
      principalDeposited += cl._waterfall.getTranche(i).principalDeposited();
    }
  }

  function totalInterestOwed(
    CheckpointedCallableCreditLine storage cl
  ) internal view returns (uint) {
    return cl.totalInterestOwedAt(block.timestamp);
  }

  /**
   * Calculates total interest owed at a given timestamp.
   * IT: Invalid timestamp - timestamp must be after the last checkpoint.
   */
  function totalInterestOwedAt(
    CheckpointedCallableCreditLine storage cl,
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

  function interestOwed(CheckpointedCallableCreditLine storage cl) internal view returns (uint) {
    cl.interestOwedAt(block.timestamp);
  }

  /**
   * Calculates total interest owed at a given timestamp.
   * Assumes that principal outstanding is constant from now until the given `timestamp`.
   */
  function interestOwedAt(
    CheckpointedCallableCreditLine storage cl,
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
    CheckpointedCallableCreditLine storage cl,
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
    CheckpointedCallableCreditLine storage cl,
    uint256 end
  ) internal view returns (uint256 totalInterestAccrued) {
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
    totalInterestAccrued = _calculateInterest(
      cl._checkpointedAsOf,
      MathUpgradeable.min(applyBufferAt, end),
      lateFeesStartAt,
      cl._waterfall.totalPrincipalOutstanding(),
      cl._interestApr,
      cl._lateAdditionalApr
    );
    if (cl._bufferedPayments > 0 && applyBufferAt < end) {
      // Calculate interest accrued after the payment buffer is applied.
      totalInterestAccrued += _calculateInterest(
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
    CheckpointedCallableCreditLine memory cl
  ) internal view returns (uint) {
    Tranche memory tranche;
    for (uint i = 0; i < cl._waterfall.numTranches(); i++) {
      tranche = cl._waterfall.getTranche(i);
      if (tranche.principalOutstanding() == 0) {
        return i;
      }
    }
  }

  function isLate(CheckpointedCallableCreditLine memory cl) internal view returns (bool) {
    cl.isLate(block.timestamp);
  }

  function isLate(
    CheckpointedCallableCreditLine memory cl,
    uint256 timestamp
  ) internal view returns (bool) {
    uint256 gracePeriodInSeconds = cl._config.getLatenessGracePeriodInDays() * SECONDS_PER_DAY;
    uint256 oldestUnpaidDueTime = cl._paymentSchedule.nextDueTimeAt(cl._lastFullPaymentTime);
    return
      cl._waterfall.totalPrincipalOutstanding() > 0 &&
      timestamp > oldestUnpaidDueTime + gracePeriodInSeconds;
  }

  function balance(CheckpointedCallableCreditLine memory cl) internal view returns (uint256) {
    return cl.interestOwed() + cl.principalOwed();
  }

  function totalPrincipalDeposited(
    CheckpointedCallableCreditLine memory cl
  ) internal view returns (uint256) {
    return cl._waterfall.totalPrincipalDeposited();
  }

  function principalOutstanding(
    CheckpointedCallableCreditLine memory cl
  ) internal view returns (uint256) {
    return cl._waterfall.totalPrincipalOutstanding();
  }

  function totalInterestAccrued(
    CheckpointedCallableCreditLine memory cl
  ) internal view returns (uint256) {
    return cl.totalInterestAccruedAt(block.timestamp);
  }

  ////////////////////////////////////////////////////////////////////////////////
  // END VIEW MEMORY - DUPLICATED FROM VIEW STORAGE SECTION
  ////////////////////////////////////////////////////////////////////////////////

  /**
   * Calculates interest accrued along with late interest over a given time period given constant principal
   *
   */
  function _calculateInterest(
    uint256 start,
    uint256 end,
    uint256 lateFeesStartsAt,
    uint256 principal,
    uint256 interestApr,
    uint256 lateInterestApr
  ) private pure returns (uint256 interest) {
    if (end < start) return 0;
    uint256 totalDuration = end - start;
    interest = _calculateInterest(totalDuration, principal, interestApr);
    if (lateFeesStartsAt < end) {
      uint256 lateDuration = end.saturatingSub(MathUpgradeable.max(lateFeesStartsAt, start));
      interest += _calculateInterest(lateDuration, principal, lateInterestApr);
    }
  }

  /**
   * Calculates flat interest accrued over a period of time given constant principal.
   */
  function _calculateInterest(
    uint256 secondsElapsed,
    uint256 principal,
    uint256 interestApr
  ) private pure returns (uint256 interest) {
    uint256 totalInterestPerYear = (principal * interestApr) / INTEREST_DECIMALS;
    interest = (totalInterestPerYear * secondsElapsed) / SECONDS_PER_YEAR;
  }
}
