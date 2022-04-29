## GoldfinchConfig

This contract stores mappings of useful &quot;protocol config state&quot;, giving a central place
 for all other contracts to access it. For example, the TransactionLimit, or the PoolAddress. These config vars
 are enumerated in the &#x60;ConfigOptions&#x60; library, and can only be changed by admins of the protocol.
 Note: While this inherits from BaseUpgradeablePausable, it is not deployed as an upgradeable contract (this
   is mostly to save gas costs of having each call go through a proxy)

### GO_LISTER_ROLE

```solidity
bytes32 GO_LISTER_ROLE
```

### addresses

```solidity
mapping(uint256 &#x3D;&gt; address) addresses
```

### numbers

```solidity
mapping(uint256 &#x3D;&gt; uint256) numbers
```

### goList

```solidity
mapping(address &#x3D;&gt; bool) goList
```

### AddressUpdated

```solidity
event AddressUpdated(address owner, uint256 index, address oldValue, address newValue)
```

### NumberUpdated

```solidity
event NumberUpdated(address owner, uint256 index, uint256 oldValue, uint256 newValue)
```

### GoListed

```solidity
event GoListed(address member)
```

### NoListed

```solidity
event NoListed(address member)
```

### valuesInitialized

```solidity
bool valuesInitialized
```

### initialize

```solidity
function initialize(address owner) public
```

### setAddress

```solidity
function setAddress(uint256 addressIndex, address newAddress) public
```

### setNumber

```solidity
function setNumber(uint256 index, uint256 newNumber) public
```

### setTreasuryReserve

```solidity
function setTreasuryReserve(address newTreasuryReserve) public
```

### setSeniorPoolStrategy

```solidity
function setSeniorPoolStrategy(address newStrategy) public
```

### setCreditLineImplementation

```solidity
function setCreditLineImplementation(address newAddress) public
```

### setTranchedPoolImplementation

```solidity
function setTranchedPoolImplementation(address newAddress) public
```

### setBorrowerImplementation

```solidity
function setBorrowerImplementation(address newAddress) public
```

### setGoldfinchConfig

```solidity
function setGoldfinchConfig(address newAddress) public
```

### initializeFromOtherConfig

```solidity
function initializeFromOtherConfig(address _initialConfig, uint256 numbersLength, uint256 addressesLength) public
```

### addToGoList

```solidity
function addToGoList(address _member) public
```

_Adds a user to go-list_

| Name | Type | Description |
| ---- | ---- | ----------- |
| _member | address | address to add to go-list |

### removeFromGoList

```solidity
function removeFromGoList(address _member) public
```

_removes a user from go-list_

| Name | Type | Description |
| ---- | ---- | ----------- |
| _member | address | address to remove from go-list |

### bulkAddToGoList

```solidity
function bulkAddToGoList(address[] _members) external
```

_adds many users to go-list at once_

| Name | Type | Description |
| ---- | ---- | ----------- |
| _members | address[] | addresses to ad to go-list |

### bulkRemoveFromGoList

```solidity
function bulkRemoveFromGoList(address[] _members) external
```

_removes many users from go-list at once_

| Name | Type | Description |
| ---- | ---- | ----------- |
| _members | address[] | addresses to remove from go-list |

### getAddress

```solidity
function getAddress(uint256 index) public view returns (address)
```

### getNumber

```solidity
function getNumber(uint256 index) public view returns (uint256)
```

### onlyGoListerRole

```solidity
modifier onlyGoListerRole()
```

