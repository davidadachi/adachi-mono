import { gql } from "@apollo/client";
import { BigNumber } from "ethers";
import { GetStaticProps, InferGetStaticPropsType } from "next";
import NextLink from "next/link";

import {
  Banner,
  HelperText,
  Button,
  Link,
  HeavyTable,
  ScrollingSectionedContainer,
} from "@/components/design-system";
import { BannerPortal } from "@/components/layout";
import { apolloClient } from "@/lib/graphql/apollo";
import {
  useSeniorPoolPageQuery,
  SeniorPoolPageCmsQuery,
  SeniorPoolPageCmsDocument,
} from "@/lib/graphql/generated";
import { useWallet } from "@/lib/wallet";
import { PortfolioDetails } from "@/pages/pools/senior/portfolio-details";

import { CapitalStats, CapitalStatsPlaceholder } from "./capital-stats";
import { InvestAndWithdrawTabs } from "./invest-and-withdraw/invest-and-withdraw-tabs";
import { SeniorPoolHighlights } from "./senior-pool-highlights";
import { SeniorPoolLoanSummary } from "./senior-pool-loan-summary";
import {
  SeniorPoolRepaymentSectionPlaceholder,
  SeniorPoolRepaymentSection,
} from "./senior-pool-repayment";
import { StatusSection } from "./status-section";
import { TransactionTable } from "./transaction-table";
import { UnstakedFiduBanner } from "./unstaked-fidu-panel";

gql`
  # Must provide user arg as an ID type and a String type. Selecting a single user requires an ID! type arg, but a where clause involving a using requires a String! type arg, despite the fact that they're basically the same. Very silly.
  query SeniorPoolPage($userId: ID!, $user: String!) {
    user(id: $userId) {
      id
      ...UserEligibilityFields
    }
    seniorPoolStakedPositions(
      where: { user: $user, positionType: Fidu, amount_gt: 0 }
    ) {
      ...SeniorPoolWithdrawalPanelPositionFields
    }
    vaultedStakedPositions(where: { user: $user }) {
      id
      seniorPoolStakedPosition {
        ...SeniorPoolWithdrawalPanelPositionFields
      }
    }
    seniorPools(first: 1) {
      id
      address
      sharePrice
      withdrawalCancellationFee
      epochEndsAt @client
      ...SeniorPoolPortfolioDetailsFields
      ...SeniorPoolStatusFields
      ...CapitalStatsFields
      ...SeniorPoolSupplyPanelPoolFields
      ...SeniorPoolLoanSummaryFields
      ...InvestAndWithdrawSeniorPoolFields
      ...SeniorPoolRepaymentFields
    }
    gfiPrice(fiat: USD) @client {
      price {
        amount
        symbol
      }
    }
    viewer @client {
      fiduBalance
    }
    seniorPoolWithdrawalRequests(where: { user: $user }) {
      ...SeniorPoolWithdrawalPanelWithdrawalRequestFields
    }
  }
`;

gql`
  query SeniorPoolPageCMS @api(name: cms) {
    Deals(limit: 100, where: { hidden: { not_equals: true } }) {
      docs {
        ...SeniorPoolPortfolioPoolsDealsFields
      }
    }
  }
`;

