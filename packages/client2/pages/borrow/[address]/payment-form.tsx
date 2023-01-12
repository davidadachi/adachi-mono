import { useApolloClient } from "@apollo/client";
import { BigNumber, utils } from "ethers";
import { useForm } from "react-hook-form";

import {
  Button,
  DollarInput,
  Form,
  RadioButton,
} from "@/components/design-system";
import { USDC_DECIMALS } from "@/constants";
import { getContract } from "@/lib/contracts";
import { formatCrypto, stringToCryptoAmount } from "@/lib/format";
import { approveErc20IfRequired } from "@/lib/pools";
import { toastTransaction } from "@/lib/toast";
import { useWallet } from "@/lib/wallet";

interface PaymentFormProps {
  remainingPeriodDueAmount: BigNumber;
  remainingTotalDueAmount: BigNumber;
  borrowerContractId: string;
  tranchedPoolId: string;
  onClose: () => void;
}

// Using string enums b/c RHF incorrectly casts numeric enums on defaultValues set
enum PaymentOption {
  PayMinimumDue = "PayMinimumDue",
  PayFullBalancePlusInterest = "PayFullBalancePlusInterest",
  PayOtherAmount = "PayOtherAmount",
}

export function PaymentForm({
  remainingPeriodDueAmount,
  remainingTotalDueAmount,
  borrowerContractId,
  tranchedPoolId,
  onClose,
}: PaymentFormProps) {
  const { account, provider } = useWallet();
  const apolloClient = useApolloClient();

  const remainingPeriodDueAmountCrypto = {
    amount: remainingPeriodDueAmount,
    token: "USDC",
  } as const;

  const remainingTotalDueAmountCrypto = {
    amount: remainingTotalDueAmount,
    token: "USDC",
  } as const;

  const showPayMinimumDueOption = remainingPeriodDueAmount.gt(0);

  type FormFields = { usdcAmount: string; paymentOption: PaymentOption };
  const rhfMethods = useForm<FormFields>({
    defaultValues: {
      paymentOption: showPayMinimumDueOption
        ? PaymentOption.PayMinimumDue
        : undefined,
      usdcAmount: formatCrypto(remainingPeriodDueAmountCrypto, {
        includeSymbol: false,
        useMaximumPrecision: true,
      }),
    },
  });
  const { control, register, setValue } = rhfMethods;

  const onSubmit = async ({ usdcAmount }: FormFields) => {
    if (!account || !provider) {
      return;
    }
    const usdc = stringToCryptoAmount(usdcAmount, "USDC");

    const borrowerContract = await getContract({
      name: "Borrower",
      address: borrowerContractId,
      provider,
    });
    const usdcContract = await getContract({ name: "USDC", provider });

    await approveErc20IfRequired({
      account,
      spender: borrowerContract.address,
      erc20Contract: usdcContract,
      amount: usdc.amount,
    });
    await toastTransaction({
      transaction: borrowerContract.pay(tranchedPoolId, usdc.amount),
      pendingPrompt: "Credit Line payment submitted.",
    });
    await apolloClient.refetchQueries({ include: "active" });
    onClose();
  };

  const validatePaymentAmount = (usdcAmount: string) => {
    const usdcToPay = utils.parseUnits(usdcAmount, USDC_DECIMALS);
    if (usdcToPay.gt(remainingTotalDueAmount)) {
      return "This is over the total balance of the credit line";
    }
    if (usdcToPay.lte(BigNumber.from(0))) {
      return "Must be more than 0";
    }
  };

  return (
    <Form rhfMethods={rhfMethods} onSubmit={onSubmit}>
      <div className="flex flex-col gap-1">
        {showPayMinimumDueOption && (
          <RadioButton
            id="payMinDue"
            labelClassName="text-lg"
            label={
              <div>
                Pay minimum due:
                <span className="font-semibold">
                  {` ${formatCrypto(remainingPeriodDueAmountCrypto)}`}
                </span>
              </div>
            }
            value={PaymentOption.PayMinimumDue}
            type="radio"
            onSelect={() =>
              setValue(
                "usdcAmount",
                formatCrypto(remainingPeriodDueAmountCrypto, {
                  includeSymbol: false,
                  useMaximumPrecision: true,
                })
              )
            }
            {...register("paymentOption")}
          />
        )}
        <RadioButton
          id="payFullBalancePlusInterest"
          labelClassName="text-lg"
          label={
            <div>
              Pay full balance plus interest:
              <span className="font-semibold">
                {` ${formatCrypto(remainingTotalDueAmountCrypto)}`}
              </span>
            </div>
          }
          value={PaymentOption.PayFullBalancePlusInterest}
          onSelect={() =>
            setValue(
              "usdcAmount",
              formatCrypto(remainingTotalDueAmountCrypto, {
                includeSymbol: false,
                useMaximumPrecision: true,
              })
            )
          }
          {...register("paymentOption")}
        />
        <RadioButton
          id="payOtherAmount"
          labelClassName="text-lg"
          label="Pay other amount"
          value={PaymentOption.PayOtherAmount}
          {...register("paymentOption")}
        />
        <div className="mt-4 flex flex-row gap-8">
          <DollarInput
            control={control}
            name="usdcAmount"
            label="USDC amount"
            hideLabel
            unit="USDC"
            rules={{
              required: "Required",
              validate: validatePaymentAmount,
            }}
            textSize="xl"
            onFocus={() =>
              setValue("paymentOption", PaymentOption.PayOtherAmount)
            }
          />
          <Button type="submit" size="xl" as="button" className="px-12">
            Submit
          </Button>
        </div>
      </div>
    </Form>
  );
}
