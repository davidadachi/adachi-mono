import { gql } from "@apollo/client";
import clsx from "clsx";
import { useRouter } from "next/router";
import { ReactNode, useEffect, useState } from "react";

import {
  Button,
  Icon,
  Spinner,
  TabButton,
  TabContent,
  TabGroup,
  TabList,
  TabPanels,
} from "@/components/design-system";
import { CallToActionBanner } from "@/components/design-system";
import { PARALLEL_MARKETS } from "@/constants";
import { useAccountPageQuery } from "@/lib/graphql/generated";
import { openVerificationModal, openWalletModal } from "@/lib/state/actions";
import { getSignatureForKyc, registerKyc } from "@/lib/verify";
import { fetchKycStatus } from "@/lib/verify";
import { KycSignature } from "@/lib/verify";
import { useWallet } from "@/lib/wallet";
import { NextPageWithLayout } from "@/pages/_app.page";

gql`
  query AccountPage {
    viewer @client {
      kycStatus {
        status
        identityStatus
        accreditationStatus
      }
    }
  }
`;

const DEFAULT_UID_SET_UP_STRING =
  "UID is a non-transferrable NFT representing KYC-verification on-chain. A UID is required to participate in the Goldfinch lending protocol. No personal information is stored on-chain.";
const DEFAULT_UID_TITLE = "Setup your UID to start";
const DEFAULT_UID_ICON = "Globe";

const AccountsPage: NextPageWithLayout = () => {
  const { account, provider, signer } = useWallet();
  const { data, error, loading, refetch } = useAccountPageQuery();
  const router = useRouter();

  const [isRegisteringKyc, setIsRegisteringKyc] = useState(false);
  const [registerKycError, setRegisterKycError] = useState<Error>();

  useEffect(() => {
    if (!router.isReady || !signer || !account) {
      return;
    }
    const asyncEffect = async () => {
      setIsRegisteringKyc(true);
      setRegisterKycError(undefined);
      /* we don't want to keep asking users for their signature once they've already signed */
      try {
        /* Check for cross-site forgery on redirection to account page from parallel markets when page first renders */
        if (router.query.state !== undefined) {
          const parallel_markets_state = sessionStorage.getItem(
            PARALLEL_MARKETS.STATE_KEY
          );
          if (router.query.state !== parallel_markets_state) {
            throw new Error(
              "Detected a possible cross-site request forgery attack on your Parallel Markets session. Please try authenticating with Parallel Markets through Goldfinch again."
            );
          }
        }
        if (router.query.error === "access_denied") {
          throw new Error(
            "You have declined to give Goldfinch consent for authorization to Parallel Markets. Please try authenticating with Parallel Markets through Goldfinch again."
          );
        }
        if (router.query.code !== undefined && account && provider) {
          const sig = await getSignatureForKyc(
            provider,
            signer,
            JSON.stringify({
              key: router.query.code,
              provider: "parallel_markets",
            })
          );
          await registerKyc(account, sig);
          await refetch();
          router.replace("/account");
        }
      } catch (e) {
        setRegisterKycError(e as Error);
      } finally {
        setIsRegisteringKyc(false);
      }
    };
    asyncEffect();
  }, [account, provider, signer, router, router.isReady, refetch]);

  const showPendingVerificationBanner =
    data?.viewer.kycStatus?.status === "pending";
  const identityVerificationApproved =
    data?.viewer.kycStatus?.identityStatus === "approved";
  const accreditationVerificationApproved =
    data?.viewer.kycStatus?.accreditationStatus === "approved";

  const statuses: ReactNode = (
    <div className="full-width mt-8 flex flex-col gap-2 sm:flex-row">
      <div className="box-content flex flex-row rounded-md bg-mint-100 p-4 text-sm sm:w-1/3">
        <Icon className="mt-1 mr-1 fill-mint-450" name="Checkmark" />
        Documents Uploaded
      </div>
      <div
        className={clsx(
          "box-content flex flex-row rounded-md p-4 text-sm sm:w-1/3",
          identityVerificationApproved ? "bg-mint-100" : "bg-sand-100"
        )}
      >
        <Icon
          className={clsx(
            "mt-1 mr-1",
            identityVerificationApproved ? "fill-mint-450" : "fill-sand-300"
          )}
          name="Checkmark"
        />
        Identity verification
      </div>
      <div
        className={clsx(
          "box-content flex flex-row rounded-md p-4 text-sm sm:w-1/3",
          accreditationVerificationApproved ? "bg-mint-100" : "bg-sand-100"
        )}
      >
        <Icon
          className={clsx(
            "mt-1 mr-1",
            accreditationVerificationApproved
              ? "fill-mint-450"
              : "fill-sand-300"
          )}
          name="Checkmark"
        />
        Accreditation verification
      </div>
    </div>
  );

  /* After clicking on openVerificationModal, need to clear the URL */
  return (
    <div>
      <div className="bg-mustard-100">
        <div className="mx-auto max-w-7xl px-5 py-16">
          <h1 className="font-serif text-5xl font-bold text-sand-800">
            Account
          </h1>
        </div>
      </div>
      {error ? (
        <div className="text-xl text-clay-500">
          Unable to fetch data for your account
        </div>
      ) : null}
      <TabGroup>
        <div className="bg-mustard-100">
          <div className="mx-auto max-w-7xl px-5">
            <TabList>
              <TabButton>UID and Wallets</TabButton>
            </TabList>
          </div>
        </div>
        <div className="px-5">
          <div className="mx-auto max-w-7xl pt-0">
            <TabPanels>
              <TabContent>
                {isRegisteringKyc || loading ? (
                  <Spinner size="lg" />
                ) : showPendingVerificationBanner ? (
                  <CallToActionBanner
                    iconLeft={DEFAULT_UID_ICON}
                    title="UID is being verified"
                    description="Almost there. Your UID is still being verified, please come back later."
                    colorScheme="white"
                    // eslint-disable-next-line react/no-children-prop
                    children={statuses}
                  />
                ) : (
                  <CallToActionBanner
                    renderButton={(props) =>
                      account ? (
                        <Button {...props} onClick={openVerificationModal}>
                          {registerKycError ? "Try again" : "Begin UID setup"}
                        </Button>
                      ) : (
                        <Button {...props} onClick={openWalletModal}>
                          Connect Wallet
                        </Button>
                      )
                    }
                    iconLeft={
                      account
                        ? registerKycError
                          ? "Exclamation"
                          : DEFAULT_UID_ICON
                        : DEFAULT_UID_ICON
                    }
                    title={
                      account
                        ? registerKycError
                          ? "There was a problem connecting to our verification partner"
                          : DEFAULT_UID_TITLE
                        : DEFAULT_UID_TITLE
                    }
                    description={
                      account
                        ? registerKycError
                          ? registerKycError.message
                          : DEFAULT_UID_SET_UP_STRING
                        : DEFAULT_UID_SET_UP_STRING
                    }
                  />
                )}
              </TabContent>
            </TabPanels>
          </div>
        </div>
      </TabGroup>
    </div>
  );
};

AccountsPage.layout = "naked";

export default AccountsPage;
