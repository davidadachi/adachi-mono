import {
  Button,
  TabButton,
  TabContent,
  TabGroup,
  TabList,
  TabPanels,
} from "@/components/design-system";
import { CallToActionBanner } from "@/components/design-system";
import { NextPageWithLayout } from "@/pages/_app.page";

/* Will make the description conditional soon */
const CallToActionBannerDescription =
  "UID is a non-transferrable NFT representing KYC-verification on-chain. A UID is required to participate in Goldfinch lending protocol. No personal information is stored on-chain.";

const AccountsPage: NextPageWithLayout = () => {
  return (
    <div>
      <div className="bg-mustard-100">
        <div className="mx-auto max-w-7xl px-5 py-16">
          <h1 className="font-serif text-5xl font-bold text-sand-800">
            Account
          </h1>
        </div>
      </div>
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
                <CallToActionBanner
                  renderButton={(props) => (
                    <Button {...props}>Begin UID set up</Button>
                  )}
                  iconLeft="Globe"
                  title="Setup your UID to start" /* will make title conditional soon */
                  description={CallToActionBannerDescription}
                />
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
