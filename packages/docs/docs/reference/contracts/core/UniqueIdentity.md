**Deployment on Ethereum mainnet: **https://etherscan.io/address/0xba0439088dc1e75F58e0A7C107627942C15cbb41

## UniqueIdentity

UniqueIdentity is an ERC1155-compliant contract for representing
the identity verification status of addresses.

### SIGNER_ROLE

```solidity
bytes32 SIGNER_ROLE
```

### ID_TYPE_0

```solidity
uint256 ID_TYPE_0
```

### ID_TYPE_1

```solidity
uint256 ID_TYPE_1
```

### ID_TYPE_2

```solidity
uint256 ID_TYPE_2
```

### ID_TYPE_3

```solidity
uint256 ID_TYPE_3
```

### ID_TYPE_4

```solidity
uint256 ID_TYPE_4
```

### ID_TYPE_5

```solidity
uint256 ID_TYPE_5
```

### ID_TYPE_6

```solidity
uint256 ID_TYPE_6
```

### ID_TYPE_7

```solidity
uint256 ID_TYPE_7
```

### ID_TYPE_8

```solidity
uint256 ID_TYPE_8
```

### ID_TYPE_9

```solidity
uint256 ID_TYPE_9
```

### ID_TYPE_10

```solidity
uint256 ID_TYPE_10
```

### MINT_COST_PER_TOKEN

```solidity
uint256 MINT_COST_PER_TOKEN
```

### nonces

```solidity
mapping(address &#x3D;&gt; uint256) nonces
```

_We include a nonce in every hashed message, and increment the nonce as part of a
state-changing operation, so as to prevent replay attacks, i.e. the reuse of a signature._

### supportedUIDTypes

```solidity
mapping(uint256 &#x3D;&gt; bool) supportedUIDTypes
```

### initialize

```solidity
function initialize(address owner, string uri) public
```

### __UniqueIdentity_init

```solidity
function __UniqueIdentity_init(address owner) internal
```

### __UniqueIdentity_init_unchained

```solidity
function __UniqueIdentity_init_unchained(address owner) internal
```

### setSupportedUIDTypes

```solidity
function setSupportedUIDTypes(uint256[] ids, bool[] values) public
```

### name

```solidity
function name() public pure returns (string)
```

_Gets the token name._

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | string | string representing the token name |

### symbol

```solidity
function symbol() public pure returns (string)
```

_Gets the token symbol._

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | string | string representing the token symbol |

### mint

```solidity
function mint(uint256 id, uint256 expiresAt, bytes signature) public payable
```

### burn

```solidity
function burn(address account, uint256 id, uint256 expiresAt, bytes signature) public
```

### _beforeTokenTransfer

```solidity
function _beforeTokenTransfer(address operator, address from, address to, uint256[] ids, uint256[] amounts, bytes data) internal
```

_See {ERC1155-_beforeTokenTransfer}.

Requirements:

- the contract must not be paused._

### onlySigner

```solidity
modifier onlySigner(address account, uint256 id, uint256 expiresAt, bytes signature)
```

### incrementNonce

```solidity
modifier incrementNonce(address account)
```

