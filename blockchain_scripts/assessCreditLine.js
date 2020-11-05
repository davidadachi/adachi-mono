/* globals ethers */
const bre = require("@nomiclabs/buidler")
const {deployments, getNamedAccounts} = bre
const {getDeployedContract} = require("../blockchain_scripts/deployHelpers.js")

async function main() {
  const {protocolOwner} = await getNamedAccounts()
  const creditDesk = await getDeployedContract(deployments, "CreditDesk", protocolOwner)
  const creditLine = process.env.CREDIT_LINE
  if (!creditLine) {
    throw new Error("No creditLine provided. Please run again, passing creditLine as BORROWER={{creditLine_address}}")
  }

  await assessCreditLine(creditDesk, creditLine)
}

async function assessCreditLine(creditDesk, creditLineAddress, logger = console.log) {
  logger("Attempting to assess the credit line...")
  const creditLine = await ethers.getContractAt("CreditLine", creditLineAddress)

  let balance = await creditLine.balance()
  let interestOwed = await creditLine.interestOwed()
  let principalOwed = await creditLine.principalOwed()
  let collectedPaymentBalance = await creditLine.collectedPaymentBalance()
  let termEndBlock = await creditLine.termEndBlock()
  let nextDueBlock = await creditLine.nextDueBlock()
  let lastUpdatedBlock = await creditLine.lastUpdatedBlock()

  logger("Credit line vars before assessment:")
  logger("balance:", String(balance))
  logger("interestOwed:", String(interestOwed))
  logger("principalOwed:", String(principalOwed))
  logger("collectedPaymentBalance:", String(collectedPaymentBalance))
  logger("termEndBlock:", String(termEndBlock))
  logger("nextDueBlock:", String(nextDueBlock))
  logger("lastUpdatedBlock:", String(lastUpdatedBlock))

  await creditDesk.assessCreditLine(creditLineAddress)
  logger("Credit line has been assessed")

  balance = await creditLine.balance()
  interestOwed = await creditLine.interestOwed()
  principalOwed = await creditLine.principalOwed()
  collectedPaymentBalance = await creditLine.collectedPaymentBalance()
  termEndBlock = await creditLine.termEndBlock()
  nextDueBlock = await creditLine.nextDueBlock()
  lastUpdatedBlock = await creditLine.lastUpdatedBlock()
  logger("After assessment:")
  logger("balance:", String(balance))
  logger("interestOwed:", String(interestOwed))
  logger("principalOwed:", String(principalOwed))
  logger("collectedPaymentBalance:", String(collectedPaymentBalance))
  logger("termEndBlock:", String(termEndBlock))
  logger("nextDueBlock:", String(nextDueBlock))
  logger("lastUpdatedBlock:", String(lastUpdatedBlock))
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

module.exports = assessCreditLine
