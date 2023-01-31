// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;
pragma experimental ABIEncoderV2;

import {ITranchedPool} from "../../../interfaces/ITranchedPool.sol";
import {ISchedule} from "../../../interfaces/ISchedule.sol";
import {CallableLoan} from "../../../protocol/core/callable/CallableLoan.sol";
import {TranchingLogic} from "../../../protocol/core/TranchingLogic.sol";
import {Accountant} from "../../../protocol/core/Accountant.sol";
import {CreditLine} from "../../../protocol/core/CreditLine.sol";
import {GoldfinchFactory} from "../../../protocol/core/GoldfinchFactory.sol";
import {GoldfinchConfig} from "../../../protocol/core/GoldfinchConfig.sol";
import {Fidu} from "../../../protocol/core/Fidu.sol";
import {LeverageRatioStrategy} from "../../../protocol/core/LeverageRatioStrategy.sol";
import {FixedLeverageRatioStrategy} from "../../../protocol/core/FixedLeverageRatioStrategy.sol";
import {WithdrawalRequestToken} from "../../../protocol/core/WithdrawalRequestToken.sol";
import {PoolTokens} from "../../../protocol/core/PoolTokens.sol";
import {BackerRewards} from "../../../rewards/BackerRewards.sol";
import {Go} from "../../../protocol/core/Go.sol";
import {ConfigOptions} from "../../../protocol/core/ConfigOptions.sol";
// solhint-disable-next-line max-line-length
import {CallableLoanImplementationRepository} from "../../../protocol/core/callable/CallableLoanImplementationRepository.sol";
import {Schedule} from "../../../protocol/core/schedule/Schedule.sol";
import {MonthlyScheduleRepo} from "../../../protocol/core/schedule/MonthlyScheduleRepo.sol";

import {CallableLoanBuilder} from "../../helpers/CallableLoanBuilder.t.sol";
import {BaseTest} from "../BaseTest.t.sol";
import {TestERC20} from "../../TestERC20.sol";
import {TestConstants} from "../TestConstants.t.sol";
import {ITestUniqueIdentity0612} from "../../ITestUniqueIdentity0612.t.sol";
import {SeniorPool} from "../../../protocol/core/SeniorPool.sol";
import {console2 as console} from "forge-std/console2.sol";

