import { Resolvers } from "@apollo/client";
import { BigNumber } from "ethers";

import { BORROWER_METADATA, POOL_METADATA } from "@/constants";
import { getContract } from "@/lib/contracts";
import { getProvider } from "@/lib/wallet";

import { CallableLoan } from "../generated";

const loanDueAmount = async (
  callableLoanId: string,
  repaymentDurationType: "period" | "term"
) => {
  const provider = await getProvider();
  const callableLoanContract = await getContract({
    name: "CallableLoan",
    provider,
    useSigner: false,
    address: callableLoanId,
  });

  // Loan has not started
  const termEndTime = await callableLoanContract.termEndTime();
  if (termEndTime.eq(0)) {
    return {
      interestOwed: BigNumber.from(0),
      principalOwed: BigNumber.from(0),
    };
  }

  const isLate = await isCallableLoanLate(callableLoanId);
  if (isLate) {
    const [interestOwed, interestAccrued, principalOwed] = await Promise.all([
      callableLoanContract.interestOwed(),
      callableLoanContract.interestAccrued(),
      callableLoanContract.principalOwed(),
    ]);
    return { interestOwed: interestOwed.add(interestAccrued), principalOwed };
  }

  let owedAtTimestamp = termEndTime;
  const lastFullPaymentTime = await callableLoanContract.lastFullPaymentTime();
  if (repaymentDurationType === "period") {
    owedAtTimestamp = await callableLoanContract.nextDueTimeAt(
      lastFullPaymentTime
    );
  }

  const [interestOwed, interestAccrued, principalOwed] = await Promise.all([
    callableLoanContract.interestOwedAt(owedAtTimestamp),
    callableLoanContract.interestAccruedAt(owedAtTimestamp),
    callableLoanContract.principalOwedAt(owedAtTimestamp),
  ]);

  return { interestOwed: interestOwed.add(interestAccrued), principalOwed };
};

const isCallableLoanLate = async (callableLoanId: string) => {
  const provider = await getProvider();
  const callableLoanContract = await getContract({
    name: "CallableLoan",
    provider,
    useSigner: false,
    address: callableLoanId,
  });
  const lastFullPaymentTime = await callableLoanContract.lastFullPaymentTime();
  if (lastFullPaymentTime.isZero()) {
    // Brand new creditline
    return false;
  }

  const [currentBlock, nextDueTime] = await Promise.all([
    provider.getBlock("latest"),
    callableLoanContract.nextDueTimeAt(lastFullPaymentTime),
  ]);

  return currentBlock.timestamp > nextDueTime.toNumber();
};

export const callableLoanResolvers: Resolvers[string] = {
  name(callableLoan: CallableLoan) {
    return (
      POOL_METADATA[callableLoan.id as keyof typeof POOL_METADATA]?.name ??
      `Pool ${callableLoan.id}`
    );
  },
  borrowerName(callableLoan: CallableLoan) {
    const borrowerId =
      POOL_METADATA[callableLoan.id as keyof typeof POOL_METADATA]?.borrower;
    if (borrowerId) {
      const borrower =
        BORROWER_METADATA[borrowerId as keyof typeof BORROWER_METADATA];
      if (borrower) {
        return borrower.name;
      }
    }
    return "Borrower";
  },
  borrowerLogo(callableLoan: CallableLoan) {
    const borrowerId =
      POOL_METADATA[callableLoan.id as keyof typeof POOL_METADATA]?.borrower;
    if (borrowerId) {
      const borrower =
        BORROWER_METADATA[borrowerId as keyof typeof BORROWER_METADATA];
      if (borrower) {
        return borrower.logo;
      }
    }
    return null;
  },
  // TODO: Zadra update naming??
  async isLate(callableLoan: CallableLoan): Promise<boolean> {
    return isCallableLoanLate(callableLoan.id);
  },
  async isInDefault(callableLoan: CallableLoan): Promise<boolean> {
    const provider = await getProvider();
    const callableLoanContract = await getContract({
      name: "CallableLoan",
      provider,
      useSigner: false,
      address: callableLoan.id,
    });
    const termStartTime = await callableLoanContract.termStartTime();
    const withinPrincipalGracePeriod =
      await callableLoanContract.withinPrincipalGracePeriod();
    return !termStartTime.isZero() && !withinPrincipalGracePeriod;
  },
  async isAfterTermEndTime(callableLoan: CallableLoan): Promise<boolean> {
    const provider = await getProvider();
    const callableLoanContract = await getContract({
      name: "CallableLoan",
      provider,
      useSigner: false,
      address: callableLoan.id,
    });

    const [currentBlock, termEndTime] = await Promise.all([
      provider.getBlock("latest"),
      callableLoanContract.termEndTime(),
    ]);

    return termEndTime.gt(0) && currentBlock.timestamp > termEndTime.toNumber();
  },
  // TODO: Zadra round up to end of day logic since interest is accrued every second
  async periodInterestDueAmount(
    callableLoan: CallableLoan
  ): Promise<BigNumber> {
    const { interestOwed } = await loanDueAmount(callableLoan.id, "period");
    return interestOwed;
  },
  async periodPrincipalDueAmount(
    callableLoan: CallableLoan
  ): Promise<BigNumber> {
    const { principalOwed } = await loanDueAmount(callableLoan.id, "period");
    return principalOwed;
  },
  async termTotalDueAmount(callableLoan: CallableLoan): Promise<BigNumber> {
    const { interestOwed, principalOwed } = await loanDueAmount(
      callableLoan.id,
      "term"
    );
    return interestOwed.add(principalOwed);
  },
  async nextDueTime(callableLoan: CallableLoan): Promise<BigNumber> {
    const provider = await getProvider();
    const callableLoanContract = await getContract({
      name: "CallableLoan",
      provider,
      useSigner: false,
      address: callableLoan.id,
    });

    const lastFullPaymentTime =
      await callableLoanContract.lastFullPaymentTime();
    return callableLoanContract.nextDueTimeAt(lastFullPaymentTime);
  },
};
