// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

interface IPoolTokens {
  event TokenMinted(
    address indexed owner,
    address indexed pool,
    uint256 indexed tokenId,
    uint256 amount,
    uint256 tranche
  );

  event TokenRedeemed(
    address indexed owner,
    address indexed pool,
    uint256 indexed tokenId,
    uint256 principalRedeemed,
    uint256 interestRedeemed,
    uint256 tranche
  );
  event TokenBurned(address indexed owner, address indexed pool, uint256 indexed tokenId);

  struct TokenInfo {
    address pool;
    uint256 tranche;
    uint256 principalAmount;
    uint256 principalRedeemed;
    uint256 interestRedeemed;
  }

  struct MintParams {
    uint256 principalAmount;
    uint256 tranche;
  }

  function mint(MintParams calldata params, address to) external;

  function redeem(
    uint256 tokenId,
    uint256 principalRedeemed,
    uint256 interestRedeemed
  ) external;

  function burn(uint256 tokenId) external;

  function getTokenInfo(uint256 tokenId) external view returns (TokenInfo memory);
}
