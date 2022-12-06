import { format } from "date-fns";
import { useState, useCallback, useEffect, ReactNode } from "react";
import { useForm } from "react-hook-form";

import { Button, Form, Input } from "@/components/design-system";
import { getFreshProvider, useWallet } from "@/lib/wallet";

import {
  ButtonLink,
  AsyncButton,
  devserverRequest,
  advanceTimeNDays,
} from "./helpers";

export function Home() {
  const { account } = useWallet();

  const [onChainTimestamp, setOnChainTimestamp] = useState<number>();
  const refreshTimestamp = useCallback(async () => {
    // have to get a new provider every time this is called because otherwise the result for latestBlock is cached
    const uncachedProvider = getFreshProvider();
    setOnChainTimestamp(undefined);
    const latestBlock = await uncachedProvider.getBlock("latest");
    setOnChainTimestamp(latestBlock.timestamp);
  }, []);
  useEffect(() => {
    refreshTimestamp();
  }, [refreshTimestamp]);

  return (
    <div>
      <div className="space-y-6">
        <Section title="Advance Time">
          <div className="mb-2 font-medium">
            Current on-chain time:{" "}
            {onChainTimestamp
              ? format(onChainTimestamp * 1000, "HH:mm:ss MMMM dd, yyyy")
              : null}
          </div>
          <div className="flex flex-wrap gap-4">
            <AsyncButton onClick={() => advanceTimeNDays(1)}>1 Day</AsyncButton>
            <AsyncButton onClick={() => advanceTimeNDays(7)}>
              7 Days
            </AsyncButton>
            <AsyncButton onClick={() => advanceTimeNDays(14)}>
              14 Days
            </AsyncButton>
            <InputAndButton onSubmit={(n) => advanceTimeNDays(n)} />
          </div>
        </Section>
        <Section title="Setup user">
          <div className="flex flex-wrap gap-4">
            <AsyncButton
              onClick={() =>
                devserverRequest("setupCurrentUser", { address: account })
              }
              tooltip="You will gain 10 ETH, 250k USDC, and 250k GFI."
              disabled={!account}
            >
              Fund and Golist
            </AsyncButton>
            <AsyncButton
              onClick={() =>
                devserverRequest("setupCurrentUser", {
                  address: account,
                  fund: true,
                  golist: false,
                })
              }
              disabled={!account}
            >
              Fund only
            </AsyncButton>
            <AsyncButton
              onClick={() =>
                devserverRequest("setupCurrentUser", {
                  address: account,
                  fund: false,
                  golist: true,
                })
              }
              disabled={!account}
            >
              Golist only
            </AsyncButton>
            <AsyncButton
              onClick={() =>
                devserverRequest("setupForTesting", { address: account })
              }
              disabled={!account}
              tooltip="This will cause you to gain USDC, become go-listed, and also become the borrower on some new tranched pools. You will not gain GFI."
            >
              Legacy setupForTesting
            </AsyncButton>
          </div>
        </Section>
        <Section title="Feature-specific tools">
          <div className="flex flex-wrap gap-2">
            <ButtonLink to="/kyc" colorScheme="tidepool">
              KYC
            </ButtonLink>
            <ButtonLink to="/membership" colorScheme="mustard">
              Membership
            </ButtonLink>
            <ButtonLink to="/withdrawal-mechanics" colorScheme="twilight">
              Withdrawal Mechanics
            </ButtonLink>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 text-xl font-bold">{title}</div>
      {children}
    </div>
  );
}

function InputAndButton({
  onSubmit,
}: {
  onSubmit: (n: number) => Promise<unknown>;
}) {
  const rhfMethods = useForm<{ n: string }>();
  const s = async (data: { n: string }) => {
    await onSubmit(parseInt(data.n));
  };
  return (
    <Form rhfMethods={rhfMethods} onSubmit={s} className="flex gap-1">
      <Input label="n" hideLabel {...rhfMethods.register("n")} />
      <Button type="submit" size="lg">
        Advance n Days
      </Button>
    </Form>
  );
}
