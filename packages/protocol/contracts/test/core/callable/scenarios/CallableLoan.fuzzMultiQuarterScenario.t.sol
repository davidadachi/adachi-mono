pragma solidity ^0.8.0;

import {CallableLoanBaseTest} from "../BaseCallableLoan.t.sol";
import {DepositWithPermitHelpers} from "../../../helpers/DepositWithPermitHelpers.t.sol";
import {console2 as console} from "forge-std/console2.sol";

import {CallableLoan} from "../../../../protocol/core/callable/CallableLoan.sol";
import {ITranchedPool} from "../../../../interfaces/ITranchedPool.sol";
import {ILoan} from "../../../../interfaces/ILoan.sol";
import {ICreditLine} from "../../../../interfaces/ICreditLine.sol";
import {IGoldfinchConfig} from "../../../../interfaces/IGoldfinchConfig.sol";
import {CallableLoanBaseTest} from "../BaseCallableLoan.t.sol";
import {SaturatingSub} from "../../../../library/SaturatingSub.sol";
import {MathUpgradeable as Math} from "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import {CallableBorrower, CallableLender} from "./CallableScenarioActor.t.sol";
import {CallableLoanAccountant} from "../../../../protocol/core/callable/CallableLoanAccountant.sol";
import {CallableLoanConfigHelper} from "../../../../protocol/core/callable/CallableLoanConfigHelper.sol";