export default function SeniorPoolPage({
  dealMetadata,
}: InferGetStaticPropsType<typeof getStaticProps>) {
  const { account } = useWallet();
  const { data, error } = useSeniorPoolPageQuery({
    variables: {
      userId: account?.toLowerCase() ?? "",
      user: account?.toLowerCase() ?? "",
    },
  });

  const seniorPool = data?.seniorPools[0];
  const user = data?.user ?? null;
  const fiatPerGfi = data?.gfiPrice?.price.amount;

  // Spec for this logic: https://linear.app/goldfinch/issue/GFI-638/as-unverified-user-we-display-this-pool-is-only-for-non-us-persons
  let initialBannerContent = "";
  let expandedBannerContent = "";
  const noUid =
    !user?.isNonUsEntity &&
    !user?.isNonUsIndividual &&
    !user?.isUsAccreditedIndividual &&
    !user?.isUsEntity &&
    !user?.isUsNonAccreditedIndividual;
  const uidIsUs =
    user?.isUsAccreditedIndividual ||
    user?.isUsEntity ||
    user?.isUsNonAccreditedIndividual;
  const uidIsNonUs = user?.isNonUsEntity || user?.isNonUsIndividual;
  if (noUid) {
    initialBannerContent =
      "This offering is only available to non-U.S. persons or U.S. accredited investors.";
    expandedBannerContent =
      "Eligibility to participate in this offering is determined by your (i) investor accreditation status and (ii) your residency. This offering has not been registered under the U.S. Securities Act of 1933 (”Securities Act”), as amended, and may not be offered or sold to a U.S. person that is not an accredited investor, absent registration or an applicable exemption from the registration requirements. Log in with your address and claim your UID to see if you're eligible to participate.";
  } else if (uidIsUs) {
    initialBannerContent =
      "This offering is only available to U.S. accredited investors.";
    expandedBannerContent =
      "This offering is only available to U.S. accredited investors. This offering has not been registered under the U.S. Securities Act of 1933 (”Securities Act”), as amended, or under the securities laws of certain states. This offering may not be offered, sold or otherwise transferred, pledged or hypothecated except as permitted under the Securities Act and applicable state securities laws pursuant to an effective registration statement or an exemption therefrom.";
  } else if (uidIsNonUs) {
    initialBannerContent =
      "This offering is only available to non-U.S. persons.";
    expandedBannerContent =
      "This offering is only available to non-U.S. persons. This offering has not been registered under the U.S. Securities Act of 1933 (“Securities Act”), as amended, and may not be offered or sold in the United States or to a U.S. person (as defined in Regulation S promulgated under the Securities Act) absent registration or an applicable exemption from the registration requirements.";
  }

  return (
    <>
      {initialBannerContent && expandedBannerContent ? (
        <BannerPortal>
          <Banner
            initialContent={initialBannerContent}
            expandedContent={expandedBannerContent}
          />
        </BannerPortal>
      ) : null}

      <div className="pool-layout">
        <div className="flex flex-col" style={{ gridArea: "widgets" }}>
          <NextLink href="/earn" passHref>
            <Button
              as="a"
              variant="rounded"
              size="lg"
              colorScheme="sand"
              iconLeft="ArrowLeft"
              className="mb-10 self-start"
            >
              Back to Open Deals
            </Button>
          </NextLink>
          <div className="relative flex grow flex-col">
            <div className="grow"></div>
            <div className="sticky bottom-10">
              <div className="divide-y divide-mustard-200 rounded-3xl bg-mustard-100 [&>*]:p-5 [&>*]:lg:p-10">
                <SeniorPoolLoanSummary
                  seniorPool={seniorPool}
                  fiatPerGfi={fiatPerGfi}
                />

                {seniorPool && fiatPerGfi ? (
                  <InvestAndWithdrawTabs
                    seniorPool={seniorPool}
                    user={user}
                    fiduBalance={
                      data.viewer.fiduBalance ?? {
                        token: "FIDU",
                        amount: BigNumber.from(0),
                      }
                    }
                    stakedPositions={data.seniorPoolStakedPositions}
                    vaultedStakedPositions={data.vaultedStakedPositions.map(
                      (vsp) => vsp.seniorPoolStakedPosition
                    )}
                    existingWithdrawalRequest={
                      data.seniorPoolWithdrawalRequests[0]
                    }
                    fiatPerGfi={fiatPerGfi}
                  />
                ) : null}

                {data?.viewer.fiduBalance?.amount.gt(0) &&
                seniorPool &&
                fiatPerGfi ? (
                  <UnstakedFiduBanner
                    fiduBalance={data.viewer.fiduBalance}
                    sharePrice={seniorPool.sharePrice}
                    estimatedApyFromGfiRaw={seniorPool.estimatedApyFromGfiRaw}
                    fiatPerGfi={fiatPerGfi}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <div style={{ gridArea: "info" }}>
          <ScrollingSectionedContainer
            sections={[
              {
                navTitle: "Overview",
                title: "Overview",
                content: seniorPool ? (
                  <CapitalStats seniorPool={seniorPool} />
                ) : (
                  <CapitalStatsPlaceholder />
                ),
              },
              {
                navTitle: "Highlights",
                title: "Highlights",
                content: <SeniorPoolHighlights />,
              },
              {
                navTitle: "Repayment",
                title: "Repayments",
                content: seniorPool ? (
                  <SeniorPoolRepaymentSection seniorPool={seniorPool} />
                ) : (
                  <SeniorPoolRepaymentSectionPlaceholder />
                ),
              },
              {
                navTitle: "Portfolio",
                title: "Portfolio details",
                content: (
                  <PortfolioDetails
                    seniorPool={seniorPool}
                    dealMetadata={dealMetadata}
                  />
                ),
              },
              {
                navTitle: "Risk",
                title: "Risk",
                content: <div className="h-96" />,
              },
            ]}
          />
          {error ? (
            <HelperText isError>
              There was a problem fetching data on the senior pool. Shown data
              may be outdated.
            </HelperText>
          ) : null}

          <StatusSection className="mb-12" seniorPool={seniorPool} />

          <div className="mb-20">
            <h2 className="mb-8 text-3xl">Overview</h2>
            <p className="mb-8 text-2xl font-light">
              The Senior Pool is the simple, lower risk, lower return option on
              Goldfinch. Capital is automatically diversified across Borrower
              pools, and protected by Backer capital.
            </p>
            <Button
              className="block"
              as="a"
              size="lg"
              href="https://docs.goldfinch.finance/goldfinch/protocol-mechanics/liquidityproviders"
              iconRight="ArrowTopRight"
              variant="rounded"
            >
              How it Works
            </Button>
          </div>

          <div className="mb-20">
            <h3 className="mb-8 text-lg font-semibold">Highlights</h3>
            <ul className="list-outside list-disc space-y-5 pl-5">
              <li>
                Earn passive yield. Capital is automatically deployed across a
                diverse portfolio of Borrowers that are vetted by Backers.
              </li>
              <li>
                Lower risk. Losses are protected by the first-loss capital
                supplied by Backers.
              </li>
              <li>
                Stable returns. Receive USDC APY from the underlying interest,
                driven by real-world activity that is uncorrelated with crypto,
                plus GFI from liquidity mining distributions.
              </li>
            </ul>
          </div>

          <div className="mb-20">
            <div className="mb-8">
              <h2 className="text-lg font-semibold">Liquidity options</h2>
            </div>
            <HeavyTable
              rows={[
                [
                  "Withdrawal Request",
                  null,
                  <div key="withdrawal-request">
                    <div className="mb-2">
                      To withdraw capital from the Senior Pool, an LP must
                      submit a Withdrawal Request. Capital is distributed for
                      withdrawal every two weeks, based on availability and
                      requested amount.
                    </div>
                    <Link
                      href="https://docs.goldfinch.finance/goldfinch/protocol-mechanics/liquidity"
                      iconRight="ArrowTopRight"
                      className="text-sand-500"
                      openInNewTab
                    >
                      Read more
                    </Link>
                  </div>,
                ],
              ]}
            />
          </div>

          <TransactionTable />

          <div className="flex gap-2">
            <Button
              as="a"
              href="https://dune.com/goldfinch/goldfinch"
              colorScheme="secondary"
              iconRight="ArrowTopRight"
              variant="rounded"
            >
              Dashboard
            </Button>
            <Button
              as="a"
              href={`https://etherscan.io/address/${seniorPool?.address}`}
              colorScheme="secondary"
              iconRight="ArrowTopRight"
              variant="rounded"
            >
              Pool
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export const getStaticProps: GetStaticProps = async () => {
  const res = await apolloClient.query<SeniorPoolPageCmsQuery>({
    query: SeniorPoolPageCmsDocument,
    fetchPolicy: "network-only",
  });

  const deals = res.data.Deals?.docs;
  if (!deals) {
    throw new Error("No metadata found for any deals");
  }

  const dealMetadata: Record<
    string,
    NonNullable<
      NonNullable<NonNullable<SeniorPoolPageCmsQuery["Deals"]>["docs"]>[number]
    >
  > = {};
  deals.forEach((d) => {
    if (d && d.id) {
      dealMetadata[d.id] = d;
    }
  });

  return {
    props: {
      dealMetadata,
    },
  };
};
