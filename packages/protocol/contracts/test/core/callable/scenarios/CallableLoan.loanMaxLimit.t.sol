pragma solidity ^0.8.0;

import {CallableLoanBaseTest} from "../BaseCallableLoan.t.sol";
import {CallableLoan} from "../../../../protocol/core/callable/CallableLoan.sol";
import {ICallableLoanErrors} from "../../../../interfaces/ICallableLoanErrors.sol";
// solhint-disable-next-line max-line-length
import {IERC1155ReceiverUpgradeable} from "@openzeppelin/contracts-upgradeable/interfaces/IERC1155ReceiverUpgradeable.sol";

contract CallableLoanLoanReachesMaxLimitScenarioTest is CallableLoanBaseTest {
  CallableLoan private loan;

  /*
  1. Add deposits until the loan reaches its limit
  2. Verify it rejects deposits that exceed the limit
  3. Have users withdraw so we're under the limit again
  4. Verify the loan accepts deposits again up to the limit 
  */
  function testScenarioWhereLoanReachesMaxLimit(
    address user1,
    address user2,
    uint256 depositAmount1,
    uint256 depositAmount3,
    uint256 withdrawalAmount1
  ) public {
    vm.assume(fuzzHelper.isAllowed(user1));
    vm.assume(fuzzHelper.isAllowed(user2));

    uint256 maxLimit = usdcVal(10_000_000);
    (loan, ) = callableLoanWithLimit(usdcVal(10_000_000));

    // Max sure first deposit amount is under the limit. Set the second
    // deposit amount such that they sum to the limit.
    depositAmount1 = bound(depositAmount1, usdcVal(1), usdcVal(9_999_999));
    uint256 depositAmount2 = usdcVal(10_000_000) - depositAmount1;

    uid._mintForTest(user1, 1, 1, "");
    uid._mintForTest(user2, 1, 1, "");
    // User3 is the test contract
    uid._mintForTest(address(this), 1, 1, "");

    // First two depositors get the pool up to the limit
    uint256 token1 = deposit(loan, depositAmount1, user1);
    uint256 token2 = deposit(loan, depositAmount2, user2);

    // The third depositor tries to deposit over the limit. We expect it to fail
    fundAddress(address(this), usdcVal(1));
    uint256 tranche = loan.uncalledCapitalTrancheIndex();
    vm.expectRevert(
      abi.encodeWithSelector(
        ICallableLoanErrors.DepositExceedsLimit.selector,
        usdcVal(1),
        usdcVal(10_000_000),
        usdcVal(10_000_000)
      )
    );
    loan.deposit(tranche, usdcVal(1));

    // The first depositor pulls some money out
    withdrawalAmount1 = bound(withdrawalAmount1, usdcVal(1), depositAmount1);
    withdraw(loan, token1, withdrawalAmount1, user1);

    // Now the smart contract should be able to put money in up to the limit
    depositAmount3 = bound(depositAmount3, usdcVal(1), withdrawalAmount1);
    uint256 token3 = deposit(loan, depositAmount3, address(this));

    // Check user1
    (uint256 interest, uint256 principal) = loan.availableToWithdraw(token1);
    assertZero(interest);
    assertEq(principal, depositAmount1 - withdrawalAmount1);

    // Check user2
    (interest, principal) = loan.availableToWithdraw(token2);
    assertZero(interest);
    assertEq(principal, depositAmount2);

    // Check user3
    (interest, principal) = loan.availableToWithdraw(token3);
    assertZero(interest);
    assertEq(principal, depositAmount3);
  }

  // Implement this so the test contract can receive a UID
  function onERC1155Received(
    address,
    address,
    uint256,
    uint256,
    bytes memory
  ) external pure returns (bytes4) {
    return IERC1155ReceiverUpgradeable.onERC1155Received.selector;
  }
}
