**Deployment on Ethereum mainnet: **https://etherscan.io/address/0x71cfF40A44051C6e6311413A728EE7633dDC901a

## FixedLeverageRatioStrategy

### config

```solidity
contract GoldfinchConfig config
```

### GoldfinchConfigUpdated

```solidity
event GoldfinchConfigUpdated(address who, address configAddress)
```

### initialize

```solidity
function initialize(address owner, contract GoldfinchConfig _config) public
```

### updateGoldfinchConfig

```solidity
function updateGoldfinchConfig() external
```

### getLeverageRatio

```solidity
function getLeverageRatio(contract ITranchedPool pool) public view returns (uint256)
```

