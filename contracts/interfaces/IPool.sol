// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

abstract contract IPool {
  uint256 public sharePrice;

  function deposit(uint256 amount) external virtual;

  function withdraw(uint256 amount) external virtual;

  function collectInterestRepayment(address from, uint256 amount) external virtual;

  function collectPrincipalRepayment(address from, uint256 amount) external virtual;

  function transferFrom(
    address from,
    address to,
    uint256 amount
  ) public virtual returns (bool);
}
