// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";

import "./BaseUpgradeablePausable.sol";
import "./ConfigHelper.sol";
import "../../interfaces/IGo.sol";
import "../../interfaces/IUniqueIdentity0612.sol";

contract Go is IGo, BaseUpgradeablePausable {
  address public override uniqueIdentity;
  uint256[11] public allIdTypes = [
    ID_TYPE_0,
    ID_TYPE_1,
    ID_TYPE_2,
    ID_TYPE_3,
    ID_TYPE_4,
    ID_TYPE_5,
    ID_TYPE_6,
    ID_TYPE_7,
    ID_TYPE_8,
    ID_TYPE_9,
    ID_TYPE_10
  ];

  using SafeMath for uint256;

  GoldfinchConfig public config;
  using ConfigHelper for GoldfinchConfig;

  event GoldfinchConfigUpdated(address indexed who, address configAddress);

  function initialize(
    address owner,
    GoldfinchConfig _config,
    address _uniqueIdentity
  ) public initializer {
    require(
      owner != address(0) && address(_config) != address(0) && _uniqueIdentity != address(0),
      "Owner and config and UniqueIdentity addresses cannot be empty"
    );
    __BaseUpgradeablePausable__init(owner);
    config = _config;
    uniqueIdentity = _uniqueIdentity;
  }

  function updateGoldfinchConfig() public override onlyAdmin {
    config = GoldfinchConfig(config.configAddress());
    emit GoldfinchConfigUpdated(msg.sender, address(config));
  }

  /**
   * @notice Returns whether the provided account is go-listed for use of the Goldfinch protocol
   * for any of the UID token types.
   * This status is defined as: whether `balanceOf(account, id)` on the UniqueIdentity
   * contract is non-zero (where `id` is a supported token id on UniqueIdentity), falling back to the
   * account's status on the legacy go-list maintained on GoldfinchConfig.
   * @param account The account whose go status to obtain
   * @return The account's go status
   */
  function go(address account) public view override returns (bool) {
    require(account != address(0), "Zero address is not go-listed");
    for (uint256 i = 0; i < allIdTypes.length; ++i) {
      uint256 idTypeBalance = IUniqueIdentity0612(uniqueIdentity).balanceOf(account, allIdTypes[i]);
      if (idTypeBalance > 0) {
        return true;
      }
    }
    return config.goList(account);
  }

  /**
   * @notice Returns whether the provided account is go-listed for use of the Goldfinch protocol
   * for defined UID token types
   * @param account The account whose go status to obtain
   * @param onlyIdTypes Array of id types to check balances
   * @return The account's go status
   */
  function goOnlyIdTypes(address account, uint256[] memory onlyIdTypes) public view override returns (bool) {
    require(account != address(0), "Zero address is not go-listed");
    for (uint256 i = 0; i < onlyIdTypes.length; ++i) {
      uint256 idTypeBalance = IUniqueIdentity0612(uniqueIdentity).balanceOf(account, onlyIdTypes[i]);
      if (idTypeBalance > 0) {
        return true;
      }
    }
    return config.goList(account);
  }

  /**
   * @notice Returns whether the provided account is go-listed for use of the SeniorPool on the Goldfinch protocol.
   * @param account The account whose go status to obtain
   * @return The account's go status
   */
  function goSeniorPool(address account) public view override returns (bool) {
    require(account != address(0), "Zero address is not go-listed");
    uint256[2] memory seniorPoolIdTypes = [ID_TYPE_0, ID_TYPE_1];
    for (uint256 i = 0; i < seniorPoolIdTypes.length; ++i) {
      uint256 idTypeBalance = IUniqueIdentity0612(uniqueIdentity).balanceOf(account, seniorPoolIdTypes[i]);
      if (idTypeBalance > 0) {
        return true;
      }
    }
    return config.goList(account);
  }
}
