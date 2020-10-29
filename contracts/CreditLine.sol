// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;
pragma experimental ABIEncoderV2;

import "./GoldfinchConfig.sol";
import "./BaseUpgradeablePausable.sol";
import "./interfaces/IERC20withDec.sol";

// solhint-disable-next-line max-states-count
contract CreditLine is BaseUpgradeablePausable {
  // Credit line terms
  address public borrower;
  address public underwriter;
  uint256 public collateral;
  uint256 public limit;
  uint256 public interestApr;
  uint256 public minCollateralPercent;
  uint256 public paymentPeriodInDays;
  uint256 public termInDays;

  // Accounting variables
  uint256 public balance;
  uint256 public interestOwed;
  uint256 public principalOwed;
  uint256 public collectedPaymentBalance;
  uint256 public collateralBalance;
  uint256 public termEndBlock;
  uint256 public nextDueBlock;
  uint256 public lastUpdatedBlock;

  function initialize(
    address owner,
    address _borrower,
    address _underwriter,
    uint256 _limit,
    uint256 _interestApr,
    uint256 _minCollateralPercent,
    uint256 _paymentPeriodInDays,
    uint256 _termInDays
  ) public initializer {
    __BaseUpgradeablePausable__init(owner);
    borrower = _borrower;
    underwriter = _underwriter;
    limit = _limit;
    interestApr = _interestApr;
    minCollateralPercent = _minCollateralPercent;
    paymentPeriodInDays = _paymentPeriodInDays;
    termInDays = _termInDays;
    lastUpdatedBlock = block.number;
  }

  function setTermEndBlock(uint256 newTermEndBlock) external onlyAdmin returns (uint256) {
    return termEndBlock = newTermEndBlock;
  }

  function setNextDueBlock(uint256 newNextDueBlock) external onlyAdmin returns (uint256) {
    return nextDueBlock = newNextDueBlock;
  }

  function setBalance(uint256 newBalance) external onlyAdmin returns (uint256) {
    return balance = newBalance;
  }

  function setInterestOwed(uint256 newInterestOwed) external onlyAdmin returns (uint256) {
    return interestOwed = newInterestOwed;
  }

  function setPrincipalOwed(uint256 newPrincipalOwed) external onlyAdmin returns (uint256) {
    return principalOwed = newPrincipalOwed;
  }

  function setCollectedPaymentBalance(uint256 newCollectedPaymentBalance) external onlyAdmin returns (uint256) {
    return collectedPaymentBalance = newCollectedPaymentBalance;
  }

  function setCollateralBalance(uint256 newCollateralBalance) external onlyAdmin returns (uint256) {
    return collateralBalance = newCollateralBalance;
  }

  function setLastUpdatedBlock(uint256 newLastUpdatedBlock) external onlyAdmin returns (uint256) {
    return lastUpdatedBlock = newLastUpdatedBlock;
  }

  function setLimit(uint256 newAmount) external onlyAdminOrUnderwriter returns (uint256) {
    return limit = newAmount;
  }

  function authorizePool(address configAddress) external onlyAdmin {
    GoldfinchConfig config = GoldfinchConfig(configAddress);
    address poolAddress = config.getAddress(uint256(ConfigOptions.Addresses.Pool));
    address usdcAddress = config.getAddress(uint256(ConfigOptions.Addresses.USDC));
    // Approve the pool for an infinite amount
    IERC20withDec(usdcAddress).approve(poolAddress, uint256(-1));
  }

  modifier onlyAdminOrUnderwriter() {
    require(isAdmin() || _msgSender() == underwriter, "Restricted to owner or underwriter");
    _;
  }
}
