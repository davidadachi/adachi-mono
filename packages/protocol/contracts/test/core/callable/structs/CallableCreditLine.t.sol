// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;
pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";
// solhint-disable-next-line max-line-length
import {CallableCreditLine, CallableCreditLineLogic, CheckpointedCallableCreditLine, CheckpointedCallableCreditLineLogic} from "../../../../protocol/core/callable/structs/CallableCreditLine.sol";
import {Tranche, TrancheLogic} from "../../../../protocol/core/callable/structs/Waterfall.sol";
import {IMonthlyScheduleRepo} from "../../../../interfaces/IMonthlyScheduleRepo.sol";
import {IGoldfinchConfig} from "../../../../interfaces/IGoldfinchConfig.sol";
import {ISchedule} from "../../../../interfaces/ISchedule.sol";

using CallableCreditLineLogic for CallableCreditLine;
using CheckpointedCallableCreditLineLogic for CheckpointedCallableCreditLine;

using TrancheLogic for Tranche;

contract TestCallableCreditLine is Test {
  uint256 public constant DEFAULT_LIMIT = 1_000_000 * 1e6;
  uint256 public constant DEFAULT_APR = 5 * 1e16;
  uint256 public constant DEFAULT_LATE_ADDITIONAL_APR = 1 * 1e16;

  CallableCreditLine internal callableCreditLine;
  IGoldfinchConfig internal config;
  IMonthlyScheduleRepo private monthlyScheduleRepo;
  ISchedule private schedule;

  uint256 constant defaultInterestApr = 1000;
  uint256 constant firstDepositor = 0x64;

  function setUp() external {
    monthlyScheduleRepo = IMonthlyScheduleRepo(deployCode("MonthlyScheduleRepo.sol"));
    config = IGoldfinchConfig(deployCode("GoldfinchConfig.sol"));
    monthlyScheduleRepo.createSchedule({
      periodsInTerm: 36,
      periodsPerInterestPeriod: 1,
      periodsPerPrincipalPeriod: 3,
      gracePrincipalPeriods: 0
    });
    schedule = defaultSchedule();
  }

  function defaultSchedule() public returns (ISchedule) {
    return
      monthlyScheduleRepo.getSchedule({
        periodsInTerm: 36,
        periodsPerInterestPeriod: 1,
        periodsPerPrincipalPeriod: 3,
        gracePrincipalPeriods: 0
      });
  }

  function testInitialize() public {
    callableCreditLine.initialize(
      config,
      DEFAULT_APR,
      schedule,
      DEFAULT_LATE_ADDITIONAL_APR,
      DEFAULT_LIMIT
    );
    CheckpointedCallableCreditLine storage cpcl = callableCreditLine.checkpoint();
    assertEq(address(cpcl._config), address(config));
    assertEq(address(cpcl._paymentSchedule.schedule), address(schedule));
    assertEq(cpcl.interestApr(), DEFAULT_APR);
    assertEq(cpcl.lateFeeAdditionalApr(), DEFAULT_LATE_ADDITIONAL_APR);
    assertEq(cpcl.limit(), DEFAULT_LIMIT);
  }

  // TODO
  function testDeposit(uint256 depositAmount) public {
    callableCreditLine = defaultWithLimit(depositAmount);
    CheckpointedCallableCreditLine storage cpcl = callableCreditLine.checkpoint();
    cpcl.deposit(depositAmount);
    assertEq(cpcl.totalPrincipalDeposited(), depositAmount);
    assertEq(cpcl.totalPrincipalPaid(), depositAmount);
    assertEq(cpcl.principalOutstanding(), 0);
    assertEq(cpcl.totalInterestAccrued(), 0);
    assertEq(cpcl.interestOwed(), 0);
  }

  // TODO
  function testDrawdown(uint256 depositAmount, uint256 drawdownAmount) public {
    callableCreditLine = defaultWithLimit(depositAmount);
    drawdownAmount = bound(drawdownAmount, 0, depositAmount);
    CheckpointedCallableCreditLine cpcl = callableCreditLine.checkpoint();
    cpcl.deposit(depositAmount);
    cpcl.drawdown(drawdownAmount);
    assertEq(cpcl.totalPrincipalDeposited(), depositAmount);
    assertEq(cpcl.totalPrincipalPaid(), depositAmount - drawdownAmount);
    assertEq(cpcl.principalOutstanding(), drawdownAmount);
    assertEq(cpcl.totalInterestAccrued(), 0);
    assertEq(cpcl.interestOwed(), 0);
  }

  // TODO
  function testPay(uint256 depositAmount, uint256 interest, uint256 principal) public {
    CheckpointedCallableCreditLine cpcl = fullyFundedAndDrawndown(depositAmount);
    cpcl.pay(interest, principal);
    assertEq(cpcl.totalPrincipalDeposited(), depositAmount);
    assertEq(cpcl.totalPrincipalPaid(), depositAmount - drawdownAmount);
    assertEq(cpcl.principalOutstanding(), drawdownAmount);

    // Assert that interest is prepaid
    assertEq(cpcl.totalInterestAccrued(), 0);
    assertEq(cpcl.interestOwed(), 0);
  }

  function testCall() public {}

  function testWithdraw() public {}

  function testUncalledCapitalIndex() public {}

  function testCheckpoint() public {}

  function testApplyBuffer() public {}

  function testApplyBufferPreview() public {}

  function testNextDueTimeAt() public {}

  function testTermStartTime() public {}

  function testTermEndTime() public {}

  // TODO: Should account for end of term.
  function testPrincipalOwedAt() public {}

  function testPrincipalOwed() public {}

  function testTotalPrincipalOwed() public {}

  function testTotalPrincipalOwedAt() public {}

  function testTotalPrincipalPaid() public {}

  function testTotalPrincipalOwedBeforeTranche() public {}

  function testTotalInterestOwed() public {}

  function testTotalInterestOwedAt() public {}

  function testInterestOwed() public {}

  function testInterestOwedAt() public {}

  function testInterestAccruedAt() public {}

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
  function testTotalInterestAccruedAt() public {}

  function testEarliestPrincipalOutstandingTrancheIndex() public {}

  // TODO
  function testIsLate() public {}

  // TODO
  function testInterestAccrualWithoutRepayment() public {}

  function defaultWithLimit(uint256 limit) public returns (CallableCreditLine) {
    return new CallableCreditLine(config, defaultInterestApr, schedule, 0, limit);
  }

  function fullyFundedAndDrawndown(uint256 limit) public returns (CheckpointedCallableCreditLine) {
    callableCreditLine = defaultWithLimit(limit);
    CheckpointedCallableCreditLine cpcl = callableCreditLine.checkpoint();
    cpcl.deposit(limit);
    cpcl.drawdown(limit);
    return cpcl;
  }

  // Interest calculations and accounting after repayment
  // 1. Calculation of interest accrual over time without accounting for repayments.
  // 2. Calculation of interest accrual over time accounting for late fees
  // 3. Attempt to overpay interest obligations - Reject(?) Should not be able to pay off more than interest owed
  // 5. Underpay interest obligations - interest paid should be paid down by payment amount
  // 6. Pay off entirety of loan
  // 7. Pay off more than entirety of loan.

  // Payment waterfall calculations
  // 1. Pay off all interest + principal obligations
  // 2. Pay off all interest obligations
  // 3. Pay off portion of interest obligations
  // 4. Pay off portion of interest obligations, principal obligations
  // 5. Attempt to only pay off principal obligations when existing interest obligations exist - should fail
  // 6. Attempt to pay off more than all obligations - should fail or account towards excess balance

  // Test principal calculations
  // 1. Overpay past due principal obligations - some should buffer, some should go to principal paid
  // 2. Underpay past due principal obligations - all should go to principal paid
  // 3. Pay off entirety of principal obligations, both past due and from current call request tranche.
  //    Principal paid should be all the way paid down and buffer should receive rest.
  // 4. Pay off entirety of loan. Principal paid should be all the way paid down and buffer should receive rest.
  // 5. Attempt to pay off more than entirety of loan. Should fail or account towards excess balance
}
