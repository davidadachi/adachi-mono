// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;
pragma experimental ABIEncoderV2;


import "forge-std/Test.sol";
import {Waterfall, WaterfallLogic, Tranche, TrancheLogic} from "../../../../protocol/core/callable/structs/Waterfall.sol";

using WaterfallLogic for Waterfall;
using TrancheLogic for Tranche;

contract TestWaterfall is Test {
  
  Waterfall internal w;
  
  function setUp() external {
    w.initialize(4);
  }

  function testDepositAddsPrincipalToTranche(
    uint amount
  ) external {
    uint trancheId;
    trancheId = bound(trancheId, 0, w.numTranches());
    Tranche storage trancheBefore = w.getTranche(trancheId);
    assertTrue(trancheBefore.principalDeposited() == 0);
    assertTrue(trancheBefore.principalPaid() == 0);
    assertTrue(trancheBefore.interestPaid() == 0);

    w.deposit(trancheId, amount);
  
    for (uint i = 0; i < w.numTranches(); i++) {
      Tranche storage sampled = w.getTranche(i);
      // if its the tranche that we deposited into
      bool isTrancheWeDepositedInto = i == trancheId;
      assertEq(sampled.principalDeposited(), isTrancheWeDepositedInto ? amount : 0);
      assertEq(sampled.interestPaid(), 0);
      assertEq(sampled.principalPaid(), 0);
    }
  }

  /*
  depositing and withdrawal
    - depositing adds to principal in the specified tranche. No other tranches
      are modified
    - depositing when theres been interest paid should revert
  
  moving principal behavior
    - cant move more principal than exists in a tranche
    - moving principal moves proportional amount of interest

  paying
    - updates principal outstanding correctly
    - distributes interest payment proportionally to principal outstanding
    - pays tranche principal in order
    - updates totalPrincipalOutstanding with principalPaid

  cumulativeRedeemableAmount



  */

}