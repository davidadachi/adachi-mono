// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import {ICreditLine} from "../../../interfaces/ICreditLine.sol";
import {ISchedule} from "../../../interfaces/ISchedule.sol";
import {ITranchedPool} from "../../../interfaces/ITranchedPool.sol";
import {IPeriodMapper} from "../../../interfaces/IPeriodMapper.sol";
import {ISchedule} from "../../../interfaces/ISchedule.sol";
import {CallableLoanBaseTest} from "./BaseCallableLoan.t.sol";
import {CallableLoan} from "../../../protocol/core/callable/CallableLoan.sol";

contract CallableLoanInitializationTest is CallableLoanBaseTest {
  function testInitializationGrantsProperRoles() public {
    (CallableLoan callableLoan, ) = defaultCallableLoan();
    assertTrue(callableLoan.hasRole(callableLoan.LOCKER_ROLE(), GF_OWNER));
    assertTrue(callableLoan.hasRole(callableLoan.LOCKER_ROLE(), BORROWER));
  }

  function testInitializationCantHappenTwice() public {
    (CallableLoan callableLoan, ) = defaultCallableLoan();
    uint256[] memory uidTypes = new uint256[](1);
    ISchedule s = defaultSchedule();
    vm.expectRevert("Contract instance has already been initialized");
    callableLoan.initialize(address(gfConfig), BORROWER, 0, 0, s, 0, block.timestamp, uidTypes);
  }

  function testCreditLineCannotBeReinitialized() public {
    (, ICreditLine cl) = defaultCallableLoan();

    ISchedule s = defaultSchedule();
    vm.expectRevert("Contract instance has already been initialized");
    cl.initialize(address(gfConfig), GF_OWNER, BORROWER, 0, 0, s, 0);
  }

  function testGetAmountsOwedFailedForUninitializedCreditLine() public {
    (CallableLoan callableLoan, ) = defaultCallableLoan();
    vm.expectRevert(bytes("LI"));
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
    uint periodsInTerm,
    uint periodsPerPrincipalPeriod,
    uint periodsPerInterestPeriod,
    uint gracePrincipalPeriods
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