contract CallableLoanBaseTest is BaseTest {
  address public constant BORROWER = 0x228994aE78d75939A5aB9260a83bEEacBE77Ddd0; // random address
  address public constant DEPOSITOR = 0x89b8CbAeBd6C623a69a4DEBe9EE03131b5F4Ff96; // random address

  uint256 internal constant UNIT_SHARE_PRICE = 1e18;
  uint256 internal constant DEFAULT_DRAWDOWN_PERIOD_IN_SECONDS = 7 days;
  uint256 internal constant HALF_CENT = 1e6 / 200;

  GoldfinchConfig internal gfConfig;
  GoldfinchFactory internal gfFactory;
  TestERC20 internal usdc;
  Fidu internal fidu;
  LeverageRatioStrategy internal strat;
  WithdrawalRequestToken internal requestTokens;
  ITestUniqueIdentity0612 internal uid;
  CallableLoanBuilder internal callableLoanBuilder;
  PoolTokens internal poolTokens;
  Go internal go;
  SeniorPool internal seniorPool;

  function setUp() public virtual override {
    super.setUp();

    _startImpersonation(GF_OWNER);

    // GoldfinchConfig setup
    gfConfig = GoldfinchConfig(address(protocol.gfConfig()));

    // Setup gfFactory
    gfFactory = GoldfinchFactory(address(protocol.gfFactory()));

    // USDC setup
    usdc = TestERC20(address(protocol.usdc()));

    // FIDU setup
    fidu = Fidu(address(protocol.fidu()));

    // SeniorPool setup
    seniorPool = new SeniorPool();
    seniorPool.initialize(GF_OWNER, gfConfig);
    seniorPool.initializeEpochs();
    gfConfig.setAddress(uint256(ConfigOptions.Addresses.SeniorPool), address(seniorPool));
    fuzzHelper.exclude(address(seniorPool));

    fidu.grantRole(TestConstants.MINTER_ROLE, address(seniorPool));
    FixedLeverageRatioStrategy _strat = new FixedLeverageRatioStrategy();
    _strat.initialize(GF_OWNER, gfConfig);
    strat = _strat;
    gfConfig.setAddress(uint256(ConfigOptions.Addresses.SeniorPoolStrategy), address(strat));
    fuzzHelper.exclude(address(strat));

    // WithdrawalRequestToken setup
    requestTokens = new WithdrawalRequestToken();
    requestTokens.__initialize__(GF_OWNER, gfConfig);
    gfConfig.setAddress(
      uint256(ConfigOptions.Addresses.WithdrawalRequestToken),
      address(requestTokens)
    );
    fuzzHelper.exclude(address(requestTokens));

    // UniqueIdentity setup
    uid = ITestUniqueIdentity0612(deployCode("TestUniqueIdentity.sol"));
    uid.initialize(GF_OWNER, "UNIQUE-IDENTITY");
    uint256[] memory supportedUids = new uint256[](5);
    bool[] memory supportedUidValues = new bool[](5);
    for (uint256 i = 0; i < 5; ++i) {
      supportedUids[i] = i;
      supportedUidValues[i] = true;
    }
    uid.setSupportedUIDTypes(supportedUids, supportedUidValues);
    uid._mintForTest(DEPOSITOR, 1, 1, "");
    fuzzHelper.exclude(address(uid));

    // PoolTokens setup
    poolTokens = new PoolTokens();
    poolTokens.__initialize__(GF_OWNER, gfConfig);
    gfConfig.setAddress(uint256(ConfigOptions.Addresses.PoolTokens), address(poolTokens));
    fuzzHelper.exclude(address(poolTokens));

    // BackerRewards setup
    BackerRewards backerRewards = new BackerRewards();
    backerRewards.__initialize__(GF_OWNER, gfConfig);
    gfConfig.setAddress(uint256(ConfigOptions.Addresses.BackerRewards), address(backerRewards));
    fuzzHelper.exclude(address(backerRewards));

    // Go setup
    go = new Go();
    go.initialize(GF_OWNER, gfConfig, address(uid));
    gfConfig.setAddress(uint256(ConfigOptions.Addresses.Go), address(go));
    fuzzHelper.exclude(address(go));

    // CallableLoan setup
    CallableLoan callableLoanImpl = new CallableLoan();
    CallableLoanImplementationRepository callableLoanRepo = new CallableLoanImplementationRepository();
    callableLoanRepo.initialize(GF_OWNER, address(callableLoanImpl));
    gfConfig.setAddress(
      uint256(ConfigOptions.Addresses.CallableLoanImplementationRepository),
      address(callableLoanRepo)
    );
    fuzzHelper.exclude(address(callableLoanImpl));
    fuzzHelper.exclude(address(callableLoanRepo));

    // CreditLine setup
    CreditLine creditLineImpl = new CreditLine();
    gfConfig.setAddress(
      uint256(ConfigOptions.Addresses.CreditLineImplementation),
      address(creditLineImpl)
    );
    fuzzHelper.exclude(address(creditLineImpl));

    // MonthlyScheduleRepository setup
    MonthlyScheduleRepo monthlyScheduleRepo = new MonthlyScheduleRepo();
    gfConfig.setAddress(
      uint256(ConfigOptions.Addresses.MonthlyScheduleRepo),
      address(monthlyScheduleRepo)
    );
    fuzzHelper.exclude(address(monthlyScheduleRepo));
    fuzzHelper.exclude(address(monthlyScheduleRepo.periodMapper()));

    callableLoanBuilder = new CallableLoanBuilder(gfFactory, monthlyScheduleRepo);
    fuzzHelper.exclude(address(callableLoanBuilder));
    // Allow the builder to create pools
    gfFactory.grantRole(gfFactory.OWNER_ROLE(), address(callableLoanBuilder));

    // Other config numbers
    gfConfig.setNumber(uint256(ConfigOptions.Numbers.ReserveDenominator), 10); // 0.1%
    gfConfig.setNumber(
      uint256(ConfigOptions.Numbers.DrawdownPeriodInSeconds),
      DEFAULT_DRAWDOWN_PERIOD_IN_SECONDS
    );
    gfConfig.setNumber(uint256(ConfigOptions.Numbers.LeverageRatio), 4000000000000000000); // 4x leverage

    // Other stuff
    addToGoList(GF_OWNER);

    fuzzHelper.exclude(BORROWER);
    fuzzHelper.exclude(DEPOSITOR);
    fuzzHelper.exclude(address(TranchingLogic));
    fuzzHelper.exclude(address(Accountant));
    fuzzHelper.exclude(address(this));

    // Fund the depositor
    usdc.transfer(DEPOSITOR, usdcVal(1_000_000_000));

    _stopImpersonation();
  }

  function defaultCallableLoan()
    internal
    impersonating(GF_OWNER)
    returns (CallableLoan, CreditLine)
  {
    (CallableLoan callableLoan, CreditLine cl) = callableLoanBuilder.build(BORROWER);
    fuzzHelper.exclude(address(callableLoan));
    fuzzHelper.exclude(address(cl));
    (ISchedule schedule, ) = cl.schedule();
    fuzzHelper.exclude(address(schedule));
    return (callableLoan, cl);
  }

  function callableLoanWithLateFees(
    uint256 lateFeeApr,
    uint256 lateFeeGracePeriodInDays
  ) public impersonating(GF_OWNER) returns (CallableLoan, CreditLine) {
    (CallableLoan callableLoan, CreditLine cl) = callableLoanBuilder
      .withLateFeeApr(lateFeeApr)
      .build(BORROWER);
    fuzzHelper.exclude(address(callableLoan));
    fuzzHelper.exclude(address(cl));
    gfConfig.setNumber(
      uint256(ConfigOptions.Numbers.LatenessGracePeriodInDays),
      lateFeeGracePeriodInDays
    );
    return (callableLoan, cl);
  }

  function deposit(
    CallableLoan callableLoan,
    uint256 tranche,
    uint256 depositAmount,
    address depositor
  ) internal impersonating(depositor) returns (uint256) {
    uint256 balance = usdc.balanceOf(depositor);
    if (balance < depositAmount) {
      fundAddress(depositor, depositAmount - balance);
    }
    usdc.approve(address(callableLoan), depositAmount);
    return callableLoan.deposit(tranche, depositAmount);
  }

  function deposit(
    CallableLoan callableLoan,
    uint256 depositAmount,
    address depositor
  ) internal returns (uint256) {
    return deposit(callableLoan, 1, depositAmount, depositor);
  }

  function lockPoolAsBorrower(
    CallableLoan callableLoan
  ) internal impersonating(callableLoan.creditLine().borrower()) {
    console.log("Locking pool");
    callableLoan.lockPool();
  }

  function lockAndDrawdown(
    CallableLoan callableLoan,
    uint256 amount
  ) internal impersonating(callableLoan.creditLine().borrower()) {
    callableLoan.lockPool();
    callableLoan.drawdown(amount);
  }

  function pay(
    CallableLoan callableLoan,
    uint256 amount
  ) internal impersonating(callableLoan.creditLine().borrower()) {
    usdc.approve(address(callableLoan), amount);
    uint256 balance = usdc.balanceOf(callableLoan.creditLine().borrower());
    if (balance < amount) {
      fundAddress(callableLoan.creditLine().borrower(), amount - balance);
    }
    callableLoan.pay(amount);
  }

  function pay(
    CallableLoan callableLoan,
    uint256 principal,
    uint256 interest
  ) internal impersonating(callableLoan.creditLine().borrower()) {
    uint256 amount = interest + principal;
    usdc.approve(address(callableLoan), amount);
    uint256 balance = usdc.balanceOf(callableLoan.creditLine().borrower());
    if (balance < amount) {
      fundAddress(callableLoan.creditLine().borrower(), amount - balance);
    }
    callableLoan.pay(principal, interest);
  }

  function withdraw(
    CallableLoan callableLoan,
    uint256 token,
    uint256 amount,
    address withdrawer
  ) internal impersonating(withdrawer) returns (uint256, uint256) {
    return callableLoan.withdraw(token, amount);
  }

  function withdrawMax(
    CallableLoan callableLoan,
    uint256 token,
    address withdrawer
  ) internal impersonating(withdrawer) returns (uint256, uint256) {
    return callableLoan.withdrawMax(token);
  }

  function withdrawMultiple(
    CallableLoan callableLoan,
    uint256[] memory tokens,
    uint256[] memory amounts,
    address withdrawer
  ) internal impersonating(withdrawer) {
    callableLoan.withdrawMultiple(tokens, amounts);
  }

  function drawdown(
    CallableLoan callableLoan,
    uint256 amount
  ) internal impersonating(callableLoan.creditLine().borrower()) {
    callableLoan.drawdown(amount);
  }

  function setLimit(CallableLoan callableLoan, uint256 limit) internal impersonating(GF_OWNER) {
    callableLoan.setLimit(limit);
  }

  function setMaxLimit(
    CallableLoan callableLoan,
    uint256 maxLimit
  ) internal impersonating(GF_OWNER) {
    callableLoan.setMaxLimit(maxLimit);
  }

  function pause(CallableLoan callableLoan) internal impersonating(GF_OWNER) {
    callableLoan.pause();
  }

  function unpause(CallableLoan callableLoan) internal impersonating(GF_OWNER) {
    callableLoan.unpause();
  }

  function depositWithPermit(
    CallableLoan callableLoan,
    uint256 tranche,
    uint256 amount,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s,
    address user
  ) internal impersonating(user) returns (uint256) {
    uint256 balance = usdc.balanceOf(user);
    if (balance < amount) {
      fundAddress(user, amount - balance);
    }
    return callableLoan.depositWithPermit(tranche, amount, deadline, v, r, s);
  }

  function depositAndDrawdown(
    CallableLoan callableLoan,
    uint256 depositAmount
  ) internal returns (uint256 tokenId) {
    return depositAndDrawdown(callableLoan, depositAmount, DEPOSITOR);
  }

  function depositAndDrawdown(
    CallableLoan callableLoan,
    uint256 depositAmount,
    address investor
  ) internal impersonating(callableLoan.creditLine().borrower()) returns (uint256 tokenId) {
    tokenId = deposit(callableLoan, 1, depositAmount, investor);
    callableLoan.drawdown(depositAmount);
  }

  function getInterestAccrued(
    uint256 start,
    uint256 end,
    uint256 balance,
    uint256 apr
  ) internal returns (uint256) {
    uint256 secondsElapsed = end - start;
    uint256 totalInterestPerYear = (balance * apr) / (1e18);
    uint256 interest = (totalInterestPerYear * secondsElapsed) / (365 days);
    return interest;
  }

  // TODO - remove this function because it doesn't make sense with a monthly schedule
  function periodInSeconds(CallableLoan callableLoan) internal returns (uint256) {
    // return callableLoan.creditLine().nextDueTime().sub(callableLoan.creditLine().previousDueTime());
    return 30 days;
  }

  function addToGoList(address user) internal impersonating(GF_OWNER) {
    gfConfig.addToGoList(user);
  }
}
