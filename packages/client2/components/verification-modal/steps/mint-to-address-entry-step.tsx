import { useApolloClient } from "@apollo/client";
import { ethers } from "ethers";
import { useForm } from "react-hook-form";
import { useWizard } from "react-use-wizard";

import {
  Button,
  Form,
  Input,
  useModalContext,
} from "@/components/design-system";
import { UNIQUE_IDENTITY_MINT_PRICE } from "@/constants";
import { dataLayerPushEvent } from "@/lib/analytics";
import { getContract } from "@/lib/contracts";
import { toastTransaction } from "@/lib/toast";
import { fetchUniqueIdentitySigner, getUIDLabelFromType } from "@/lib/verify";
import { useWallet } from "@/lib/wallet";

import { VerificationFlowSteps } from "../step-manifest";
import { useVerificationFlowContext } from "../verification-flow-context";
import { StepTemplate } from "./step-template";

interface MintToAddressForm {
  address: string;
}

export function MintToAddressEntryStep() {
  const { useModalTitle } = useModalContext();
  useModalTitle("Enter smart contract wallet address");

  const { signature } = useVerificationFlowContext();
  const { account, provider } = useWallet();
  const apolloClient = useApolloClient();
  const { previousStep, goToStep } = useWizard();

  const rhfMethods = useForm<MintToAddressForm>();
  const { register } = rhfMethods;

  const validate = (address: string) => {
    if (!ethers.utils.isAddress(address)) {
      return "Not a valid address";
    }
  };

  const onSubmit = async (data: MintToAddressForm) => {
    const mintToAddress = data.address;
    if (!account || !signature || !provider) {
      throw new Error("Unable to verify eligibility to mint.");
    }
    const signer = await fetchUniqueIdentitySigner(
      account,
      signature.signature,
      signature.signatureBlockNum,
      mintToAddress
    );

    const uidContract = await getContract({
      name: "UniqueIdentity",
      provider,
    });

    const gasPrice = await provider.getGasPrice();

    try {
      const transaction = uidContract.mintTo(
        mintToAddress,
        signer.idVersion,
        signer.expiresAt,
        signer.signature,
        {
          value: UNIQUE_IDENTITY_MINT_PRICE,
          gasPrice: gasPrice,
        }
      );

      const submittedTransaction = await toastTransaction({
        transaction,
        pendingPrompt: "UID mint submitted.",
        successPrompt: "UID mint succeeded.",
      });

      await apolloClient.refetchQueries({ include: "active" });
      dataLayerPushEvent("UID_MINTED", {
        transactionHash: submittedTransaction.transactionHash,
        uidType: getUIDLabelFromType(signer.idVersion),
      });
      goToStep(VerificationFlowSteps.MintFinished);
    } catch (e) {
      const reason = (e as { reason: string }).reason;
      const actualReason = reason.match(/reverted with reason string \'(.+)\'/);
      if (actualReason) {
        throw new Error(actualReason[1]);
      }
      throw e;
    }
  };

  return (
    <Form
      rhfMethods={rhfMethods}
      onSubmit={onSubmit}
      className="flex h-full grow flex-col justify-between"
    >
      <StepTemplate
        includePrivacyStatement={false}
        footer={
          <div className="flex w-full flex-row items-center justify-between gap-2">
            <Button size="lg" onClick={previousStep} className="w-full">
              Back
            </Button>
            <Button
              size="lg"
              type="submit"
              iconRight="ArrowSmRight"
              className="w-full"
            >
              Mint UID
            </Button>
          </div>
        }
      >
        <Input
          {...register("address", { required: "Required", validate })}
          label="Smart contract wallet address"
          placeholder="0x...1234"
          textSize="sm"
          className="mb-3 w-full"
          labelClassName="!text-sm !mb-3"
        />

        <div className="mt-8 text-xs text-sand-500">
          Please note this wallet will be able to interact with the Goldfinch
          protocol on behalf of you or the organization that went through
          verification. You are not approving the wallet to move any of your
          funds whatsoever. This is merely minting a UID to that address, the
          same as if you minted it to a personal wallet. You have ultimate
          control over this UID, and it can be revoked from this smart contract
          by contacting Warbler Labs.
        </div>
      </StepTemplate>
    </Form>
  );
}
