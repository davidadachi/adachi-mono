// SPDX-License-Identifier: MIT

pragma solidity ^0.8.18;

import {Test} from "forge-std/Test.sol";
import {CallableLoanActorInfo, CallableLoanActorSet, CallableLoanActorSetLib} from "./CallableLoanActor.t.sol";
import {InvariantTest} from "forge-std/InvariantTest.sol";
import {CallableLoanBaseTest} from "../BaseCallableLoan.t.sol";
import {CallableLoan} from "../../../../protocol/core/callable/CallableLoan.sol";
import {IERC20} from "../../../../interfaces/IERC20.sol";
import {ITestUniqueIdentity0612} from "../../../ITestUniqueIdentity0612.t.sol";

contract CallableLoanFundingHandler is Test {
  using CallableLoanActorSetLib for CallableLoanActorSet;

  CallableLoan public loan;
  uint256 private sumDeposited;
  uint256 private sumWithdrawn;
  uint256 public numDeposits;

  IERC20 private usdc;
  ITestUniqueIdentity0612 private uid;
  CallableLoanActorSet private actorSet;
  address private currentActor;

  constructor(CallableLoan _loan, IERC20 _usdc, ITestUniqueIdentity0612 _uid) {
    loan = _loan;
    usdc = _usdc;
    uid = _uid;
  }

  function warp() public {
    skip(1 days);
  }

  function deposit(uint256 amount) public createActor {
    uint256 totalPrincipalDeposited = sumDeposited - sumWithdrawn;
    uint256 maxDepositAmount = loan.limit() - totalPrincipalDeposited;

    if (maxDepositAmount == 0) {
      // Loan is full - return!
      return;
    }

    amount = bound(amount, 1, maxDepositAmount);

    vm.startPrank(currentActor);
    uint256 tokenId = loan.deposit(loan.uncalledCapitalTrancheIndex(), amount);
    vm.stopPrank();

    sumDeposited += amount;
    numDeposits += 1;
    actorSet.actorInfo[currentActor].tokens.push(tokenId);
  }

  function withdraw(uint256 amount, uint256 actorIndex, uint256 poolTokenIndex) public createActor {
    if (actorSet.count() == 0) {
      // No deposits - return!
      return;
    }

    // Select a random actor that has already deposited to perform the withdraw
    actorIndex = bound(actorIndex, 0, actorSet.count() - 1);
    address actor = actorSet.actors[actorIndex];

    // Select a random pool token to withdraw from
    uint256 poolTokenIndex = bound(poolTokenIndex, 0, actorSet.actorInfo[actor].tokens.length - 1);
    uint256 tokenId = actorSet.actorInfo[actor].tokens[poolTokenIndex];

    (, uint256 principalRedeemable) = loan.availableToWithdraw(tokenId);

    if (principalRedeemable == 0) {
      // This token is fully redeemed already - return!
      return;
    }

    amount = bound(amount, 1, principalRedeemable);

    vm.startPrank(currentActor);
    loan.withdraw(tokenId, amount);
    vm.stopPrank();

    sumWithdrawn += amount;
  }

  /// @notice Reduce across the active actors
  function reduceActors(
    uint256 acc,
    function(uint256 acc,address actor,CallableLoanActorInfo memory info) external returns (uint256)  fn
  ) public returns (uint256) {
    return actorSet.reduce(acc, fn);
  }

  /// @notice Run a function on every active actor
  function forEachActor(
    function(address actor, CallableLoanActorInfo memory info) external fn
  ) public {
    return actorSet.forEach(fn);
  }

  function setUpActor(address actor) private {
    uid._mintForTest(msg.sender, 1, 1, "");
    usdc.transfer(msg.sender, loan.limit());
    vm.prank(msg.sender);
    usdc.approve(address(loan), type(uint256).max);
    actorSet.add(msg.sender);
  }

  modifier createActor {
    // If this is the first time we're seeing this actor then apply set up to it
    if (!actorSet.contains(msg.sender))
      setUpActor(msg.sender);

    currentActor = msg.sender;
    _;
  }
}

contract CallableLoanRandoHandler is Test {
  CallableLoan public loan;

  constructor(CallableLoan _loan) {
    vm.prank(msg.sender);
    loan = _loan;
    vm.stopPrank();
  }

  function drawdown(uint256 amount) public {
    vm.prank(msg.sender);
    loan.drawdown(amount);
    vm.stopPrank();
  }

  function submitCall(uint256 amount, uint256 poolTokenId) public {
    vm.prank(msg.sender);
    loan.submitCall(amount, poolTokenId);
    vm.stopPrank();
  }

  function pay(uint256 amount) public {
    vm.prank(msg.sender);
    loan.pay(amount);
    vm.stopPrank();
  }
}

