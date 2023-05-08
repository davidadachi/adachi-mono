// SPDX-License-Identifier: MIT

pragma solidity ^0.8.19;

import {ICreditLine} from "../../../interfaces/ICreditLine.sol";
import {ISchedule} from "../../../interfaces/ISchedule.sol";
import {ITranchedPool} from "../../../interfaces/ITranchedPool.sol";
import {IPeriodMapper} from "../../../interfaces/IPeriodMapper.sol";
import {ISchedule} from "../../../interfaces/ISchedule.sol";
import {ICallableLoanErrors} from "../../../interfaces/ICallableLoanErrors.sol";
import {CallableLoanBaseTest} from "./BaseCallableLoan.t.sol";
import {CallableLoanBuilder} from "../../helpers/CallableLoanBuilder.t.sol";

import {CallableLoan} from "../../../protocol/core/callable/CallableLoan.sol";

contract CallableLoanInitializationTest is CallableLoanBaseTest {
  function testInitializationPausesDrawdowns(uint256 drawdownAmount, uint256 randomJump) public {
    (CallableLoan callableLoan, ICreditLine cl) = callableLoanBuilder.build(BORROWER);
    assertTrue(callableLoan.drawdownsPaused());
    _startImpersonation(BORROWER);
    uint256[] memory allowedTypes = new uint256[](1);
    allowedTypes[0] = 0; // legacy UID type
    callableLoan.setAllowedUIDTypes(allowedTypes);
    _stopImpersonation();
    addToGoList(DEPOSITOR);
    _startImpersonation(DEPOSITOR);
    usdc.approve(address(callableLoan), type(uint256).max);
    uint256 poolToken = callableLoan.deposit(3, usdcVal(10));
    _stopImpersonation();

    _startImpersonation(BORROWER);

    randomJump = bound(randomJump, block.timestamp, block.timestamp + 1000 days);
    vm.warp(randomJump);
    vm.expectRevert(
      abi.encodeWithSelector(ICallableLoanErrors.CannotDrawdownWhenDrawdownsPaused.selector)
    );
    callableLoan.drawdown(drawdownAmount);
  }

  function testInitializationGrantsProperRoles() public {
    (CallableLoan callableLoan, ) = defaultCallableLoan();
    assertTrue(callableLoan.hasRole(callableLoan.LOCKER_ROLE(), GF_OWNER));
    assertTrue(callableLoan.hasRole(callableLoan.LOCKER_ROLE(), BORROWER));
  }

  function testCannotInitializeInvalidNumLockupPeriods() public {
    CallableLoanBuilder clb = callableLoanBuilder.withNumLockupPeriods(4);
    vm.expectRevert(
      abi.encodeWithSelector(ICallableLoanErrors.InvalidNumLockupPeriods.selector, 4, 3)
    );
    (CallableLoan callableLoan, ) = clb.build(BORROWER);
  }

  function testInitializationCantHappenTwice() public {
    (CallableLoan callableLoan, ) = defaultCallableLoan();
    uint256[] memory uidTypes = new uint256[](1);
    ISchedule s = defaultSchedule();
    vm.expectRevert("Initializable: contract is already initialized");
    callableLoan.initialize(gfConfig, BORROWER, 0, 0, 2, s, 0, block.timestamp, uidTypes);
  }

  function testGetAmountsOwedFailedForUndrawndownLoan() public {
    (CallableLoan callableLoan, ) = defaultCallableLoan();
    vm.expectRevert();
    callableLoan.getAmountsOwed(block.timestamp);
  }

  function defaultSchedule() public returns (ISchedule) {
    return
      createMonthlySchedule({
        periodsInTerm: 12,
        periodsPerInterestPeriod: 1,
        periodsPerPrincipalPeriod: 12,
        gracePrincipalPeriods: 0
      });
  }

  function createMonthlySchedule(
    uint256 periodsInTerm,
    uint256 periodsPerPrincipalPeriod,
    uint256 periodsPerInterestPeriod,
    uint256 gracePrincipalPeriods
  ) public returns (ISchedule) {
    IPeriodMapper pm = IPeriodMapper(deployCode("MonthlyPeriodMapper.sol"));
    return
      ISchedule(
        deployCode(
          "Schedule.sol",
          abi.encode(
            pm,
            periodsInTerm,
            periodsPerInterestPeriod,
            periodsPerPrincipalPeriod,
            gracePrincipalPeriods
          )
        )
      );
  }
}
