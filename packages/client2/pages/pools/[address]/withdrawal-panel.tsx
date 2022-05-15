import { gql, useApolloClient } from "@apollo/client";
import { BigNumber, utils } from "ethers";
import { useForm } from "react-hook-form";
import { toast } from "react-toastify";

import {
  Icon,
  Button,
  Input,
  Link,
  HelperText,
} from "@/components/design-system";
import { USDC_DECIMALS } from "@/constants";
import { useTranchedPoolContract } from "@/lib/contracts";
import { formatCrypto } from "@/lib/format";
import {
  WithdrawalPanelPoolTokenFieldsFragment,
  SupportedCrypto,
} from "@/lib/graphql/generated";
import { waitForSubgraphBlock } from "@/lib/utils";

export const WITHDRAWAL_PANEL_POOL_TOKEN_FIELDS = gql`
  fragment WithdrawalPanelPoolTokenFields on TranchedPoolToken {
    id
    principalAmount
    principalRedeemable
    interestRedeemable
  }
`;

interface WithdrawalPanelProps {
  tranchedPoolAddress: string;
  poolTokens: WithdrawalPanelPoolTokenFieldsFragment[];
}

export function WithdrawalPanel({
  tranchedPoolAddress,
  poolTokens,
}: WithdrawalPanelProps) {
  const totalPrincipalRedeemable = poolTokens.reduce(
    (prev, current) => current.principalRedeemable.add(prev),
    BigNumber.from(0)
  );
  const totalInterestRedeemable = poolTokens.reduce(
    (prev, current) => current.interestRedeemable.add(prev),
    BigNumber.from(0)
  );
  const totalWithdrawable = totalPrincipalRedeemable.add(
    totalInterestRedeemable
  );

  const { tranchedPoolContract } = useTranchedPoolContract(tranchedPoolAddress);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ amount: string }>();
  const apolloClient = useApolloClient();

  const handler = handleSubmit(async (data) => {
    if (!tranchedPoolContract) {
      return;
    }
    const usdcToWithdraw = utils.parseUnits(data.amount, USDC_DECIMALS);
    let transaction;
    if (
      usdcToWithdraw.lte(
        poolTokens[0].principalRedeemable.add(poolTokens[0].interestRedeemable)
      )
    ) {
      transaction = await tranchedPoolContract.withdraw(
        BigNumber.from(poolTokens[0].id),
        usdcToWithdraw
      );
    } else {
      let remainingAmount = usdcToWithdraw;
      const tokenIds: BigNumber[] = [];
      const amounts: BigNumber[] = [];
      for (const poolToken of poolTokens) {
        if (remainingAmount.isZero()) {
          break;
        }
        const redeemable = poolToken.principalRedeemable.add(
          poolToken.interestRedeemable
        );
        if (redeemable.isZero()) {
          continue;
        }
        const amountFromThisToken = redeemable.gt(remainingAmount)
          ? remainingAmount
          : redeemable;
        tokenIds.push(BigNumber.from(poolToken.id));
        amounts.push(amountFromThisToken);
        remainingAmount.sub(amountFromThisToken);
      }
      transaction = await tranchedPoolContract.withdrawMultiple(
        tokenIds,
        amounts
      );
    }
    const toastId = toast(
      <div>
        Withdrawal submitted for pool {tranchedPoolAddress}, view it on{" "}
        <Link href={`https://etherscan.io/tx/${transaction.hash}`}>
          etherscan.io
        </Link>
      </div>,
      { autoClose: false }
    );
    const receipt = await transaction.wait();
    await waitForSubgraphBlock(receipt.blockNumber);
    toast.update(toastId, {
      render: `Withdrawal from pool ${tranchedPoolAddress} succeeded`,
      type: "success",
      autoClose: 5000,
    });
    apolloClient.refetchQueries({ include: "active" });
  });

  const validateWithdrawalAmount = (value: string) => {
    const usdcToWithdraw = utils.parseUnits(value, USDC_DECIMALS);
    if (usdcToWithdraw.gt(totalWithdrawable)) {
      return "Withdrawal amount too high";
    }
  };

  return (
    <div className="col rounded-xl bg-sunrise-01 p-5 text-white">
      <div className="mb-3 text-sm">Available to withdraw</div>
      <div className="mb-9 flex items-center gap-3 text-5xl">
        {formatCrypto(
          {
            token: SupportedCrypto.Usdc,
            amount: totalWithdrawable,
          },
          { includeSymbol: true }
        )}
        <Icon name="Usdc" size="sm" />
      </div>
      <form onSubmit={handler}>
        <div className="mb-3">
          <Input
            label="Amount"
            id="withdrawal-amount"
            {...register("amount", { validate: validateWithdrawalAmount })}
          />
          {errors?.amount ? (
            <HelperText className="mt-1 text-clay-200">
              {errors.amount.message}
            </HelperText>
          ) : null}
        </div>
        <Button colorScheme="secondary" size="xl" className="block w-full">
          Withdraw
        </Button>
      </form>
    </div>
  );
}
