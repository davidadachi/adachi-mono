import { useForm } from "react-hook-form";

import { Button, DollarInput, Form } from "@/components/design-system";
import { getContract } from "@/lib/contracts";
import { formatCrypto, stringToCryptoAmount } from "@/lib/format";
import { apolloClient } from "@/lib/graphql/apollo";
import { SupportedCrypto } from "@/lib/graphql/generated";
import { toastTransaction } from "@/lib/toast";
import { useWallet } from "@/lib/wallet";

export function Membership() {
  return (
    <div>
      <div className="mb-2 text-xl font-bold">Membership</div>
      <div className="mb-4">
        These dev tools are specific to Membership Vaults.
      </div>
      <SplitterForm />
    </div>
  );
}

function SplitterForm() {
  const { account, provider } = useWallet();
  const rhfMethods = useForm<{ amount: string }>({
    defaultValues: { amount: "10000" },
  });
  const onSubmit = async ({ amount }: { amount: string }) => {
    if (!account || !provider) {
      throw new Error("Wallet not connected");
    }
    const usdcContract = await getContract({ name: "USDC", provider });
    const erc20SplitterContract = await getContract({
      name: "ERC20Splitter",
      provider,
    });
    const usdcToSend = stringToCryptoAmount(amount, SupportedCrypto.Usdc);

    await toastTransaction({
      transaction: usdcContract.transfer(
        erc20SplitterContract.address,
        usdcToSend.amount
      ),
      pendingPrompt: `Sending ${formatCrypto(usdcToSend)} to ERC20 Splitter.`,
      successPrompt: `Sent ${formatCrypto(usdcToSend)} to ERC20 Splitter.`,
    });
    await toastTransaction({
      transaction: erc20SplitterContract.distribute(),
      pendingPrompt: "Finalizing epoch",
    });
    await apolloClient.refetchQueries({ include: "active" });
  };
  return (
    <Form rhfMethods={rhfMethods} onSubmit={onSubmit} className="flex gap-2">
      <DollarInput
        name="amount"
        unit={SupportedCrypto.Usdc}
        label="Amount to send"
        hideLabel
        control={rhfMethods.control}
      />
      <Button type="submit">Send money to splitter and distribute</Button>
    </Form>
  );
}
