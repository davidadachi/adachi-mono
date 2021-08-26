// Based on https://github.com/OpenZeppelin/defender-example-metatx-relay
// Updated to use the GSN v2 Forwarder contracts

const {ethers} = require("ethers")

const GenericParams = "address from,address to,uint256 value,uint256 gas,uint256 nonce,bytes data"
const TypeName = `ForwardRequest(${GenericParams})`
const TypeHash = ethers.utils.id(TypeName)

async function relay(request, context) {
  const {forwarder, relayTx, allowed_senders, allowed_contracts, domain_separator} = context
  // Unpack request
  const {to, from, value, gas, nonce, data, signature} = request

  // Validate request
  const SuffixData = "0x"
  const args = [{to, from, value, gas, nonce, data}, domain_separator, TypeHash, SuffixData, signature]

  if (!allowed_senders.includes(from)) {
    throw new Error(`Unrecognized sender: ${from}`)
  }

  // This verifies the unpacked message matches the signature and therefore validates that the to/from/data passed in
  // was actually signed by the whitelisted sender
  await forwarder.verify(...args)

  // Send meta-tx through Defender
  const forwardData = forwarder.interface.encodeFunctionData("execute", args)

  const tx = await relayTx({
    speed: "fast",
    to: forwarder.address,
    gasLimit: gas,
    data: forwardData,
  })

  console.log(`Sent meta-tx: ${tx.hash} on behalf of ${from}, data: ${forwardData}`)
  return tx
}

module.exports = {relay}
