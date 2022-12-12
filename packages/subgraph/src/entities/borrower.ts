import {Address} from "@graphprotocol/graph-ts"
import {BorrowerContract as Borrower} from "../../generated/schema"
import {getOrInitUser} from "./user"

export function getOrInitBorrower(borrowerAddress: Address, owner: Address): Borrower {
  let borrower = Borrower.load(borrowerAddress.toHexString())
  if (!borrower) {
    borrower = new Borrower(borrowerAddress.toHexString())
    const user = getOrInitUser(owner)
    borrower.user = user.id
    borrower.save()
  }
  return borrower as Borrower
}
