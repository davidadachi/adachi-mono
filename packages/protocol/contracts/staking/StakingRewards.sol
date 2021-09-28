// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/math/Math.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/drafts/IERC20Permit.sol";

import "../external/ERC721PresetMinterPauserAutoId.sol";
import "../interfaces/IERC20withDec.sol";
import "../interfaces/ISeniorPool.sol";
import "../protocol/core/GoldfinchConfig.sol";
import "../protocol/core/ConfigHelper.sol";
import "../protocol/core/BaseUpgradeablePausable.sol";

import "../library/Vesting.sol";

contract StakingRewards is ERC721PresetMinterPauserAutoIdUpgradeSafe, ReentrancyGuardUpgradeSafe {
  using SafeMath for uint256;
  using SafeERC20 for IERC20withDec;
  using ConfigHelper for GoldfinchConfig;

  using Vesting for Vesting.Rewards;

  enum LockupPeriod {
    SixMonths,
    TwelveMonths,
    TwentyFourMonths
  }

  struct StakedPosition {
    // @notice Staked amount denominated in `stakingToken().decimals()`
    uint256 amount;
    // @notice Struct describing rewards owed with vesting
    Vesting.Rewards rewards;
    // @notice Multiplier applied to staked amount when locking up position
    uint256 leverageMultiplier;
    // @notice Time in seconds after which position can be unstaked
    uint256 lockedUntil;
  }

  /* ========== EVENTS =================== */
  event TargetCapacityUpdated(address indexed who, uint256 targetCapacity);
  event VestingScheduleUpdated(address indexed who, uint256 vestingLength);
  event MinRateUpdated(address indexed who, uint256 minRate);
  event MaxRateUpdated(address indexed who, uint256 maxRate);
  event MinRateAtPercentUpdated(address indexed who, uint256 minRateAtPercent);
  event MaxRateAtPercentUpdated(address indexed who, uint256 maxRateAtPercent);
  event LeverageMultiplierUpdated(address indexed who, LockupPeriod lockupPeriod, uint256 leverageMultiplier);

  /* ========== STATE VARIABLES ========== */

  uint256 private constant MULTIPLIER_DECIMALS = 1e18;

  bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

  GoldfinchConfig public config;

  /// @notice The block timestamp when rewards were last checkpointed
  uint256 public lastUpdateTime;

  /// @notice Accumulated rewards per token at the last checkpoint
  uint256 public accumulatedRewardsPerToken;

  /// @notice Total rewards available for disbursement at the last checkpoint, denominated in `rewardsToken()`
  uint256 public rewardsAvailable;

  /// @notice StakedPosition tokenId => accumulatedRewardsPerToken at the position's last checkpoint
  mapping(uint256 => uint256) public positionToAccumulatedRewardsPerToken;

  /// @notice Desired supply of staked tokens. The reward rate adjusts in a range
  ///   around this value to incentivize staking or unstaking to maintain it.
  uint256 public targetCapacity;

  /// @notice The minimum total disbursed rewards per second, denominated in `rewardsToken()`
  uint256 public minRate;

  /// @notice The maximum total disbursed rewards per second, denominated in `rewardsToken()`
  uint256 public maxRate;

  /// @notice The percent of `targetCapacity` at which the reward rate reaches `maxRate`.
  ///  Represented with `MULTIPLIER_DECIMALS`.
  uint256 public maxRateAtPercent;

  /// @notice The percent of `targetCapacity` at which the reward rate reaches `minRate`.
  ///  Represented with `MULTIPLIER_DECIMALS`.
  uint256 public minRateAtPercent;

  /// @notice The duration in seconds over which rewards vest
  uint256 public vestingLength;

  /// @dev Supply of staked tokens, excluding leverage due to lock-up boosting, denominated in
  ///   `stakingToken().decimals()`
  uint256 public totalStakedSupply;

  /// @dev Supply of staked tokens, including leverage due to lock-up boosting, denominated in
  ///   `stakingToken().decimals()`
  uint256 private totalLeveragedStakedSupply;

  /// @dev A mapping from lockup periods to leverage multipliers used to boost rewards.
  ///   See `stakeWithLockup`.
  mapping(LockupPeriod => uint256) private leverageMultipliers;

  /// @dev NFT tokenId => staked position
  mapping(uint256 => StakedPosition) private positions;

  // solhint-disable-next-line func-name-mixedcase
  function __initialize__(address owner, GoldfinchConfig _config) external initializer {
    __Context_init_unchained();
    __ERC165_init_unchained();
    __ERC721_init_unchained("Goldfinch V2 LP Staking Tokens", "GFI-V2-LPS");
    __ERC721Pausable_init_unchained();
    __AccessControl_init_unchained();
    __Pausable_init_unchained();
    __ReentrancyGuard_init_unchained();

    _setupRole(OWNER_ROLE, owner);
    _setupRole(PAUSER_ROLE, owner);

    _setRoleAdmin(PAUSER_ROLE, OWNER_ROLE);
    _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);

    config = _config;

    vestingLength = 365 days;

    // Set defaults for leverage multipliers
    leverageMultipliers[LockupPeriod.SixMonths] = uint256(15).mul(MULTIPLIER_DECIMALS).div(10); // 1.5x
    leverageMultipliers[LockupPeriod.TwelveMonths] = uint256(2).mul(MULTIPLIER_DECIMALS); // 2x
    leverageMultipliers[LockupPeriod.TwentyFourMonths] = uint256(3).mul(MULTIPLIER_DECIMALS); // 3x
  }

  /* ========== VIEWS ========== */

  /// @notice Returns the staked balance of a given position token
  /// @param tokenId A staking position token ID
  /// @return Amount of staked tokens denominated in `stakingToken().decimals()`
  function stakedBalanceOf(uint256 tokenId) external view returns (uint256) {
    return positions[tokenId].amount;
  }

  /// @notice The address of the token being disbursed as rewards
  function rewardsToken() public view returns (IERC20withDec) {
    return config.getGFI();
  }

  /// @notice The address of the token that can be staked
  function stakingToken() public view returns (IERC20withDec) {
    return config.getFidu();
  }

  /// @notice Returns accumulated rewards per token up to the current block timestamp
  /// @return Amount of rewards denominated in `rewardsToken().decimals()`
  function rewardPerToken() public view returns (uint256) {
    if (totalLeveragedStakedSupply == 0) {
      return accumulatedRewardsPerToken;
    }
    // Limit accumulated rewards by the total rewards available for distribution. If there aren't
    // enough rewards in the balance of this contract, then we shouldn't be giving them out.
    uint256 rewardsSinceLastUpdate = Math.min(block.timestamp.sub(lastUpdateTime).mul(rewardRate()), rewardsAvailable);
    uint256 additionalRewardPerToken = rewardsSinceLastUpdate.mul(stakingTokenMantissa()).div(
      totalLeveragedStakedSupply
    );
    // Prevent perverse, infinite-mint scenario where totalLeveragedStakedSupply is a fraction of a token.
    // Since it's used as the denominator, this could make additionalRewardPerToken larger than the total number
    // of tokens that should have been disbursed in the elapsed time. The attacker would need to find
    // a way to reduce totalLeveragedStakedSupply while maintaining a staked position of >= 1.
    // See: https://twitter.com/Mudit__Gupta/status/1409463917290557440
    require(
      additionalRewardPerToken <= rewardsSinceLastUpdate,
      "additional rewardPerToken cannot exceed rewardsSinceLastUpdate"
    );
    return accumulatedRewardsPerToken.add(additionalRewardPerToken);
  }

  /// @notice Returns rewards earned by a given position token from the last checkpoint up to the
  ///   current block timestamp.
  /// @param tokenId A staking position token ID
  /// @return Amount of rewards denominated in `rewardsToken().decimals()`
  function earnedSinceLastCheckpoint(uint256 tokenId) public view returns (uint256) {
    StakedPosition storage position = positions[tokenId];
    uint256 leveredAmount = positionToLeveredAmount(position);
    return
      leveredAmount.mul(rewardPerToken().sub(positionToAccumulatedRewardsPerToken[tokenId])).div(
        stakingTokenMantissa()
      );
  }

  /// @notice Returns the rewards claimable by a given position token at the most recent checkpoint, taking into
  ///   account vesting schedule.
  /// @return rewards Amount of rewards denominated in `rewardsToken().decimals()`
  function claimableRewards(uint256 tokenId) internal view returns (uint256 rewards) {
    return positions[tokenId].rewards.claimable();
  }

  /// @notice Number of rewards, in `rewardsToken().decimals()`, to disburse each second
  function rewardRate() internal view returns (uint256) {
    // The reward rate can be thought of as a piece-wise function:
    //
    //   let intervalStart = (maxRateAtPercent * targetCapacity),
    //       intervalEnd = (minRateAtPercent * targetCapacity),
    //       x = totalStakedSupply
    //   in
    //     if x < intervalStart
    //       y = maxRate
    //     if x > intervalEnd
    //       y = minRate
    //     else
    //       y = maxRate - (maxRate - minRate) * (x - intervalStart) / (intervalEnd - intervalStart)
    //
    // See an example here:
    // solhint-disable-next-line max-line-length
    // https://www.wolframalpha.com/input/?i=Piecewise%5B%7B%7B1000%2C+x+%3C+50%7D%2C+%7B100%2C+x+%3E+300%7D%2C+%7B1000+-+%281000+-+100%29+*+%28x+-+50%29+%2F+%28300+-+50%29+%2C+50+%3C+x+%3C+300%7D%7D%5D
    //
    // In that example:
    //   maxRateAtPercent = 0.5, minRateAtPercent = 3, targetCapacity = 100, maxRate = 1000, minRate = 100
    uint256 intervalStart = targetCapacity.mul(maxRateAtPercent).div(MULTIPLIER_DECIMALS);
    uint256 intervalEnd = targetCapacity.mul(minRateAtPercent).div(MULTIPLIER_DECIMALS);
    uint256 x = totalStakedSupply;

    // Subsequent computation would overflow
    if (intervalEnd <= intervalStart) {
      return 0;
    }

    if (x < intervalStart) {
      return maxRate;
    }

    if (x > intervalEnd) {
      return minRate;
    }

    return maxRate.sub(maxRate.sub(minRate).mul(x.sub(intervalStart)).div(intervalEnd.sub(intervalStart)));
  }

  function positionToLeveredAmount(StakedPosition storage position) internal view returns (uint256) {
    return toLeveredAmount(position.amount, position.leverageMultiplier);
  }

  function toLeveredAmount(uint256 amount, uint256 leverageMultiplier) internal pure returns (uint256) {
    return amount.mul(leverageMultiplier).div(MULTIPLIER_DECIMALS);
  }

  function stakingTokenMantissa() internal view returns (uint256) {
    return uint256(10)**stakingToken().decimals();
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  /// @notice Stake `stakingToken()` to earn rewards. When you call this function, you'll receive an
  ///   an NFT representing your staked position. You can present your NFT to `getReward` or `unstake`
  ///   to claim rewards or unstake your tokens respectively. Rewards vest over a schedule.
  /// @dev This function checkpoints rewards.
  /// @param amount The amount of `stakingToken()` to stake
  function stake(uint256 amount) external nonReentrant whenNotPaused updateReward(0) {
    _stakeWithLockup(msg.sender, msg.sender, amount, 0, MULTIPLIER_DECIMALS);
  }

  /// @notice Stake `stakingToken()` and lock your position for a period of time to boost your rewards.
  ///   When you call this function, you'll receive an an NFT representing your staked position.
  ///   You can present your NFT to `getReward` or `unstake` to claim rewards or unstake your tokens
  ///   respectively. Rewards vest over a schedule.
  ///
  ///   A locked position's rewards are boosted using a multiplier on the staked balance. For example,
  ///   if I lock 100 tokens for a 2x multiplier, my rewards will be calculated as if I staked 200 tokens.
  ///   This mechanism is similar to curve.fi's CRV-boosting vote-locking. Locked positions cannot be
  ///   unstaked until after the position's lockedUntil timestamp.
  /// @dev This function checkpoints rewards.
  /// @param amount The amount of `stakingToken()` to stake
  /// @param lockupPeriod The period over which to lock staked tokens
  function stakeWithLockup(uint256 amount, LockupPeriod lockupPeriod)
    external
    nonReentrant
    whenNotPaused
    updateReward(0)
  {
    uint256 lockDuration = lockupPeriodToDuration(lockupPeriod);
    uint256 leverageMultiplier = getLeverageMultiplier(lockupPeriod);
    uint256 lockedUntil = block.timestamp.add(lockDuration);
    _stakeWithLockup(msg.sender, msg.sender, amount, lockedUntil, leverageMultiplier);
  }

  /// @notice Deposit to SeniorPool and stake your shares in the same transaction.
  /// @param usdcAmount The amount of USDC to deposit into the senior pool. All shares from deposit
  ///   will be staked.
  function depositAndStake(uint256 usdcAmount) public nonReentrant whenNotPaused updateReward(0) {
    uint256 fiduAmount = depositToSeniorPool(usdcAmount);
    _stakeWithLockup(address(this), msg.sender, fiduAmount, 0, MULTIPLIER_DECIMALS);
  }

  function depositToSeniorPool(uint256 usdcAmount) internal returns (uint256 fiduAmount) {
    IERC20withDec usdc = config.getUSDC();
    usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

    ISeniorPool seniorPool = config.getSeniorPool();
    usdc.safeIncreaseAllowance(address(seniorPool), usdcAmount);
    return seniorPool.deposit(usdcAmount);
  }

  /// @notice Identical to `depositAndStake`, except it allows for a signature to be passed that permits
  ///   this contract to move funds on behalf of the user.
  /// @param usdcAmount The amount of USDC to deposit
  /// @param v secp256k1 signature component
  /// @param r secp256k1 signature component
  /// @param s secp256k1 signature component
  function depositWithPermitAndStake(
    uint256 usdcAmount,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) public {
    IERC20Permit(config.usdcAddress()).permit(msg.sender, address(this), usdcAmount, deadline, v, r, s);
    depositAndStake(usdcAmount);
  }

  /// @notice Deposit to the `SeniorPool` and stake your shares with a lock-up in the same transaction.
  /// @param usdcAmount The amount of USDC to deposit into the senior pool. All shares from deposit
  ///   will be staked.
  /// @param lockupPeriod The period over which to lock staked tokens
  function depositAndStakeWithLockup(uint256 usdcAmount, LockupPeriod lockupPeriod)
    public
    nonReentrant
    whenNotPaused
    updateReward(0)
  {
    uint256 fiduAmount = depositToSeniorPool(usdcAmount);
    uint256 lockDuration = lockupPeriodToDuration(lockupPeriod);
    uint256 leverageMultiplier = getLeverageMultiplier(lockupPeriod);
    uint256 lockedUntil = block.timestamp.add(lockDuration);
    _stakeWithLockup(address(this), msg.sender, fiduAmount, lockedUntil, leverageMultiplier);
  }

  function lockupPeriodToDuration(LockupPeriod lockupPeriod) internal pure returns (uint256 lockDuration) {
    if (lockupPeriod == LockupPeriod.SixMonths) {
      return 365 days / 2;
    } else if (lockupPeriod == LockupPeriod.TwelveMonths) {
      return 365 days;
    } else if (lockupPeriod == LockupPeriod.TwentyFourMonths) {
      return 365 days * 2;
    } else {
      revert("unsupported LockupPeriod");
    }
  }

  /// @notice Get the leverage multiplier used to boost rewards for a given lockup period.
  ///   See `stakeWithLockup`. The leverage multiplier is denominated in `MULTIPLIER_DECIMALS`.
  function getLeverageMultiplier(LockupPeriod lockupPeriod) public view returns (uint256) {
    uint256 leverageMultiplier = leverageMultipliers[lockupPeriod];
    require(leverageMultiplier > 0, "unsupported LockupPeriod");
    return leverageMultiplier;
  }

  /// @notice Identical to `depositAndStakeWithLockup`, except it allows for a signature to be passed that permits
  ///   this contract to move funds on behalf of the user.
  /// @param usdcAmount The amount of USDC to deposit
  /// @param lockupPeriod The period over which to lock staked tokens
  /// @param v secp256k1 signature component
  /// @param r secp256k1 signature component
  /// @param s secp256k1 signature component
  function depositWithPermitAndStakeWithLockup(
    uint256 usdcAmount,
    LockupPeriod lockupPeriod,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) public {
    IERC20Permit(config.usdcAddress()).permit(msg.sender, address(this), usdcAmount, deadline, v, r, s);
    depositAndStakeWithLockup(usdcAmount, lockupPeriod);
  }

  function _stakeWithLockup(
    address staker,
    address nftRecipient,
    uint256 amount,
    uint256 lockedUntil,
    uint256 leverageMultiplier
  ) internal {
    require(amount > 0, "Cannot stake 0");

    _tokenIdTracker.increment();
    uint256 tokenId = _tokenIdTracker.current();

    // Ensure we snapshot accumulatedRewardsPerToken for tokenId after it is available
    // We do this before setting the position, because we don't want `earned` to (incorrectly) account for
    // position.amount yet. This is equivalent to using the updateReward(msg.sender) modifier in the original
    // synthetix contract, where the modifier is called before any staking balance for that address is recorded
    _updateReward(tokenId);

    positions[tokenId] = StakedPosition({
      amount: amount,
      rewards: Vesting.Rewards({
        totalUnvested: 0,
        totalVested: 0,
        totalPreviouslyVested: 0,
        totalClaimed: 0,
        startTime: block.timestamp,
        endTime: block.timestamp.add(vestingLength)
      }),
      leverageMultiplier: leverageMultiplier,
      lockedUntil: lockedUntil
    });
    _mint(nftRecipient, tokenId);

    uint256 leveredAmount = positionToLeveredAmount(positions[tokenId]);
    totalLeveragedStakedSupply = totalLeveragedStakedSupply.add(leveredAmount);
    totalStakedSupply = totalStakedSupply.add(amount);

    // Staker is address(this) when using depositAndStake or other convenience functions
    if (staker != address(this)) {
      stakingToken().safeTransferFrom(staker, address(this), amount);
    }

    emit Staked(nftRecipient, tokenId, amount, lockedUntil, leverageMultiplier);
  }

  /// @notice Unstake an amount of `stakingToken()` associated with a given position and transfer to msg.sender.
  ///   Unvested rewards will be forfeited, but remaining staked amount will continue to accrue rewards.
  ///   Positions that are still locked cannot be unstaked until the position's lockedUntil time has passed.
  /// @dev This function checkpoints rewards
  /// @param tokenId A staking position token ID
  /// @param amount Amount of `stakingToken()` to be unstaked from the position
  function unstake(uint256 tokenId, uint256 amount) public nonReentrant whenNotPaused updateReward(tokenId) {
    _unstake(tokenId, amount);
    stakingToken().safeTransfer(msg.sender, amount);
  }

  function unstakeAndWithdraw(uint256 tokenId, uint256 usdcAmount)
    public
    nonReentrant
    whenNotPaused
    updateReward(tokenId)
  {
    ISeniorPool seniorPool = config.getSeniorPool();
    IFidu fidu = config.getFidu();

    uint256 fiduBalanceBefore = fidu.balanceOf(address(this));

    uint256 usdcAmountReceived = seniorPool.withdraw(usdcAmount);

    uint256 fiduUsed = fiduBalanceBefore.sub(fidu.balanceOf(address(this)));

    _unstake(tokenId, fiduUsed);
    config.getUSDC().safeTransfer(msg.sender, usdcAmountReceived);
  }

  function unstakeAndWithdrawInFidu(uint256 tokenId, uint256 fiduAmount)
    public
    nonReentrant
    whenNotPaused
    updateReward(tokenId)
  {
    uint256 usdcAmount = config.getSeniorPool().withdrawInFidu(fiduAmount);
    _unstake(tokenId, fiduAmount);
    config.getUSDC().safeTransfer(msg.sender, usdcAmount);
  }

  function _unstake(uint256 tokenId, uint256 amount) internal {
    require(ownerOf(tokenId) == msg.sender, "access denied");
    require(amount > 0, "Cannot unstake 0");

    StakedPosition storage position = positions[tokenId];
    uint256 prevAmount = position.amount;
    require(amount <= prevAmount, "cannot unstake more than staked balance");

    require(block.timestamp >= position.lockedUntil, "staked funds are locked");

    // By this point, leverageMultiplier should always be 1x due to the reset logic in updateReward.
    // But we subtract leveredAmount from totalLeveragedStakedSupply anyway, since that is technically correct.
    uint256 leveredAmount = toLeveredAmount(amount, position.leverageMultiplier);
    totalLeveragedStakedSupply = totalLeveragedStakedSupply.sub(leveredAmount);
    totalStakedSupply = totalStakedSupply.sub(amount);
    position.amount = prevAmount.sub(amount);

    // Slash unvested rewards
    uint256 slashingPercentage = amount.mul(Vesting.PERCENTAGE_DECIMALS).div(prevAmount);
    position.rewards.slash(slashingPercentage);

    emit Unstaked(msg.sender, tokenId, amount);
  }

  /// @notice "Kick" a user's reward multiplier. If they are past their lock-up period, their reward
  ///   multipler will be reset to 1x.
  /// @dev This will also checkpoint their rewards up to the current time.
  function kick(uint256 tokenId) public nonReentrant whenNotPaused updateReward(tokenId) {}

  /// @notice Claim rewards for a given staked position
  /// @param tokenId A staking position token ID
  function getReward(uint256 tokenId) public nonReentrant whenNotPaused updateReward(tokenId) {
    require(ownerOf(tokenId) == msg.sender, "access denied");
    uint256 reward = claimableRewards(tokenId);
    if (reward > 0) {
      positions[tokenId].rewards.claim(reward);
      rewardsToken().safeTransfer(msg.sender, reward);
      emit RewardPaid(msg.sender, tokenId, reward);
    }
  }

  /// @notice Unstake the position's full amount and claim all rewards
  /// @param tokenId A staking position token ID
  function exit(uint256 tokenId) external {
    unstake(tokenId, positions[tokenId].amount);
    getReward(tokenId);
  }

  function exitAndWithdraw(uint256 tokenId) external {
    unstakeAndWithdrawInFidu(tokenId, positions[tokenId].amount);
    getReward(tokenId);
  }

  /* ========== RESTRICTED FUNCTIONS ========== */

  /// @notice Transfer rewards from msg.sender, to be used for reward distribution
  function loadRewards(uint256 rewards) public onlyAdmin updateReward(0) {
    rewardsToken().safeTransferFrom(msg.sender, address(this), rewards);
    rewardsAvailable = rewardsAvailable.add(rewards);
    emit RewardAdded(rewards);
  }

  function setRates(
    uint256 _targetCapacity,
    uint256 _maxRateAtPercent,
    uint256 _minRateAtPercent,
    uint256 _maxRate,
    uint256 _minRate
  ) public onlyAdmin updateReward(0) {
    targetCapacity = _targetCapacity;
    maxRateAtPercent = _maxRateAtPercent;
    minRateAtPercent = _minRateAtPercent;
    maxRate = _maxRate;
    minRate = _minRate;

    emit TargetCapacityUpdated(msg.sender, targetCapacity);
    emit MaxRateAtPercentUpdated(msg.sender, maxRateAtPercent);
    emit MinRateAtPercentUpdated(msg.sender, minRateAtPercent);
    emit MaxRateUpdated(msg.sender, maxRate);
    emit MinRateUpdated(msg.sender, minRate);
  }

  function setLeverageMultiplier(LockupPeriod lockupPeriod, uint256 leverageMultiplier)
    public
    onlyAdmin
    updateReward(0)
  {
    leverageMultipliers[lockupPeriod] = leverageMultiplier;
    emit LeverageMultiplierUpdated(msg.sender, lockupPeriod, leverageMultiplier);
  }

  function setVestingSchedule(uint256 _vestingLength) public onlyAdmin updateReward(0) {
    vestingLength = _vestingLength;
    emit VestingScheduleUpdated(msg.sender, vestingLength);
  }

  /* ========== MODIFIERS ========== */

  modifier updateReward(uint256 tokenId) {
    _updateReward(tokenId);
    _;
  }

  function _updateReward(uint256 tokenId) internal {
    uint256 prevAccumulatedRewardsPerToken = accumulatedRewardsPerToken;

    accumulatedRewardsPerToken = rewardPerToken();
    uint256 rewardsJustDistributed = totalLeveragedStakedSupply
      .mul(accumulatedRewardsPerToken.sub(prevAccumulatedRewardsPerToken))
      .div(stakingTokenMantissa());
    rewardsAvailable = rewardsAvailable.sub(rewardsJustDistributed);
    lastUpdateTime = block.timestamp;

    if (tokenId != 0) {
      uint256 additionalRewards = earnedSinceLastCheckpoint(tokenId);

      StakedPosition storage position = positions[tokenId];
      Vesting.Rewards storage rewards = position.rewards;
      rewards.totalUnvested = rewards.totalUnvested.add(additionalRewards);
      rewards.checkpoint();

      positionToAccumulatedRewardsPerToken[tokenId] = accumulatedRewardsPerToken;

      // If position is unlocked, reset its leverageMultiplier back to 1x
      uint256 lockedUntil = position.lockedUntil;
      uint256 leverageMultiplier = position.leverageMultiplier;
      uint256 amount = position.amount;
      if (lockedUntil > 0 && block.timestamp >= lockedUntil && leverageMultiplier > MULTIPLIER_DECIMALS) {
        uint256 prevLeveredAmount = toLeveredAmount(amount, leverageMultiplier);
        uint256 newLeveredAmount = toLeveredAmount(amount, MULTIPLIER_DECIMALS);
        position.leverageMultiplier = MULTIPLIER_DECIMALS;
        totalLeveragedStakedSupply = totalLeveragedStakedSupply.sub(prevLeveredAmount).add(newLeveredAmount);
      }
    }
  }

  function isAdmin() public view returns (bool) {
    return hasRole(OWNER_ROLE, _msgSender());
  }

  modifier onlyAdmin() {
    require(isAdmin(), "Must have admin role to perform this action");
    _;
  }

  /* ========== EVENTS ========== */

  event RewardAdded(uint256 reward);
  event Staked(address indexed user, uint256 indexed tokenId, uint256 amount, uint256 lockedUntil, uint256 multiplier);
  event Unstaked(address indexed user, uint256 indexed tokenId, uint256 amount);
  event RewardPaid(address indexed user, uint256 indexed tokenId, uint256 reward);
}
