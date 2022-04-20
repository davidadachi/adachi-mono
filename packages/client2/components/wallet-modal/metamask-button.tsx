import { Spinner } from "@/components/design-system";
import { metaMask, metaMaskHooks } from "@/lib/wallet/connectors/metamask";

import MetaMaskLogo from "./metamask-logo.svg";
import { ProviderButton } from "./provider-button";

export function MetaMaskButton() {
  const isActive = metaMaskHooks.useIsActive();
  const isActivating = metaMaskHooks.useIsActivating();
  const handleConnectMetaMask = () => {
    metaMask.activate();
  };
  return (
    <ProviderButton
      disabled={isActive || isActivating}
      onClick={handleConnectMetaMask}
    >
      {`MetaMask${isActive ? " (Connected)" : ""}`}
      {isActivating ? (
        <Spinner style={{ color: "#f6851b" }} />
      ) : (
        <MetaMaskLogo className="h-8 w-8" />
      )}
    </ProviderButton>
  );
}
