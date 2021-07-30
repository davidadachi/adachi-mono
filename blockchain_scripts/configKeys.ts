const CONFIG_KEYS = {
  // Numbers
  TransactionLimit: 0,
  TotalFundsLimit: 1,
  MaxUnderwriterLimit: 2,
  ReserveDenominator: 3,
  WithdrawFeeDenominator: 4,
  LatenessGracePeriodInDays: 5,
  LatenessMaxDays: 6,
  DrawdownPeriodInSeconds: 7,
  TransferPeriodRestrictionInDays: 8,
  LeverageRatio: 9,
  // Addresses
  Pool: 0,
  CreditLineImplementation: 1,
  GoldfinchFactory: 2,
  CreditDesk: 3,
  Fidu: 4,
  USDC: 5,
  TreasuryReserve: 6,
  ProtocolAdmin: 7,
  OneInch: 8,
  TrustedForwarder: 9,
  CUSDCContract: 10,
  GoldfinchConfig: 11,
  PoolTokens: 12,
  TranchedPoolImplementation: 13,
  SeniorPool: 14,
  SeniorPoolStrategy: 15,
  MigratedTranchedPoolImplementation: 16,
  BorrowerImplementation: 17,
}

export {CONFIG_KEYS}
