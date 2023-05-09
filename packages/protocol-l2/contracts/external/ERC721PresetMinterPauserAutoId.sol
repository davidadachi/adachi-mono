// SPDX-License-Identifier: MIT
// solhint-disable
/*
  This is copied from OZ preset: https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/release-v3.0.0/contracts/presets/ERC721PresetMinterPauserAutoId.sol
  Alterations:
   * Make the counter public, so that we can use it in our custom mint function
   * Removed ERC721Burnable parent contract, but added our own custom burn function.
   * Removed original "mint" function, because we have a custom one.
   * Removed default initialization functions, because they set msg.sender as the owner, which
     we do not want, because we use a deployer account, which is separate from the protocol owner.
*/

pragma solidity ^0.8.19;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";
import {ERC721PausableUpgradeable, ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721PausableUpgradeable.sol";
import {ERC721EnumerableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @dev {ERC721} token, including:
 *
 *  - ability for holders to burn (destroy) their tokens
 *  - a minter role that allows for token minting (creation)
 *  - a pauser role that allows to stop all token transfers
 *  - token ID and URI autogeneration
 *
 * This contract uses {AccessControl} to lock permissioned functions using the
 * different roles - head to its documentation for details.
 *
 * The account that deploys the contract will be granted the minter and pauser
 * roles, as well as the default admin role, which will let it grant both minter
 * and pauser roles to aother accounts
 */
contract ERC721PresetMinterPauserAutoIdUpgradeSafe is
  Initializable,
  AccessControlUpgradeable,
  ERC721PausableUpgradeable,
  ERC721EnumerableUpgradeable
{
  using Counters for Counters.Counter;

  bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
  bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

  Counters.Counter public _tokenIdTracker;

  /**
   * @dev Pauses all token transfers.
   *
   * See {ERC721Pausable} and {Pausable-_pause}.
   *
   * Requirements:
   *
   * - the caller must have the `PAUSER_ROLE`.
   */
  function pause() public {
    require(
      hasRole(PAUSER_ROLE, _msgSender()),
      "ERC721PresetMinterPauserAutoId: must have pauser role to pause"
    );
    _pause();
  }

  /**
   * @dev Unpauses all token transfers.
   *
   * See {ERC721Pausable} and {Pausable-_unpause}.
   *
   * Requirements:
   *
   * - the caller must have the `PAUSER_ROLE`.
   */
  function unpause() public {
    require(
      hasRole(PAUSER_ROLE, _msgSender()),
      "ERC721PresetMinterPauserAutoId: must have pauser role to unpause"
    );
    _unpause();
  }

  function supportsInterface(
    bytes4 interfaceId
  )
    public
    view
    virtual
    override(AccessControlUpgradeable, ERC721Upgradeable, ERC721EnumerableUpgradeable)
    returns (bool)
  {
    return
      AccessControlUpgradeable.supportsInterface(interfaceId) ||
      ERC721Upgradeable.supportsInterface(interfaceId) ||
      ERC721EnumerableUpgradeable.supportsInterface(interfaceId);
  }

  function _beforeTokenTransfer(
    address from,
    address to,
    uint256 tokenId,
    uint256 amount
  ) internal virtual override(ERC721PausableUpgradeable, ERC721EnumerableUpgradeable) {
    super._beforeTokenTransfer(from, to, tokenId, amount);
  }

  uint256[49] private __gap;
}