contract CallableLoanMultiQuarterScenario is CallableLoanBaseTest {
  using SaturatingSub for uint256;
  using CallableLoanConfigHelper for IGoldfinchConfig;

  CallableLoan public callableLoan;
  ICreditLine public creditLine;
  CallableLender[4] public lenders;
  CallableBorrower public borrower;

  uint256 public totalDeposits;
  uint256 public drawdownTime;

  string public assertionTag;

  uint256 public constant INTEREST_APR = 145 * 1e15;
  uint256 public constant LATE_INTEREST_APR = 2 * 1e16;

  function setupDepositorsAndLenders(
    uint256 depositAmount1,
    uint256 depositAmount2,
    uint256 depositAmount3,
    uint256 depositAmount4,
    uint256 drawdownAmount
  ) private {
    totalDeposits = depositAmount1 + depositAmount2 + depositAmount3 + depositAmount4;

    borrower = new CallableBorrower(usdc);

    (callableLoan, ) = callableLoanWithLimit(totalDeposits);

    (callableLoan, creditLine) = callableLoanBuilder
      .withLimit(totalDeposits)
      .withApr(INTEREST_APR)
      .withLateFeeApr(LATE_INTEREST_APR)
      .build(address(borrower));

    borrower.setLoan(callableLoan);
    lenders[0] = new CallableLender(callableLoan, usdc);
    lenders[1] = new CallableLender(callableLoan, usdc);
    lenders[2] = new CallableLender(callableLoan, usdc);
    lenders[3] = new CallableLender(callableLoan, usdc);

    _startImpersonation(GF_OWNER);
    gfConfig.addToGoList(address(borrower));
    gfConfig.addToGoList(address(lenders[0]));
    gfConfig.addToGoList(address(lenders[1]));
    gfConfig.addToGoList(address(lenders[2]));
    gfConfig.addToGoList(address(lenders[3]));

    usdc.transfer(address(borrower), usdcVal(1_000_000_000));
    usdc.transfer(address(lenders[0]), usdcVal(1_000_000_000));
    usdc.transfer(address(lenders[1]), usdcVal(1_000_000_000));
    usdc.transfer(address(lenders[2]), usdcVal(1_000_000_000));
    usdc.transfer(address(lenders[3]), usdcVal(1_000_000_000));
    _stopImpersonation();

    lenders[0].deposit(depositAmount1);
    lenders[1].deposit(depositAmount2);
    lenders[2].deposit(depositAmount3);
    lenders[3].deposit(depositAmount4);

    drawdownTime = block.timestamp;
    borrower.drawdown(totalDeposits);
    warpToAfterDrawdownPeriod(callableLoan);
  }

  /// Make deposits for each user (4 users)
  /// Submit 1st call for the first call request period
  /// Make full payments each interest period and then the call principal
  /// Submit 2nd call for the second call request period
  /// Make full payments each interest period and then the call principal
  /// Submit 3rd call for the third call request period
  /// Make full payments each interest period and then the call principal
  function testMultiCallRequestPeriodsHappy(
    uint256 depositAmount1,
    uint256 depositAmount2,
    uint256 depositAmount3,
    uint256 depositAmount4,
    uint256 callAmount1,
    uint256 callAmount2,
    uint256 callAmount3,
    uint256 drawdownAmount,
    uint256 fuzzWarpOffset
  ) public {
    depositAmount1 = bound(depositAmount1, usdcVal(1), usdcVal(100_000_000));
    depositAmount2 = bound(depositAmount2, usdcVal(1), usdcVal(100_000_000));
    depositAmount3 = bound(depositAmount3, usdcVal(1), usdcVal(100_000_000));
    depositAmount4 = bound(depositAmount4, usdcVal(1), usdcVal(100_000_000));
    // 20 days - Even with drawdown period, will result in jump to a time in the same month.
    fuzzWarpOffset = bound(fuzzWarpOffset, 0, 20 days);

    setupDepositorsAndLenders(
      depositAmount1,
      depositAmount2,
      depositAmount3,
      depositAmount4,
      drawdownAmount
    );

    {
      assertionTag = "Call Request Period 1: ";
      callAmount1 = checkAndBoundCallRequestAmount({
        tokenId: lenders[0].tokenIds(0),
        fuzzedCallAmount: callAmount1,
        expectedAmount: depositAmount1
      });

      submitCallAndCheckOtherTokens({
        callAmount: callAmount1,
        lenderIndexToCall: 0,
        tokenIndexToCall: 0
      });

      uint256 preExistingOwed = CallableLoanAccountant.calculateInterest({
        secondsElapsed: callableLoan.termStartTime() - drawdownTime,
        principal: totalDeposits,
        interestApr: INTEREST_APR
      });
      fullyPayThisQuarter({
        preExistingOwed: preExistingOwed,
        principalGeneratingInterest: totalDeposits,
        principalDueAtEnd: callAmount1,
        quarterStartTime: callableLoan.termStartTime(),
        warpOffset: fuzzWarpOffset
      });
    }

    {
      assertionTag = "Call Request Period 2: ";
      callAmount2 = checkAndBoundCallRequestAmount({
        tokenId: lenders[1].tokenIds(0),
        fuzzedCallAmount: callAmount2,
        expectedAmount: depositAmount2
      });
      submitCallAndCheckOtherTokens({
        callAmount: callAmount2,
        lenderIndexToCall: 1,
        tokenIndexToCall: 0
      });

      fullyPayThisQuarter({
        preExistingOwed: 0,
        principalGeneratingInterest: totalDeposits - callAmount1,
        principalDueAtEnd: callAmount2,
        quarterStartTime: block.timestamp,
        warpOffset: fuzzWarpOffset
      });
    }

    {
      assertionTag = "Call Request Period 3: ";
      callAmount3 = checkAndBoundCallRequestAmount({
        tokenId: lenders[2].tokenIds(0),
        fuzzedCallAmount: callAmount3,
        expectedAmount: depositAmount3
      });
      submitCallAndCheckOtherTokens({
        callAmount: callAmount3,
        lenderIndexToCall: 2,
        tokenIndexToCall: 0
      });
      fullyPayThisQuarter({
        preExistingOwed: 0,
        principalGeneratingInterest: totalDeposits - callAmount1 - callAmount2,
        principalDueAtEnd: callAmount3,
        quarterStartTime: block.timestamp,
        warpOffset: fuzzWarpOffset
      });
    }
  }

  /// Make deposits for each user (4 users)
  /// Submit 1st call for the first call request period
  /// Make full payments each interest period and then the call principal
  /// Submit 2nd call for the second call request period
  /// Make late payemnt sometime during the principal payment period
  /// Submit 3rd call for the third call request period
  /// Make full payments each interest period and then the call principal
  function testMultiCallRequestPeriodsPayLate1(
    uint256 depositAmount1,
    uint256 depositAmount2,
    uint256 depositAmount3,
    uint256 depositAmount4,
    uint256 callAmount1,
    uint256 callAmount2,
    uint256 callAmount3,
    uint256 drawdownAmount,
    uint256 fuzzWarpOffset
  ) public {
    depositAmount1 = bound(depositAmount1, usdcVal(1), usdcVal(100_000_000));
    depositAmount2 = bound(depositAmount2, usdcVal(1), usdcVal(100_000_000));
    depositAmount3 = bound(depositAmount3, usdcVal(1), usdcVal(100_000_000));
    depositAmount4 = bound(depositAmount4, usdcVal(1), usdcVal(100_000_000));
    // 20 days - Even with drawdown period, will result in jump to a time in the same month.
    fuzzWarpOffset = bound(fuzzWarpOffset, 0, 20 days);

    setupDepositorsAndLenders(
      depositAmount1,
      depositAmount2,
      depositAmount3,
      depositAmount4,
      drawdownAmount
    );

    {
      assertionTag = "Call Request Period 1: ";
      callAmount1 = checkAndBoundCallRequestAmount({
        tokenId: lenders[0].tokenIds(0),
        fuzzedCallAmount: callAmount1,
        expectedAmount: depositAmount1
      });

      submitCallAndCheckOtherTokens({
        callAmount: callAmount1,
        lenderIndexToCall: 0,
        tokenIndexToCall: 0
      });

      uint256 preExistingOwed = CallableLoanAccountant.calculateInterest({
        secondsElapsed: callableLoan.termStartTime() - drawdownTime,
        principal: totalDeposits,
        interestApr: INTEREST_APR
      });
      fullyPayThisQuarter({
        preExistingOwed: preExistingOwed,
        principalGeneratingInterest: totalDeposits,
        principalDueAtEnd: callAmount1,
        quarterStartTime: callableLoan.termStartTime(),
        warpOffset: fuzzWarpOffset
      });
    }

    {
      assertionTag = "Call Request Period 2: ";
      uint256 quarterStartTime = block.timestamp;
      callAmount2 = checkAndBoundCallRequestAmount({
        tokenId: lenders[1].tokenIds(0),
        fuzzedCallAmount: callAmount2,
        expectedAmount: depositAmount2
      });
      submitCallAndCheckOtherTokens({
        callAmount: callAmount2,
        lenderIndexToCall: 1,
        tokenIndexToCall: 0
      });

      /**
       * SKIP PAYMENT FOR FIRST TWO MONTHS IN THE QUARTER
       */
      vm.warp(callableLoan.nextDueTime());
      uint256 startOfLateFeeCounter = block.timestamp;
      vm.warp(callableLoan.nextDueTime());

      uint256 startOfMonth = block.timestamp;
      skip(fuzzWarpOffset);
      uint256 totalOwedAtNextDueTime = callableLoan.interestOwedAt(callableLoan.nextDueTime()) +
        callableLoan.principalOwedAt(callableLoan.nextDueTime());
      uint256 principalGeneratingInterest = totalDeposits - callAmount1;

      uint256 regularInterestOwed = CallableLoanAccountant.calculateInterest({
        secondsElapsed: callableLoan.nextDueTime() - quarterStartTime,
        principal: principalGeneratingInterest,
        interestApr: INTEREST_APR
      });
      uint256 lateInterestOwed = CallableLoanAccountant.calculateInterest({
        secondsElapsed: (block.timestamp - startOfLateFeeCounter).saturatingSub(
          gfConfig.getLatenessGracePeriodInDays()
        ),
        principal: principalGeneratingInterest,
        interestApr: LATE_INTEREST_APR
      });
      assertApproxEqAbs(
        callableLoan.interestOwedAt(callableLoan.nextDueTime()),
        regularInterestOwed + lateInterestOwed,
        1,
        string.concat(assertionTag, "Total interest owed at next due time - Month 3")
      );

      assertApproxEqAbs(
        callableLoan.principalOwedAt(callableLoan.nextDueTime()),
        callAmount2,
        1,
        string.concat(assertionTag, "Total principal owed at next due time - Month 3")
      );

      borrower.pay(
        callableLoan.interestOwedAt(callableLoan.nextDueTime()) +
          callableLoan.principalOwedAt(callableLoan.nextDueTime())
      );

      vm.warp(callableLoan.nextDueTime());

      assertZero(
        callableLoan.principalOwed(),
        string.concat(assertionTag, "Principal owed zeroed out")
      );
      assertZero(
        callableLoan.interestOwed(),
        string.concat(assertionTag, "Interest owed zeroed out")
      );
    }

    {
      assertionTag = "Call Request Period 3: ";
      callAmount3 = checkAndBoundCallRequestAmount({
        tokenId: lenders[2].tokenIds(0),
        fuzzedCallAmount: callAmount3,
        expectedAmount: depositAmount3
      });
      submitCallAndCheckOtherTokens({
        callAmount: callAmount3,
        lenderIndexToCall: 2,
        tokenIndexToCall: 0
      });
      fullyPayThisQuarter({
        preExistingOwed: 0,
        principalGeneratingInterest: totalDeposits - callAmount1 - callAmount2,
        principalDueAtEnd: callAmount3,
        quarterStartTime: block.timestamp,
        warpOffset: fuzzWarpOffset
      });
    }
  }

  function checkAndBoundCallRequestAmount(
    uint256 tokenId,
    uint256 fuzzedCallAmount,
    uint256 expectedAmount
  ) public returns (uint256 boundedCallAmount) {
    uint256 availableToCall = callableLoan.availableToCall(tokenId);
    assertApproxEqAbs(availableToCall, expectedAmount, HUNDREDTH_CENT, assertionTag);
    return boundedCallAmount = bound(fuzzedCallAmount, 1, availableToCall);
  }

  /**
   * @param warpOffset - Warp with this time offset before making each payment
   */
  function fullyPayThisQuarter(
    uint256 preExistingOwed,
    uint256 principalGeneratingInterest,
    uint256 principalDueAtEnd,
    uint256 quarterStartTime,
    uint256 warpOffset
  ) private {
    fullyPayInterestMonth({
      preExistingOwed: preExistingOwed,
      principalGeneratingInterest: principalGeneratingInterest,
      monthStartTime: quarterStartTime,
      warpOffset: warpOffset,
      assertionMonthTag: " - Month 1 in quarter"
    });

    uint256 startOfMonth = callableLoan.nextDueTime();
    vm.warp(startOfMonth);

    fullyPayInterestMonth({
      preExistingOwed: 0,
      principalGeneratingInterest: principalGeneratingInterest,
      monthStartTime: startOfMonth,
      warpOffset: warpOffset,
      assertionMonthTag: " - Month 2 in quarter"
    });

    startOfMonth = callableLoan.nextDueTime();
    vm.warp(startOfMonth);

    fullyPayInterestAndPrincipalMonth({
      preExistingOwed: 0,
      principalGeneratingInterest: principalGeneratingInterest,
      principalDueAtEnd: principalDueAtEnd,
      monthStartTime: startOfMonth,
      warpOffset: warpOffset,
      assertionMonthTag: " - Month 3 in quarter"
    });
  }

  /**
   * @notice Assumes no late fees
   */
  function fullyPayInterestMonth(
    uint256 preExistingOwed,
    uint256 principalGeneratingInterest,
    uint256 monthStartTime,
    uint256 warpOffset,
    string memory assertionMonthTag
  ) private {
    skip(warpOffset);
    assertEq(
      callableLoan.principalOwedAt(callableLoan.nextDueTime()),
      0,
      "No principal should be owed - fully paying interest month"
    );
    uint256 totalOwedAtNextDueTime = callableLoan.interestOwedAt(callableLoan.nextDueTime());
    assertApproxEqAbs(
      totalOwedAtNextDueTime,
      preExistingOwed +
        CallableLoanAccountant.calculateInterest({
          secondsElapsed: callableLoan.nextDueTime() - monthStartTime,
          principal: principalGeneratingInterest,
          interestApr: INTEREST_APR
        }),
      1,
      string.concat(string.concat(assertionTag, "Total owed at next due time"), assertionMonthTag)
    );
    borrower.pay(totalOwedAtNextDueTime);
  }

  /**
   * @notice Assumes no late fees
   */
  function fullyPayInterestAndPrincipalMonth(
    uint256 preExistingOwed,
    uint256 principalGeneratingInterest,
    uint256 principalDueAtEnd,
    uint256 monthStartTime,
    uint256 warpOffset,
    string memory assertionMonthTag
  ) private {
    skip(warpOffset);
    uint256 totalOwedAtNextDueTime = callableLoan.interestOwedAt(callableLoan.nextDueTime()) +
      callableLoan.principalOwedAt(callableLoan.nextDueTime());
    assertApproxEqAbs(
      totalOwedAtNextDueTime,
      CallableLoanAccountant.calculateInterest({
        secondsElapsed: callableLoan.nextDueTime() - monthStartTime,
        principal: principalGeneratingInterest,
        interestApr: INTEREST_APR
      }) +
        principalDueAtEnd +
        preExistingOwed,
      1,
      string.concat(string.concat(assertionTag, "Total owed at next due time"), assertionMonthTag)
    );
    borrower.pay(totalOwedAtNextDueTime);

    vm.warp(callableLoan.nextDueTime());

    assertZero(
      callableLoan.principalOwed(),
      string.concat(assertionTag, "Principal owed zeroed out")
    );
    assertZero(
      callableLoan.interestOwed(),
      string.concat(assertionTag, "Interest owed zeroed out")
    );
  }

  function submitCallAndCheckOtherTokens(
    uint256 callAmount,
    uint256 lenderIndexToCall,
    uint256 tokenIndexToCall
  ) private {
    uint256[][] memory availableToWithdraw = new uint256[][](lenders.length);
    for (uint256 i = 0; i < lenders.length; i++) {
      availableToWithdraw[i] = new uint256[](lenders[i].tokenIdsLength());
      if (i != lenderIndexToCall) {
        for (uint256 j = 0; j < lenders[i].tokenIdsLength(); j++) {
          (uint256 interest, uint256 principal) = lenders[i].availableToWithdraw(
            lenders[i].tokenIds(j)
          );
          availableToWithdraw[i][j] = interest + principal;
        }
      }
    }
    lenders[lenderIndexToCall].submitCall(
      callAmount,
      lenders[lenderIndexToCall].tokenIds(tokenIndexToCall)
    );

    for (uint256 i = 0; i < lenders.length; i++) {
      if (i != lenderIndexToCall) {
        for (uint256 j = 0; j < lenders[i].tokenIdsLength(); j++) {
          (uint256 interest, uint256 principal) = lenders[i].availableToWithdraw(
            lenders[i].tokenIds(j)
          );
          assertApproxEqAbs(
            availableToWithdraw[i][j],
            interest + principal,
            HUNDREDTH_CENT,
            string.concat(assertionTag, "Available to withdraw")
          );
        }
      }
    }
  }
}
