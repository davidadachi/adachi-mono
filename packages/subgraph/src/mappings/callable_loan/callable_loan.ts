import {CallableLoan} from "../../../generated/schema"
import {
  CallableLoan as CallableLoanContract,
  DepositMade,
  DrawdownMade,
} from "../../../generated/templates/CallableLoan/CallableLoan"
import {getOrInitUser} from "../../entities/user"
import {deleteCallableLoanRepaymentSchedule, generateRepaymentScheduleForCallableLoan} from "./helpers"

export function handleDepositMade(event: DepositMade): void {
  const callableLoan = assert(CallableLoan.load(event.address.toHexString()))
  callableLoan.totalDeposited = callableLoan.totalDeposited.plus(event.params.amount)
  const user = getOrInitUser(event.params.owner)
  callableLoan.backers = callableLoan.backers.concat([user.id])
  callableLoan.numBackers = callableLoan.backers.length
  callableLoan.save()
}

export function handleDrawdownMade(event: DrawdownMade): void {
  const callableLoan = assert(CallableLoan.load(event.address.toHexString()))
  const callableLoanContract = CallableLoanContract.bind(event.address)
  callableLoan.principalAmount = event.params.amount
  callableLoan.termStartTime = callableLoanContract.termStartTime()
  callableLoan.termEndTime = callableLoanContract.termEndTime()
  deleteCallableLoanRepaymentSchedule(callableLoan)
  callableLoan.repaymentSchedule = generateRepaymentScheduleForCallableLoan(callableLoan)
  callableLoan.save()
}
