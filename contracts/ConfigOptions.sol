// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

library ConfigOptions {
  // NEVER EVER CHANGE THE ORDER OF THESE!
  // You can rename or append. But NEVER change the order.
  enum Numbers {TransactionLimit, TotalFundsLimit, MaxUnderwriterLimit}
  enum Addresses {Pool, CreditLineImplementation, CreditLineFactory, CreditDesk, Fidu, USDC}

  function getNumberName(uint256 number) public pure returns (string memory) {
    Numbers numberName = Numbers(number);
    if (Numbers.TransactionLimit == numberName) {
      return "TransactionLimit";
    }
    if (Numbers.TotalFundsLimit == numberName) {
      return "TotalFundsLimit";
    }
    if (Numbers.MaxUnderwriterLimit == numberName) {
      return "MaxUnderwriterLimit";
    }
    revert("Unknown value passed to getNumberName");
  }

  function getAddressName(uint256 addressKey) public pure returns (string memory) {
    Addresses addressName = Addresses(addressKey);
    if (Addresses.Pool == addressName) {
      return "Pool";
    }
    if (Addresses.CreditLineImplementation == addressName) {
      return "CreditLineImplementation";
    }
    if (Addresses.CreditLineFactory == addressName) {
      return "CreditLineFactory";
    }
    if (Addresses.CreditDesk == addressName) {
      return "CreditDesk";
    }
    if (Addresses.Fidu == addressName) {
      return "Fidu";
    }
    if (Addresses.USDC == addressName) {
      return "USDC";
    }
    revert("Unknown value passed to getAddressName");
  }
}
