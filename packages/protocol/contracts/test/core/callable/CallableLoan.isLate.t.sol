// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {CallableLoanBaseTest} from "./BaseCallableLoan.t.sol";
import {CallableLoan} from "../../../protocol/core/callable/CallableLoan.sol";
import {ConfigOptions} from "../../../protocol/core/ConfigOptions.sol";
import {ICreditLine} from "../../../interfaces/ICreditLine.sol";
import {ICallableLoanErrors} from "../../../interfaces/ICallableLoanErrors.sol";

contract CallableLoanIsLateTest is CallableLoanBaseTest {
  function setUp() public override {
    super.setUp();

    _startImpersonation(GF_OWNER);
    gfConfig.setNumber(uint256(ConfigOptions.Numbers.LatenessGracePeriodInDays), 10);
    _stopImpersonation();
  }

  function testNotLateIfNoBalance(uint256 balance, uint256 warpedTimestamp) public {
    (CallableLoan callableLoan, ICreditLine cl) = defaultCallableLoan();
    assertFalse(cl.isLate());

    balance = bound(balance, 1, callableLoan.limit());

    depositAndDrawdown(callableLoan, balance);

    warpToAfterDrawdownPeriod(callableLoan);
    warpedTimestamp = bound(warpedTimestamp, 1, 1000 days);
    pay(callableLoan, cl.balance() + cl.interestOwedAt(callableLoan.nextPrincipalDueTime()));
    vm.warp(block.timestamp + warpedTimestamp);
    assertFalse(cl.isLate());
  }

  function testNotLateIfNotPastDueTime(uint256 timestamp) public {
    (CallableLoan callableLoan, ICreditLine cl) = defaultCallableLoan();
    uint256 limit = usdcVal(100);
    depositAndDrawdown(callableLoan, limit);

    timestamp = bound(timestamp, block.timestamp, cl.nextDueTime() - 1);

    vm.warp(timestamp);

    assertFalse(cl.isLate());
  }

  function testNotLateIfPastDueTimeButWithinGracePeriod(uint256 timestamp) public {
    (CallableLoan callableLoan, ICreditLine cl) = defaultCallableLoan();
    uint256 limit = usdcVal(100);

    depositAndDrawdown(callableLoan, limit);

    timestamp = bound(timestamp, cl.nextDueTime(), cl.nextDueTime());

    vm.warp(timestamp);

    assertFalse(cl.isLate());
  }

  function testLateIfPastDueTimeAndPastGracePeriod(uint256 timestamp) public {
    (CallableLoan callableLoan, ICreditLine cl) = defaultCallableLoan();
    uint256 limit = usdcVal(100);
    depositAndDrawdown(callableLoan, limit);

    timestamp = bound(timestamp, cl.nextDueTime() + 1, cl.termEndTime());

    vm.warp(timestamp);

    assertTrue(cl.isLate());
  }

  function testIsNotLateIfCurrentAtTermEndTimeAndInGracePeriod(uint256 timestamp) public {
    (CallableLoan callableLoan, ICreditLine cl) = defaultCallableLoan();
    uint256 limit = usdcVal(100);
    depositAndDrawdown(callableLoan, limit);
    warpToAfterDrawdownPeriod(callableLoan);

    // Advance to the last payment period and pay back interest
    for (uint256 i = 0; i < 11; ++i) {
      vm.warp(cl.nextDueTime());
      if (cl.interestOwed() > 0) {
        pay(callableLoan, cl.interestOwed());
      }
    }

    assertEq(cl.nextDueTime(), cl.termEndTime());

    timestamp = bound(timestamp, cl.termEndTime(), cl.termEndTime());
    vm.warp(timestamp);

    assertFalse(cl.isLate());
  }

  function testIsLateIfCurrentAtTermEndTimeAndAfterGracePeriod(uint256 timestamp) public {
    (CallableLoan callableLoan, ICreditLine cl) = defaultCallableLoan();
    uint256 limit = usdcVal(100);

    uid._mintForTest(GF_OWNER, 1, 1, "");
    depositAndDrawdown(callableLoan, limit);
    warpToAfterDrawdownPeriod(callableLoan);

    // Advance to the last payment period and pay back interes
    for (uint256 i = 0; i < 11; ++i) {
      vm.warp(cl.nextDueTime());
      if (cl.interestOwed() > 0) {
        pay(callableLoan, cl.interestOwed());
      }
    }

    assertEq(cl.nextDueTime(), cl.termEndTime());

    timestamp = bound(timestamp, cl.termEndTime() + 1, cl.termEndTime() + 10000 days);
    vm.warp(timestamp);

    assertTrue(cl.isLate());
  }
}
