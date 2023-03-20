// SPDX-License-Identifier: MIT
// solhint-disable func-name-mixedcase
// solhint-disable reentrancy
// solhint-disable contract-name-camelcase

pragma solidity ^0.8.0;

import {CallableLoan} from "../../../../protocol/core/callable/CallableLoan.sol";
import {ICreditLine} from "../../../../interfaces/ICreditLine.sol";
import {ICallableLoan, LoanPhase} from "../../../../interfaces/ICallableLoan.sol";
import {ICallableLoanErrors} from "../../../../interfaces/ICallableLoanErrors.sol";
import {IMonthlyScheduleRepo} from "../../../../interfaces/IMonthlyScheduleRepo.sol";
import {ConfigOptions} from "../../../../protocol/core/ConfigOptions.sol";
import {CallableLoanBuilder} from "../../../helpers/CallableLoanBuilder.t.sol";
import {IGoldfinchFactory} from "../../../../interfaces/IGoldfinchFactory.sol";
import {IGoldfinchConfig} from "../../../../interfaces/IGoldfinchConfig.sol";
import {ITestUSDC} from "../../../ITestUSDC.t.sol";

import {CallableLoanBaseTest} from "../BaseCallableLoan.t.sol";

contract CallableBorrower {
  ICallableLoan private loan;
  ITestUSDC internal usdc;

  function pay(uint256 amount) external {
    usdc.approve(address(loan), amount);
    loan.pay(amount);

    // assert usdc balance change
  }

  function drawdown(uint256 amount) external {
    loan.drawdown(amount);

    // assert USDC balance change
  }

  function setLoan(ICallableLoan _loan) external {
    loan = _loan;
  }

  function setUSDC(ITestUSDC _usdc) external {
    usdc = _usdc;
  }
}

contract CallableLender {
  ICallableLoan private loan;
  ITestUSDC internal usdc;

  uint256 public tokenId;
  uint256 public callRequestTokenId;

  function submitCall(uint256 amount) external {
    (uint256 _callRequestTokenId, ) = loan.submitCall(amount, tokenId);

    callRequestTokenId = _callRequestTokenId;
  }

  function deposit(uint256 amount) external {
    usdc.approve(address(loan), amount);
    tokenId = loan.deposit(loan.uncalledCapitalTrancheIndex(), amount);

    // assert usdc balance change
    // assert we got the nft
  }

  function withdraw(uint256 amount) external {
    loan.withdraw(callRequestTokenId, amount);

    // assert usdc balance change
  }

  function setLoan(ICallableLoan _loan) external {
    loan = _loan;
  }

  function setUSDC(ITestUSDC _usdc) external {
    usdc = _usdc;
  }
}

contract CallableLoanz_OneLender_OneBorrower_Test is CallableLoanBaseTest {
  CallableBorrower private borrower;
  CallableLender private lender;
  ICallableLoan private loan;

  function setUp() public virtual override {
    super.setUp();

    borrower = new CallableBorrower();
    lender = new CallableLender();

    _startImpersonation(GF_OWNER);
    gfConfig.addToGoList(address(borrower));
    gfConfig.addToGoList(address(lender));

    usdc.transfer(address(borrower), usdcVal(1_000_000_000));
    usdc.transfer(address(lender), usdcVal(1_000_000_000));

    _stopImpersonation();

    (CallableLoan _loan, ) = callableLoanBuilder.build(address(borrower));

    lender.setLoan(_loan);
    lender.setUSDC(usdc);
    borrower.setLoan(_loan);
    borrower.setUSDC(usdc);

    loan = _loan;
  }

  function test_depositThenWithdraw() public {
    lender.deposit(100);

    skip(1);

    lender.withdraw(10);
  }

  function test_nothingToDrawdown() public {
    vm.expectRevert(
      abi.encodeWithSelector(ICallableLoanErrors.DrawdownAmountExceedsDeposits.selector, 5, 0)
    );
    borrower.drawdown(5);
  }

  function test_overDrawdown() public {
    lender.deposit(2);

    /* Can't drawdown more */ {
      vm.expectRevert(
        abi.encodeWithSelector(ICallableLoanErrors.DrawdownAmountExceedsDeposits.selector, 3, 2)
      );
      borrower.drawdown(3);
    }

    borrower.drawdown(2);

    /* Can't drawdown more */ {
      vm.expectRevert(
        abi.encodeWithSelector(ICallableLoanErrors.DrawdownAmountExceedsDeposits.selector, 1, 0)
      );
      borrower.drawdown(1);
    }
  }

  function test_availableToWithdraw() public {
    lender.deposit(10);
    borrower.drawdown(10);

    /* Fast forward past drawdown period */ {
      while (loan.loanPhase() == LoanPhase.DrawdownPeriod) {
        skip(60 * 60 * 24);
      }
      assertTrue(loan.loanPhase() == LoanPhase.InProgress);
    }

    lender.submitCall(10);
    borrower.pay(10);

    loan.availableToCall(1);
  }

  function test_basicFlow() public {
    /* Deposit into loan */ {
      lender.deposit(100);
      assertTrue(loan.loanPhase() == LoanPhase.Funding);
    }

    /* Partial drawdown */ {
      skip(1);

      borrower.drawdown(95);
      assertTrue(loan.loanPhase() == LoanPhase.DrawdownPeriod);
    }

    /* Can't deposit more */ {
      vm.expectRevert();
      lender.deposit(10);
    }

    /* Drawdown the rest */ {
      skip(1);

      borrower.drawdown(5);
      assertTrue(loan.loanPhase() == LoanPhase.DrawdownPeriod);
    }

    /* Can't drawdown more */ {
      vm.expectRevert();
      borrower.drawdown(1);
    }

    /* Can't deposit more */ {
      vm.expectRevert();
      lender.deposit(10);
    }

    /* Fast forward past drawdown period */ {
      while (loan.loanPhase() == LoanPhase.DrawdownPeriod) {
        skip(60 * 60 * 24);
      }
      assertTrue(loan.loanPhase() == LoanPhase.InProgress);
    }

    /* Immediately submit a call */ {
      lender.submitCall(10);
    }

    /* Pay back call + interest */ {
      skip(1);

      borrower.pay(10 + loan.estimateOwedInterestAt(loan.nextDueTimeAt(block.timestamp)));
    }

    /* Fast forward to just before repayment due date */ {
      vm.warp(loan.nextDueTimeAt(block.timestamp) - 1);
    }

    /* Can't yet claim call */ {
      vm.expectRevert();
      lender.withdraw(10);
    }

    /* Now go to repayment date */ {
      vm.warp(loan.nextDueTimeAt(block.timestamp));
    }

    /* Claim call */ {
      lender.withdraw(10);
    }
  }
}
