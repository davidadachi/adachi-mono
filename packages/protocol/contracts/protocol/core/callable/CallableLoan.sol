// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;
pragma experimental ABIEncoderV2;

// solhint-disable-next-line max-line-length
import {IERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-IERC20PermitUpgradeable.sol";
// solhint-disable-next-line max-line-length
import {SafeERC20Upgradeable as SafeERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import {ICallableLoan} from "../../../interfaces/ICallableLoan.sol";
import {ILoan} from "../../../interfaces/ILoan.sol";
import {IRequiresUID} from "../../../interfaces/IRequiresUID.sol";
import {IERC20UpgradeableWithDec} from "../../../interfaces/IERC20UpgradeableWithDec.sol";
import {ICreditLine} from "../../../interfaces/ICreditLine.sol";
import {IPoolTokens} from "../../../interfaces/IPoolTokens.sol";
import {IVersioned} from "../../../interfaces/IVersioned.sol";
import {ISchedule} from "../../../interfaces/ISchedule.sol";
import {IGoldfinchConfig} from "../../../interfaces/IGoldfinchConfig.sol";
import {CallableLoanConfigHelper} from "./CallableLoanConfigHelper.sol";
import {Waterfall, Tranche, WaterfallLogic, TrancheLogic} from "./structs/Waterfall.sol";
// solhint-disable-next-line max-line-length
import {CallableCreditLine, CallableCreditLineLogic, StaleCallableCreditLine, StaleCallableCreditLineLogic, WaterfallLogic, TrancheLogic} from "./structs/CallableCreditLine.sol";
import {BaseUpgradeablePausable} from "../BaseUpgradeablePausable08x.sol";
import {SaturatingSub} from "../../../library/SaturatingSub.sol";
import {PaymentSchedule, PaymentScheduleLogic} from "../schedule/PaymentSchedule.sol";

/// @title The main contract to faciliate lending. Backers and the Senior Pool fund the loan
///   through this contract. The borrower draws down on and pays back a loan through this contract.
/// @author Warbler Labs
contract CallableLoan is
  BaseUpgradeablePausable,
  ICallableLoan,
  ICreditLine,
  IRequiresUID,
  IVersioned
{
  IGoldfinchConfig public config;

  using CallableLoanConfigHelper for IGoldfinchConfig;
  using SafeERC20 for IERC20UpgradeableWithDec;
  using SaturatingSub for uint256;

  bytes32 public constant LOCKER_ROLE = keccak256("LOCKER_ROLE");
  uint8 internal constant MAJOR_VERSION = 1;
  uint8 internal constant MINOR_VERSION = 0;
  uint8 internal constant PATCH_VERSION = 0;

  StaleCallableCreditLine private _staleCreditLine;

  uint256 public override startTime;
  uint256 public override createdAt;
  address public override borrower;
  bool public drawdownsPaused;
  uint256[] public allowedUIDTypes;
  uint256 public totalDeployed;
  uint256 public fundableAt;
  bool public locked;

  /*
   * Unsupported - only included for compatibility with ICreditLine.
   */
  function initialize(
    address _config,
    address owner,
    address _borrower,
    uint256 _limit,
    uint256 _interestApr,
    ISchedule _schedule,
    uint256 _lateFeeApr
  ) external override initializer {
    revert("US");
  }

  // Pass 1
  function initialize(
    address _config,
    address _borrower,
    uint256 _limit,
    uint256 _interestApr,
    ISchedule _schedule,
    uint256 _lateFeeApr,
    uint256 _fundableAt,
    uint256[] calldata _allowedUIDTypes
  ) public initializer {
    require(address(_config) != address(0) && address(_borrower) != address(0), "ZERO");

    config = IGoldfinchConfig(_config);
    address owner = config.protocolAdminAddress();
    __BaseUpgradeablePausable__init(owner);
    _staleCreditLine.initialize(config, _interestApr, _schedule, _lateFeeApr, _limit);
    borrower = _borrower;
    createdAt = block.timestamp;
    if (_allowedUIDTypes.length == 0) {
      uint256[1] memory defaultAllowedUIDTypes = [config.getGo().ID_TYPE_0()];
      allowedUIDTypes = defaultAllowedUIDTypes;
    } else {
      allowedUIDTypes = _allowedUIDTypes;
    }

    _setupRole(LOCKER_ROLE, _borrower);
    _setupRole(LOCKER_ROLE, owner);
    _setRoleAdmin(LOCKER_ROLE, OWNER_ROLE);
  }

  // Pass 1
  function submitCall(uint256 callAmount, uint256 poolTokenId) external override {
    CallableCreditLine storage cl = _staleCreditLine.checkpoint();
    IPoolTokens poolTokens = config.getPoolTokens();
    IPoolTokens.TokenInfo memory tokenInfo = poolTokens.getTokenInfo(poolTokenId);
    require(
      poolTokens.isApprovedOrOwner(msg.sender, poolTokenId) &&
        hasAllowedUID(msg.sender) &&
        tokenInfo.tranche == cl.uncalledCapitalTrancheIndex(),
      "NA"
    );

    (uint256 interestWithdrawn, uint256 principalWithdrawn) = withdrawMax(poolTokenId);
    uint256 totalWithdrawn = interestWithdrawn + principalWithdrawn;
    uint256 principalRemaining = cl.principalRemaining({
      trancheId: tokenInfo.tranche,
      principalAmount: tokenInfo.principalAmount
    });
    require(callAmount > 0 && principalRemaining >= callAmount, "IA");

    // TODO: Use real PoolToken splitting from main && move callRequestedTokenId to the other tranche.
    (uint256 callRequestedTokenId, uint256 remainingTokenId) = _splitForCall(
      callAmount,
      poolTokenId,
      cl.uncalledCapitalTrancheIndex(),
      cl.activeCallSubmissionTranche()
    );
    cl.submitCall(callAmount);
    if (totalWithdrawn > 0) {
      IERC20UpgradeableWithDec usdc = config.getUSDC();
      usdc.safeTransferFrom(address(this), msg.sender, totalWithdrawn);
    }
    emit CallRequestSubmitted(poolTokenId, callRequestedTokenId, remainingTokenId, callAmount);
  }

  // Pass 1
  function _splitForCall(
    uint256 callAmount,
    uint256 poolTokenId,
    uint256 uncalledCapitalTrancheIndex,
    uint256 activeCallSubmissionTranche
  ) private returns (uint256 specifiedTokenId, uint256 remainingTokenId) {
    IPoolTokens poolToken = config.getPoolTokens();
    address owner = poolToken.ownerOf(poolTokenId);
    IPoolTokens.TokenInfo memory tokenInfo = poolToken.getTokenInfo(poolTokenId);
    poolToken.burn(poolTokenId);
    specifiedTokenId = poolToken.mint(
      IPoolTokens.MintParams({principalAmount: callAmount, tranche: activeCallSubmissionTranche}),
      owner
    );
    remainingTokenId = poolToken.mint(
      IPoolTokens.MintParams({
        principalAmount: tokenInfo.principalAmount - callAmount,
        tranche: uncalledCapitalTrancheIndex
      }),
      owner
    );
  }

  // Pass 1
  /**
   * Set accepted UID types for the loan.
   * Requires that users have not already begun to deposit.
   */
  function setAllowedUIDTypes(uint256[] calldata ids) external onlyLocker {
    require(_staleCreditLine.checkpoint().totalPrincipalDeposited() == 0, "AF");
    allowedUIDTypes = ids;
  }

  // Pass 1
  function getAllowedUIDTypes() external view returns (uint256[] memory) {
    return allowedUIDTypes;
  }

  // Pass 1
  /// @inheritdoc ILoan
  /**
   * @dev DL: deposits locked
   * @dev IA: invalid amount - must be greater than 0.
   * @dev IT: invalid tranche - must be uncalled capital tranche
   * @dev NA: not authorized. Must have correct UID or be go listed
   * @notice Supply capital to the loan.
   * @param tranche *UNSUPPORTED* -
   * @param amount amount of capital to supply
   * @return tokenId NFT representing your position in this pool
   */
  function deposit(
    uint256 tranche,
    uint256 amount
  ) public override nonReentrant whenNotPaused returns (uint256) {
    CallableCreditLine storage cl = _staleCreditLine.checkpoint();
    require(!locked, "DL");
    require(amount > 0, "IA");
    require(tranche == cl.uncalledCapitalTrancheIndex(), "IT");
    require(hasAllowedUID(msg.sender), "NA");
    require(block.timestamp >= fundableAt, "Not open for funding");

    cl.deposit(amount);
    uint256 tokenId = config.getPoolTokens().mint(
      IPoolTokens.MintParams({tranche: tranche, principalAmount: amount}),
      msg.sender
    );
    config.getUSDC().safeTransferFrom(msg.sender, address(this), amount);

    emit DepositMade(msg.sender, tranche, tokenId, amount);
    return tokenId;
  }

  // Pass 1
  /// @inheritdoc ILoan
  /**
   * @dev DL: deposits locked
   * @dev IA: invalid amount - must be greater than 0.
   * @dev IT: invalid tranche - must be uncalled capital tranche
   * @dev NA: not authorized. Must have correct UID or be go listed
   * @notice Supply capital to the loan.
   * @param tranche *UNSUPPORTED* -
   * @param amount amount of capital to supply
   * @return tokenId NFT representing your position in this pool
   */
  function depositWithPermit(
    uint256 tranche,
    uint256 amount,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) public override whenNotPaused returns (uint256 tokenId) {
    IERC20PermitUpgradeable(config.usdcAddress()).permit(
      msg.sender,
      address(this),
      amount,
      deadline,
      v,
      r,
      s
    );
    return deposit(tranche, amount);
  }

  // Pass 1
  /// @inheritdoc ILoan
  function withdraw(
    uint256 tokenId,
    uint256 amount
  ) public override nonReentrant whenNotPaused returns (uint256, uint256) {
    IPoolTokens.TokenInfo memory tokenInfo = config.getPoolTokens().getTokenInfo(tokenId);
    return _withdraw(tokenInfo, tokenId, amount);
  }

  // Pass 1
  /// @inheritdoc ILoan
  /// @dev LEN: argument length mismatch
  function withdrawMultiple(
    uint256[] calldata tokenIds,
    uint256[] calldata amounts
  ) public override {
    require(tokenIds.length == amounts.length, "LEN");

    for (uint256 i = 0; i < amounts.length; i++) {
      withdraw(tokenIds[i], amounts[i]);
    }
  }

  // Pass 1
  /// @inheritdoc ILoan
  function withdrawMax(
    uint256 tokenId
  )
    public
    override
    nonReentrant
    whenNotPaused
    returns (uint256 interestWithdrawn, uint256 principalWithdrawn)
  {
    CallableCreditLine storage cl = _staleCreditLine.checkpoint();
    IPoolTokens.TokenInfo memory tokenInfo = config.getPoolTokens().getTokenInfo(tokenId);
    (uint256 interestWithdrawable, uint256 principalWithdrawable) = cl
      .cumulativeAmountWithdrawable({
        trancheId: tokenInfo.tranche,
        principal: tokenInfo.principalAmount
      });
    uint256 amountWithdrawable = interestWithdrawable +
      principalWithdrawable -
      tokenInfo.principalRedeemed -
      tokenInfo.interestRedeemed;
    return _withdraw(tokenInfo, tokenId, amountWithdrawable);
  }

  // Pass 1
  /// @inheritdoc ILoan
  /// @dev DP: drawdowns paused
  /// @dev IF: insufficient funds
  function drawdown(uint256 amount) external override(ICreditLine, ILoan) onlyLocker whenNotPaused {
    // TODO: Do we need to checkpiont? Should be able to safely assume that the credit line is not stale.
    CallableCreditLine storage cl = _staleCreditLine.checkpoint();
    require(!drawdownsPaused, "DP");

    // TODO: Introduce proper condition for allowing drawdown.
    //       How about cannot drawdown any capital which has been paid back via pay? ()
    require(cl.totalPrincipalPaid() == 0);
    require(amount <= cl.totalPrincipalPaid(), "IF");

    // Assumes investments have been made already (saves the borrower a separate transaction to lock the pool)
    _lockDeposits();

    cl.drawdown(amount);

    config.getUSDC().safeTransferFrom(address(this), borrower, amount);
    emit DrawdownMade(borrower, amount);
  }

  // Pass 1
  /// @inheritdoc ILoan
  function setFundableAt(uint256 newFundableAt) external override onlyLocker {
    fundableAt = newFundableAt;
  }

  // Pass 1
  /// @inheritdoc ILoan
  /// @dev IT: invalid timestamp
  /// @dev LI: loan inactive
  function getAmountsOwed(
    uint256 timestamp
  )
    external
    view
    override
    returns (
      uint256 returnedInterestOwed,
      uint256 returnedInterestAccrued,
      uint256 returnedPrincipalOwed
    )
  {
    require(timestamp >= block.timestamp, "IT");
    // TODO: Is this the proper condition for a loan being inactive?
    require(termEndTime() > 0, "LI");

    return (interestOwedAt(timestamp), interestAccruedAt(timestamp), principalOwedAt(timestamp));
  }

  // No pass yet
  /// @inheritdoc ILoan
  /// @dev ZA: zero amount
  function pay(
    uint256 amount
  ) external override nonReentrant whenNotPaused returns (PaymentAllocation memory) {
    require(amount > 0, "ZA");
    // Send money to the credit line. Only take what's actually owed
    uint256 maxPayableAmount = interestAccrued() + interestOwed() + balance();
    uint256 amountToPay = MathUpgradeable.min(amount, maxPayableAmount);
    config.getUSDC().safeTransferFrom(msg.sender, address(this), amountToPay);

    // pay interest first, then principal
    uint256 interestAmount = MathUpgradeable.min(amountToPay, interestOwed() + interestAccrued());
    uint256 principalAmount = amountToPay.saturatingSub(interestAmount);

    PaymentAllocation memory pa = _pay(principalAmount, interestAmount);

    // Payment remaining should always be 0 because we don't take excess usdc
    assert(pa.paymentRemaining == 0);
    return pa;
  }

  // No pass yet
  /// @inheritdoc ILoan
  /// @dev ZA: zero amount
  /// TODO: Turn back to external
  function pay(
    uint256 principalAmount,
    uint256 interestAmount
  )
    public
    override(ICreditLine, ILoan)
    nonReentrant
    whenNotPaused
    returns (PaymentAllocation memory)
  {
    uint256 totalPayment = principalAmount + interestAmount;
    require(totalPayment > 0, "ZA");

    // If there is an excess principal payment then only take what we actually need
    uint256 principalToPay = MathUpgradeable.min(principalAmount, balance());

    // If there is an excess interest payment then only take what we actually need
    uint256 maxPayableInterest = interestAccrued() + interestOwed();
    uint256 interestToPay = MathUpgradeable.min(interestAmount, maxPayableInterest);
    config.getUSDC().safeTransferFrom(msg.sender, address(this), principalToPay + interestToPay);
    PaymentAllocation memory pa = _pay(principalToPay, interestToPay);

    // Payment remaining should always be 0 because we don't take excess usdc
    assert(pa.paymentRemaining == 0);
    return pa;
  }

  // Pass 1
  function nextDueTimeAt(uint256 timestamp) public view returns (uint256) {
    PaymentSchedule storage ps = _staleCreditLine.paymentSchedule();
    return ps.nextDueTimeAt(timestamp);
  }

  // Pass 1
  function paymentSchedule() public view returns (PaymentSchedule memory) {
    return _staleCreditLine.paymentSchedule();
  }

  // Pass 1
  function schedule() public view override returns (ISchedule) {
    return _staleCreditLine.schedule();
  }

  // TODO: Unnecessary now?
  /// @notice Pauses all drawdowns (but not deposits/withdraws)
  function pauseDrawdowns() public onlyAdmin {
    drawdownsPaused = true;
    emit DrawdownsPaused(address(this));
  }

  // TODO: Unnecessary now?
  /// @notice Unpause drawdowns
  function unpauseDrawdowns() public onlyAdmin {
    drawdownsPaused = false;
    emit DrawdownsUnpaused(address(this));
  }

  /*
   * Unsupported ICreditLine method kept for ICreditLine conformance
   */
  function setLimit(uint256 newAmount) external override onlyAdmin {
    revert("US");
  }

  // /*
  //  * Unsupported ILoan method kept for ILoan conformance
  //  */
  // function lockPool(uint256 newAmount) external onlyAdmin {
  //   revert("US");
  // }

  // No pass yet
  /// @inheritdoc ILoan
  function availableToWithdraw(uint256 tokenId) public view override returns (uint256, uint256) {
    IPoolTokens.TokenInfo memory tokenInfo = config.getPoolTokens().getTokenInfo(tokenId);
    // TODO:
    // ITranchedPool.TrancheInfo storage trancheInfo = _getTrancheInfo(tokenInfo.tranche);

    // if (block.timestamp > trancheInfo.lockedUntil) {
    //   return TranchingLogic.redeemableInterestAndPrincipal(trancheInfo, tokenInfo);
    // } else {
    return (0, 0);
    // }
  }

  // Pass 1
  function hasAllowedUID(address sender) public view override returns (bool) {
    return config.getGo().goOnlyIdTypes(sender, allowedUIDTypes);
  }

  /* Internal functions  */

  // No pass yet
  /// @dev NL: not locked
  function _pay(
    uint256 principalPayment,
    uint256 interestPayment
  ) internal returns (PaymentAllocation memory) {
    // We need to make sure the pool is locked before we allocate rewards to ensure it's not
    // possible to game rewards by sandwiching an interest payment to an unlocked pool
    // It also causes issues trying to allocate payments to an empty slice (divide by zero)
    require(locked, "NL");

    uint256 interestAccrued = totalInterestAccruedAt(interestAccruedAsOf());
    PaymentAllocation memory pa = pay(principalPayment, interestPayment);
    interestAccrued = totalInterestAccrued() - interestAccrued;

    return pa;
  }

  // No pass yet
  function _collectInterestAndPrincipal(
    uint256 interest,
    uint256 principal
  ) internal returns (uint256) {
    // TODO: Remove
    // uint256 totalReserveAmount = TranchingLogic.applyToAllSlices(
    //   _poolSlices,
    //   numSlices,
    //   interest,
    //   principal,
    //   uint256(100).div(config.getReserveDenominator()), // Convert the denominator to percent
    //   totalDeployed,
    //   creditLine,
    //   0
    // );

    // TODO: This is Placeholder - remove
    uint256 totalReserveAmount = 0;

    config.getUSDC().safeTransferFrom(address(this), config.reserveAddress(), totalReserveAmount);

    emit ReserveFundsCollected(address(this), totalReserveAmount);

    return totalReserveAmount;
  }

  // // Internal //////////////////////////////////////////////////////////////////

  // No pass yet
  /// @dev ZA: Zero amount
  /// @dev IA: Invalid amount - amount too large
  /// @dev DL: Tranched Locked
  function _withdraw(
    IPoolTokens.TokenInfo memory tokenInfo,
    uint256 tokenId,
    uint256 amount
  ) internal returns (uint256, uint256) {
    /// @dev NA: not authorized
    require(
      config.getPoolTokens().isApprovedOrOwner(msg.sender, tokenId) && hasAllowedUID(msg.sender),
      "NA"
    );
    require(amount > 0, "ZA");

    // TODO: Require amount is less than or equal to the amount that can be withdrawn
    // TODO: Need to include logic for determining redeemable amount on tokens.
    //       callableCreditLine.cumulativeAmountWithdrawable(trancheId, ...tokenInfo)
    // (uint256 interestRedeemable, uint256 principalRedeemable) = TranchingLogic
    //   .redeemableInterestAndPrincipal(trancheInfo, tokenInfo);
    // uint256 netRedeemable = interestRedeemable.add(principalRedeemable);

    // TODO START TEMPORARY
    uint256 netRedeemable = 0;
    // TODO END TEMPORARY

    require(amount <= netRedeemable, "IA");
    // TODO: require(!locked, "DL");

    uint256 interestToRedeem = 0;
    uint256 principalToRedeem = 0;

    // If the tranche has not been locked, ensure the deposited amount is correct
    // TODO:
    // if (trancheInfo.lockedUntil == 0) {
    //   trancheInfo.principalDeposited = trancheInfo.principalDeposited.sub(amount);

    //   principalToRedeem = amount;

    //   config.getPoolTokens().withdrawPrincipal(tokenId, principalToRedeem);
    // } else {
    //   interestToRedeem = MathUpgradeable.min(interestRedeemable, amount);
    //   principalToRedeem = MathUpgradeable.min(principalRedeemable, amount.sub(interestToRedeem));

    //   config.getPoolTokens().redeem(tokenId, principalToRedeem, interestToRedeem);
    // }

    config.getUSDC().safeTransferFrom(
      address(this),
      msg.sender,
      principalToRedeem + interestToRedeem
    );

    emit WithdrawalMade(
      msg.sender,
      tokenInfo.tranche,
      tokenId,
      interestToRedeem,
      principalToRedeem
    );

    return (interestToRedeem, principalToRedeem);
  }

  // Pass 1
  /// @dev DL: Deposits locked. Deposits have already been locked.
  function _lockDeposits() internal {
    require(!locked, "DL");
    locked = true;
    // TODO: Is this still necessary?
    // setLimit(
    //   MathUpgradeable.min(creditLine.limit().add(currentTotal), maxLimit())
    // );
    emit DepositsLocked(address(this));
  }

  // // ICreditLine Conformance /////////////////////////////////////////////////////

  /**
   * Pass 1
   */
  function creditLine() external view override returns (ICreditLine) {
    return this;
  }

  /**
   * Unsupported in callable loans.
   */
  function maxLimit() external view override returns (uint256) {
    revert("US");
  }

  /**
   * Unsupported in callable loans.
   */
  function setMaxLimit(uint256 newAmount) external override {
    revert("US");
  }

  // // ICreditLine Conformance TODO Should all be external/////////////////////////////////////////////////////

  function balance() public view returns (uint256) {
    return 0;
  }

  function interestOwed() public view returns (uint256) {
    return 0;
  }

  function principalOwed() public view override returns (uint256) {
    return 0;
  }

  function termEndTime() public view override returns (uint256) {
    return 0;
  }

  function nextDueTime() public view override returns (uint256) {
    return 0;
  }

  function interestAccruedAsOf() public view override returns (uint256) {
    return 0;
  }

  function lastFullPaymentTime() public view override returns (uint256) {
    return 0;
  }

  function currentLimit() public view override returns (uint256) {
    return 0;
  }

  function limit() public view override returns (uint256) {
    return 0;
  }

  function interestApr() public view override returns (uint256) {
    return 0;
  }

  function lateFeeApr() public view override returns (uint256) {
    return 0;
  }

  function isLate() public view returns (bool) {
    return false;
  }

  function withinPrincipalGracePeriod() public view returns (bool) {
    return false;
  }

  /// @notice Cumulative interest accrued up to now
  function totalInterestAccrued() public view override returns (uint256) {
    return 0;
  }

  /// @notice Cumulative interest accrued up to `timestamp`
  function totalInterestAccruedAt(uint256 timestamp) public view override returns (uint256) {
    return 0;
  }

  /// @notice Cumulative interest paid back up to now
  function totalInterestPaid() public view override returns (uint256) {
    return 0;
  }

  /// @notice Cumulative interest owed up to now
  function totalInterestOwed() public view override returns (uint256) {
    return 0;
  }

  /// @notice Cumulative interest owed up to `timestamp`
  function totalInterestOwedAt(uint256 timestamp) public view override returns (uint256) {
    return 0;
  }

  /// @notice Interest that would be owed at `timestamp`
  function interestOwedAt(uint256 timestamp) public view override returns (uint256) {
    return 0;
  }

  /// @notice Interest accrued in the current payment period up to now. Converted to
  ///   owed interest once we cross into the next payment period. Is 0 if the
  ///   current time is after loan maturity (all interest accrued immediately becomes
  ///   interest owed).
  function interestAccrued() public view override returns (uint256) {
    return 0;
  }

  /// @notice Interest accrued in the current payment period for `timestamp`. Coverted to
  ///   owed interest once we cross into the payment period after `timestamp`. Is 0
  ///   if `timestamp` is after loan maturity (all interest accrued immediately becomes
  ///   interest owed).
  function interestAccruedAt(uint256 timestamp) public view override returns (uint256) {
    return 0;
  }

  /// @notice Principal owed up to `timestamp`
  function principalOwedAt(uint256 timestamp) public view override returns (uint256) {
    return 0;
  }

  /// @notice Returns the total amount of principal thats been paid
  function totalPrincipalPaid() public view override returns (uint256) {
    return 0;
  }

  /// @notice Cumulative principal owed at timestamp
  function totalPrincipalOwedAt(uint256 timestamp) public view override returns (uint256) {
    return 0;
  }

  /// @notice Cumulative principal owed at current timestamp
  function totalPrincipalOwed() public view override returns (uint256) {
    return 0;
  }

  /// @notice Time of first drawdown
  function termStartTime() public view override returns (uint256) {
    return _staleCreditLine.schedule().termStartTime();
  }

  // // Modifiers /////////////////////////////////////////////////////////////////

  /// @inheritdoc IVersioned
  function getVersion() external pure override returns (uint8[3] memory version) {
    (version[0], version[1], version[2]) = (MAJOR_VERSION, MINOR_VERSION, PATCH_VERSION);
  }

  /// @dev NA: not authorized. not locker
  modifier onlyLocker() {
    require(hasRole(LOCKER_ROLE, msg.sender), "NA");
    _;
  }
}
