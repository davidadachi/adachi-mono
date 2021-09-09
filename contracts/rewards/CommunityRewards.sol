// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/ReentrancyGuard.sol";

import "../external/ERC721PresetMinterPauserAutoId.sol";
import "../interfaces/IERC20withDec.sol";
import "../protocol/core/GoldfinchConfig.sol";
import "../protocol/core/ConfigHelper.sol";

import "../library/CommunityRewardsVesting.sol";

contract CommunityRewards is ERC721PresetMinterPauserAutoIdUpgradeSafe, ReentrancyGuardUpgradeSafe {
  using SafeMath for uint256;
  using SafeERC20 for IERC20withDec;
  using ConfigHelper for GoldfinchConfig;

  using CommunityRewardsVesting for CommunityRewardsVesting.Rewards;

  /* ========== STATE VARIABLES ========== */

  bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
  GoldfinchConfig public config;

  /// @notice Total rewards available for granting, denominated in `rewardsToken()`
  uint256 public rewardsAvailable;

  /// @dev NFT tokenId => rewards grant
  mapping(uint256 => CommunityRewardsVesting.Rewards) private grants;

  // solhint-disable-next-line func-name-mixedcase
  function __initialize__(address owner, GoldfinchConfig _config) external initializer {
    require(owner != address(0) && address(_config) != address(0), "Owner and config addresses cannot be empty");

    __Context_init_unchained();
    __ERC165_init_unchained();
    __ERC721_init_unchained("Goldfinch V2 Community Rewards Tokens", "GFI-V2-CR");
    __ERC721Pausable_init_unchained();
    __AccessControl_init_unchained();
    __Pausable_init_unchained();
    __ReentrancyGuard_init_unchained();

    _setupRole(OWNER_ROLE, owner);
    _setupRole(PAUSER_ROLE, owner);

    _setRoleAdmin(PAUSER_ROLE, OWNER_ROLE);
    _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);

    config = _config;
  }

  /* ========== VIEWS ========== */

  /// @notice The address of the token being disbursed as rewards
  function rewardsToken() public view returns (IERC20withDec) {
    return config.getGFI();
  }

  /// @notice Returns the rewards claimable by a given grant token, taking into
  ///   account vesting schedule.
  /// @return rewards Amount of rewards denominated in `rewardsToken().decimals()`
  function claimableRewards(uint256 tokenId) internal view returns (uint256 rewards) {
    return grants[tokenId].claimable();
  }

  /* ========== MUTATIVE, ADMIN-ONLY FUNCTIONS ========== */

  /// @notice Grant rewards to a recipient. The recipient address receives an
  ///   an NFT representing their rewards grant. They can present the NFT to `getReward()`
  ///   to claim their rewards. Rewards vest over a schedule.
  /// @param recipient The recipient of the grant
  /// @param amount The amount of `rewardsToken()` to grant
  /// @param vestingLength The duration over which the grant vests
  /// @param cliffLength The duration from the start of the grant, before which has elapsed
  /// the vested amount remains 0
  function grant(
    address recipient,
    uint256 amount,
    uint256 vestingLength,
    uint256 cliffLength
  ) external nonReentrant whenNotPaused onlyAdmin {
    _grant(recipient, amount, vestingLength, cliffLength);
  }

  function _grant(
    address recipient,
    uint256 amount,
    uint256 vestingLength,
    uint256 cliffLength
  ) internal {
    require(amount > 0, "Cannot grant 0 amount");
    require(cliffLength <= vestingLength, "Cliff length cannot exceed vesting length");
    require(amount <= rewardsAvailable, "Cannot grant amount due to insufficient funds");

    rewardsAvailable = rewardsAvailable.sub(amount);

    _tokenIdTracker.increment();
    uint256 tokenId = _tokenIdTracker.current();

    grants[tokenId] = CommunityRewardsVesting.Rewards({
      totalGranted: amount,
      totalClaimed: 0,
      startTime: block.timestamp,
      endTime: block.timestamp.add(vestingLength),
      cliffLength: cliffLength
    });
    _mint(recipient, tokenId);

    emit Granted(recipient, tokenId, amount, vestingLength, cliffLength);
  }

  /// @notice Transfer rewards from msg.sender, to be used for reward distribution
  function loadRewards(uint256 rewards) external onlyAdmin {
    rewardsToken().safeTransferFrom(msg.sender, address(this), rewards);
    rewardsAvailable = rewardsAvailable.add(rewards);
    emit RewardAdded(rewards);
  }

  /* ========== MUTATIVE, NON-ADMIN-ONLY FUNCTIONS ========== */

  /// @notice Claim rewards for a given grant
  /// @param tokenId A grant token ID
  function getReward(uint256 tokenId) external nonReentrant whenNotPaused {
    require(ownerOf(tokenId) == msg.sender, "access denied");
    uint256 reward = claimableRewards(tokenId);
    if (reward > 0) {
      grants[tokenId].claim(reward);
      rewardsToken().safeTransfer(msg.sender, reward);
      emit RewardPaid(msg.sender, tokenId, reward);
    }
  }

  /* ========== MODIFIERS ========== */

  function isAdmin() public view returns (bool) {
    return hasRole(OWNER_ROLE, _msgSender());
  }

  modifier onlyAdmin() {
    require(isAdmin(), "Must have admin role to perform this action");
    _;
  }

  /* ========== EVENTS ========== */

  event RewardAdded(uint256 reward);
  event Granted(
    address indexed user,
    uint256 indexed tokenId,
    uint256 amount,
    uint256 vestingLength,
    uint256 cliffLength
  );
  event RewardPaid(address indexed user, uint256 indexed tokenId, uint256 reward);
}
