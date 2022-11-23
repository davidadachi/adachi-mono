# StakedFiduAsset

## External View Functions

### `isType`

### `isValid`
- Only returns true if a given position is a staked fidu position

### `getUsdcEquivalent`
- ℹ️ Does not take into account appreciation or depreciation of underlying FIDU.
  In the case of interest returning to the senior pool, the owner of the position
  will not benefit from the larger amount of capital unless they withdraw and
  redeposit. Similarly, in the case of a default, the owner will not be penalized
  by a smaller amount of capital unless they withdraw and deposit.