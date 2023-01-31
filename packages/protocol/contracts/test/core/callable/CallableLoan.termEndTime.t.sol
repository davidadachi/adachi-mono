// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;
pragma experimental ABIEncoderV2;

import {CallableLoan} from "../../../protocol/core/callable/CallableLoan.sol";
import {CreditLine} from "../../../protocol/core/CreditLine.sol";

import {CallableLoanBaseTest} from "./BaseCallableLoan.t.sol";

contract CallableLoanTermEndTimeTest is CallableLoanBaseTest {
  function testTermEndTimeIsSetOnFirstDrawdown(uint256 amount) public {
    (CallableLoan callableLoan, CreditLine cl) = defaultCallableLoan();
    amount = bound(amount, usdcVal(1), usdcVal(10_000_000));
    setMaxLimit(callableLoan, amount * 5);

    assertZero(cl.termEndTime());
    depositAndDrawdown(callableLoan, amount, GF_OWNER);
    // This is >= because of the creation of the stub period
    assertGe(cl.termEndTime(), block.timestamp + termInSeconds(cl));
  }

  // TODO - bug when you drawdown multiple times!
  function testTermEndTimeDoesNotChangeOnSubsequentDrawdown(uint256 drawdownAmount) public {
    (CallableLoan callableLoan, CreditLine cl) = defaultCallableLoan();
    drawdownAmount = bound(drawdownAmount, usdcVal(2), usdcVal(10_000_000));
    setMaxLimit(callableLoan, drawdownAmount * 2);

    deposit(callableLoan, 1, drawdownAmount * 2, DEPOSITOR);
    lockPoolAsBorrower(callableLoan);

    drawdown(callableLoan, drawdownAmount);
    uint256 termEndTimeBefore = cl.termEndTime();
    drawdown(callableLoan, drawdownAmount);
    assertEq(cl.termEndTime(), termEndTimeBefore);
  }

  function termInSeconds(CreditLine cl) internal returns (uint256) {
    return cl.termEndTime() - cl.termStartTime();
  }
}