contract CallableLoanFundingMultiUserInvariantTest is CallableLoanBaseTest, InvariantTest {
  CallableLoanFundingHandler private handler;
  CallableLoanRandoHandler private randoHandler;

  function setUp() public override {
    super.setUp();

    (CallableLoan loan, ) = defaultCallableLoan();
    handler = new CallableLoanFundingHandler(loan, usdc, uid);
    randoHandler = new CallableLoanRandoHandler(loan);

    // Add enough USDC to the handler that it can fund each depositor up to the loan limit
    fundAddress(address(handler), loan.limit() * 1e18);

    targetContract(address(handler));
    bytes4[] memory selectors = new bytes4[](3);
    selectors[0] = handler.deposit.selector;
    selectors[1] = handler.withdraw.selector;
    selectors[2] = handler.warp.selector;

    bytes4[] memory randomSelectors = new bytes4[](3);
    randomSelectors[0] = randoHandler.drawdown.selector;
    randomSelectors[1] = randoHandler.submitCall.selector;
    randomSelectors[2] = randoHandler.pay.selector;

    targetArtifact("UcuProxy");
    targetSelector(FuzzSelector(address(handler), selectors));
    targetSelector(FuzzSelector(address(randoHandler), randomSelectors));

  }

  // PoolTokens TokenInfo invariants

  function invariant_totalPrincipalWithdrawableIsTotalPoolTokenPrincipalAmounts() public {
    uint256 totalPrincipalWithdrawable = handler.reduceActors(0, this.principalWithdrawableReducer);
    uint256 totalPoolTokenInfoPrincipalAmounts = handler.reduceActors(0, this.poolTokenPrincipalAmountReducer);
    assertEq(totalPrincipalWithdrawable, totalPoolTokenInfoPrincipalAmounts);
  }

  function invariant_PoolTokenPrincipalAndInterestRedeemedIsZero() public {
    handler.forEachActor(this.assertPoolTokenInfoPrincipalAndInterestRedeemedIsZero);
  }

  function invariant_PoolTokenPoolIsCallableLoan() public {
    handler.forEachActor(this.assertPoolTokenInfoPoolIsCallableLoan);
  }

  function invariant_PoolTokenTrancheIsUncalledCapitalTranche() public {
    handler.forEachActor(this.assertPoolTokenInfoTrancheIsUncalledCapitalTranche);
  }

  function assertPoolTokenInfoPrincipalAndInterestRedeemedIsZero(address actor, CallableLoanActorInfo memory info) external {
    for (uint i = 0; i < info.tokens.length; ++i)  {
      assertZero(poolTokens.getTokenInfo(info.tokens[i]).principalRedeemed);
      assertZero(poolTokens.getTokenInfo(info.tokens[i]).interestRedeemed);
    }
  }

  function assertPoolTokenInfoPoolIsCallableLoan(address actor, CallableLoanActorInfo memory info) external {
    for (uint i = 0; i < info.tokens.length; ++i)  {
      assertEq(poolTokens.getTokenInfo(info.tokens[i]).pool, address(handler.loan()));
    }
  }

  function assertPoolTokenInfoTrancheIsUncalledCapitalTranche(address actor, CallableLoanActorInfo memory info) external {
    for (uint i = 0; i < info.tokens.length; ++i)  {
      assertEq(poolTokens.getTokenInfo(info.tokens[i]).tranche, handler.loan().uncalledCapitalTrancheIndex());
    }
  }

    // Mostly to debug issues where pool tokens do not match deposits due to test setup issues.
  function assertPoolTokenCountMatchesDeposits() public {
    assertEq(handler.numDeposits(), handler.reduceActors(0, this.numPoolTokensReducer));
  }

  // PoolTokens PoolInfo invariants

  function invariant_PoolTokensPoolInfoTotalMintedIsSumOfPrincipalWithdrawable() public {
    assertEq(
      poolTokens.getPoolInfo(address(handler.loan())).totalMinted,
      handler.reduceActors(0, this.poolTokenPrincipalAmountReducer)
    );
  }

  function invariant_PoolTokensPoolInfoTotalPrincipalRedeemedIsZero() public {
    assertZero(poolTokens.getPoolInfo(address(handler.loan())).totalPrincipalRedeemed);
  }

  // UncalledCapitalInfo invariants

  function invariant_UncalledCapitalInfoPrincipalDepositedIsSumOfPrincipalWithdrawable() public {
    uint256 totalPrincipalWithdrawable = handler.reduceActors(0, this.principalWithdrawableReducer);
    assertEq(
      handler.loan().getUncalledCapitalInfo().principalDeposited,
      totalPrincipalWithdrawable
    );
  }

  function invariant_UncalledCapitalInfoPrincipalPaidIsSumOfPrincipalWithdrawable() public {
    uint256 totalPrincipalWithdrawable = handler.reduceActors(0, this.principalWithdrawableReducer);
    assertEq(
      handler.loan().getUncalledCapitalInfo().principalPaid,
      totalPrincipalWithdrawable
    );
  }

  function invariant_UncalledCapitalInfoPrincipalReservedIsZero() public {
    assertZero(handler.loan().getUncalledCapitalInfo().principalReserved);
  }

  function invariant_UncalledCapitalInfoInterestPaidIsZero() public {
    assertZero(handler.loan().getUncalledCapitalInfo().interestPaid);
  }

  function principalWithdrawableReducer(
    uint256 principalWithdrawableAcc,
    address actor,
    CallableLoanActorInfo memory info
  ) external view returns (uint256) {
    for (uint i = 0; i < info.tokens.length; ++i) {
      (, uint256 principalRedeemable) = handler.loan().availableToWithdraw(info.tokens[i]);
      principalWithdrawableAcc += principalRedeemable;
    }
    return principalWithdrawableAcc;
  }

  function poolTokenPrincipalAmountReducer(
    uint256 principalAmountAcc,
    address actor,
    CallableLoanActorInfo memory info
  ) external view returns (uint256) {
    for (uint i = 0; i < info.tokens.length; ++i) {
      principalAmountAcc += poolTokens.getTokenInfo(info.tokens[i]).principalAmount;
    }
    return principalAmountAcc;
  }

  function numPoolTokensReducer(
    uint256 numPoolTokensAcc,
    address actor,
    CallableLoanActorInfo memory info
  ) external view returns (uint256) {
    return numPoolTokensAcc + info.tokens.length;
  }
}
