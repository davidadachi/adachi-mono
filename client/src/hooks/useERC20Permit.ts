import {BigNumber} from "bignumber.js"
import {AppContext} from "../App"
import {ERC20} from "../ethereum/erc20"
import {IERC20Permit} from "../typechain/web3/IERC20Permit"
import ERC20PermitABI from "../../abi/ERC20Permit.json"
import useNonNullContext from "./useNonNullContext"
import web3 from "../web3"
import {ethers} from "ethers"
import {splitSignature} from "ethers/utils"
import {secondsSinceEpoch} from "../utils"

interface SignatureData {
  v: number
  r: string
  s: string
  deadline: string
  nonce: string
  owner: string
  spender: string
  chainId: string
  tokenAddress: string
  value: string
}

const EIP712_DOMAIN_TYPE = [
  {name: "name", type: "string"},
  {name: "version", type: "string"},
  {name: "chainId", type: "uint256"},
  {name: "verifyingContract", type: "address"},
]

const EIP2612_TYPE = [
  {name: "owner", type: "address"},
  {name: "spender", type: "address"},
  {name: "value", type: "uint256"},
  {name: "nonce", type: "uint256"},
  {name: "deadline", type: "uint256"},
]

export default function useERC20Permit(): {
  gatherPermitSignature: ({
    token,
    value,
    spender,
  }: {
    token: ERC20
    value: BigNumber
    spender: string
  }) => Promise<SignatureData>
} {
  const {goldfinchProtocol, user} = useNonNullContext(AppContext)
  const owner = user.address

  async function gatherPermitSignature({token, value, spender}: {token: ERC20; value: BigNumber; spender: string}) {
    const tokenAddress = token.address
    const contract = goldfinchProtocol.getContract<IERC20Permit>(ERC20PermitABI, tokenAddress)
    const deadline = new BigNumber(secondsSinceEpoch()).plus(new BigNumber(60 * 60)) // 1 hour
    const nonce = await contract.methods.nonces(owner).call()
    const chainId = await web3.eth.getChainId()
    const message = {
      owner,
      spender,
      value,
      nonce,
      deadline: deadline.toString(),
    }
    const domain = {
      name: token.ticker,
      version: token.permitVersion,
      verifyingContract: tokenAddress,
      chainId: chainId,
    }

    const data = JSON.stringify({
      types: {
        EIP712Domain: EIP712_DOMAIN_TYPE,
        Permit: EIP2612_TYPE,
      },
      domain,
      primaryType: "Permit",
      message,
    })

    const provider = new ethers.providers.Web3Provider(web3.currentProvider as any)
    const signature = await provider.send("eth_signTypedData_v4", [owner, data]).then(splitSignature)
    return {
      v: signature.v!,
      r: signature.r,
      s: signature.s,
      deadline: deadline.toString(),
      nonce: nonce!,
      owner,
      spender,
      chainId: chainId.toString(),
      tokenAddress,
      value: value.toString(),
    }
  }

  return {
    gatherPermitSignature,
  }
}
