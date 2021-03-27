/* globals ethers */
const hre = require("hardhat")
const {getNamedAccounts} = hre

async function main() {
  const {protocol_owner} = await getNamedAccounts()
  const amountToSend = process.env.AMOUNT_TO_SEND
  await sendETH(amountToSend)

  async function sendETH(amountToSend) {
    const value = ethers.utils.parseEther(amountToSend)
    const tx = {
      to: protocol_owner,
      value: value,
      chainId: 1,
    }
    const wallet = new ethers.Wallet(process.env.MAINNET_PROXY_OWNER_KEY, ethers.getDefaultProvider())
    console.log("Sending transaction...", tx, "with value of", value)
    const txn = await wallet.sendTransaction(tx)
    console.log("Txn is:", txn, "now waiting...")
    await txn.wait()
  }
}

if (require.main === module) {
  // If this is run as a script, then call main. If it's imported (for tests), this block will not run
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}

module.exports = main
