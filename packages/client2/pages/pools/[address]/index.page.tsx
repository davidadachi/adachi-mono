import { ParsedUrlQuery } from "querystring";

import { gql } from "@apollo/client";
import { BigNumber } from "ethers";
import { GetStaticPaths, GetStaticProps } from "next";

import {
  Breadcrumb,
  Button,
  TabButton,
  TabContent,
  TabGroup,
  TabList,
  TabPanels,
  Heading,
  ShimmerLines,
  HelperText,
  Marquee,
  Banner,
} from "@/components/design-system";
import { BannerPortal, SubnavPortal } from "@/components/layout";
import { SEO } from "@/components/seo";
import { apolloClient } from "@/lib/graphql/apollo";
import {
  SupportedCrypto,
  UidType,
  useSingleTranchedPoolDataQuery,
  SingleDealQuery,
  AllDealsQuery,
  SingleDealQueryVariables,
  Deal_DealType,
} from "@/lib/graphql/generated";
import {
  PoolStatus,
  getTranchedPoolStatus,
  TRANCHED_POOL_STATUS_FIELDS,
} from "@/lib/pools";
import { useWallet } from "@/lib/wallet";

import {
  BorrowerProfile,
  BORROWER_PROFILE_FIELDS,
  BORROWER_OTHER_POOL_FIELDS,
} from "./borrower-profile";
import { CMS_TEAM_MEMBER_FIELDS } from "./borrower-team";
import ComingSoonPanel from "./coming-soon-panel";
import { CREDIT_MEMO_FIELDS } from "./credit-memos";
import DealSummary from "./deal-summary";
import {
  SECURITIES_RECOURSE_TABLE_FIELDS,
  BORROWER_FINANCIALS_TABLE_FIELDS,
  BORROWER_PERFORMANCE_TABLE_FIELDS,
} from "./deal-tables";
import { DOCUMENT_FIELDS } from "./documents-list";
import FundingBar from "./funding-bar";
import RepaymentProgressPanel from "./repayment-progress-panel";
import {
  StatusSection,
  TRANCHED_POOL_STAT_GRID_FIELDS,
} from "./status-section";
import SupplyPanel, { SUPPLY_PANEL_USER_FIELDS } from "./supply-panel";
import {
  WithdrawalPanel,
  WITHDRAWAL_PANEL_POOL_TOKEN_FIELDS,
  WITHDRAWAL_PANEL_ZAP_FIELDS,
} from "./withdrawal-panel";

gql`
  ${TRANCHED_POOL_STATUS_FIELDS}
  ${TRANCHED_POOL_STAT_GRID_FIELDS}
  ${SUPPLY_PANEL_USER_FIELDS}
  ${WITHDRAWAL_PANEL_POOL_TOKEN_FIELDS}
  ${WITHDRAWAL_PANEL_ZAP_FIELDS}
  ${BORROWER_OTHER_POOL_FIELDS}
  query SingleTranchedPoolData(
    $tranchedPoolId: ID!
    $tranchedPoolAddress: String!
    $userId: ID!
    $borrowerOtherPools: [ID!]
  ) {
    tranchedPool(id: $tranchedPoolId) {
      id
      allowedUidTypes
      estimatedJuniorApy
      estimatedJuniorApyFromGfiRaw
      estimatedLeverageRatio
      fundableAt
      isPaused
      numBackers
      juniorTranches {
        lockedUntil
      }
      juniorDeposited
      creditLine {
        id
        limit
        maxLimit
        id
        isLate @client
        termInDays
        paymentPeriodInDays
        nextDueTime
        interestAprDecimal
        borrower
        lateFeeApr
      }
      initialInterestOwed
      principalAmountRepaid
      interestAmountRepaid
      ...TranchedPoolStatusFields
    }
    borrowerOtherPools: tranchedPools(
      where: { id_in: $borrowerOtherPools, id_not: $tranchedPoolId }
    ) {
      ...BorrowerOtherPoolFields
    }
    seniorPools(first: 1) {
      id
      latestPoolStatus {
        id
        estimatedApyFromGfiRaw
        sharePrice
      }
    }
    gfiPrice(fiat: USD) @client {
      price {
        amount
        symbol
      }
    }
    user(id: $userId) {
      id
      ...SupplyPanelUserFields
      tranchedPoolTokens(where: { tranchedPool: $tranchedPoolAddress }) {
        ...WithdrawalPanelPoolTokenFields
      }
      zaps(where: { tranchedPool: $tranchedPoolAddress }) {
        ...WithdrawalPanelZapFields
      }
      vaultedPoolTokens(where: { tranchedPool: $tranchedPoolAddress }) {
        id
        poolToken {
          ...WithdrawalPanelPoolTokenFields
        }
      }
    }

    currentBlock @client {
      timestamp
    }
  }
`;

const getMarqueeColor = (
  poolStatus: PoolStatus
): "yellow" | "purple" | "blue" | "green" | undefined => {
  switch (poolStatus) {
    case PoolStatus.Closed:
    case PoolStatus.Full:
      return "yellow";
    case PoolStatus.Open:
      return "purple";
    case PoolStatus.ComingSoon:
      return "blue";
    case PoolStatus.Repaid:
      return "green";
    default:
      return undefined;
  }
};

const getMarqueeText = (poolStatus: PoolStatus, numBackers?: number) => {
  switch (poolStatus) {
    case PoolStatus.Full:
      return ["Filled", `${numBackers} Backers`];
    case PoolStatus.Open:
      return ["Open", `${numBackers} Backers`];
    case PoolStatus.ComingSoon:
      return "Coming Soon";
    case PoolStatus.Closed:
      return "Closed";
    case PoolStatus.Repaid:
      return "Repaid";
    default:
      return "Paused";
  }
};

const singleDealQuery = gql`
  ${DOCUMENT_FIELDS}
  ${CMS_TEAM_MEMBER_FIELDS}
  ${SECURITIES_RECOURSE_TABLE_FIELDS}
  ${BORROWER_FINANCIALS_TABLE_FIELDS}
  ${BORROWER_PERFORMANCE_TABLE_FIELDS}
  ${BORROWER_PROFILE_FIELDS}
  ${CREDIT_MEMO_FIELDS}
  query SingleDeal($id: String!) @api(name: cms) {
    Deal(id: $id) {
      id
      name
      dealType
      category
      borrower {
        ...BorrowerProfileFields
      }
      overview
      details
      agreement
      dataroom
      securitiesAndRecourse {
        ...SecuritiesRecourseTableFields
      }
      defaultInterestRate
      transactionStructure {
        filename
        alt
        url
        mimeType
      }
      documents {
        ...DocumentFields
      }
      creditMemos {
        ...CreditMemoFields
      }
    }
  }
`;

interface PoolPageProps {
  dealDetails: NonNullable<SingleDealQuery["Deal"]>;
}

export default function PoolPage({ dealDetails }: PoolPageProps) {
  const { account } = useWallet();

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const borrower = dealDetails.borrower!;
  const otherPoolsFromThisBorrower = (borrower.deals || []).map(
    (deal) => deal.id
  );

  const { data, error } = useSingleTranchedPoolDataQuery({
    variables: {
      tranchedPoolId: dealDetails?.id as string,
      tranchedPoolAddress: dealDetails?.id as string,
      userId: account?.toLowerCase() ?? "",
      borrowerOtherPools: otherPoolsFromThisBorrower,
    },
    returnPartialData: true,
  });

  const tranchedPool = data?.tranchedPool;
  const seniorPool = data?.seniorPools?.[0];
  const user = data?.user ?? null;
  const fiatPerGfi = data?.gfiPrice.price.amount;
  const isMultitranche = dealDetails.dealType === Deal_DealType.Multitranche;

  if (error) {
    return (
      <div className="text-2xl">
        Unable to load the specified tranched pool.
      </div>
    );
  }

  const poolStatus = tranchedPool ? getTranchedPoolStatus(tranchedPool) : null;
  const backerSupply = tranchedPool?.juniorDeposited
    ? {
        token: SupportedCrypto.Usdc,
        amount: tranchedPool.juniorDeposited,
      }
    : undefined;
  const seniorSupply =
    backerSupply && tranchedPool?.estimatedLeverageRatio && isMultitranche
      ? {
          token: SupportedCrypto.Usdc,
          // TODO: Zadra - estimatedLeverageRatio is now a FixedNumber, wat do?
          amount: backerSupply.amount.mul(
            BigNumber.from(
              tranchedPool.estimatedLeverageRatio.toString().split(".")[0]
            )
          ),
        }
      : undefined;

  // Spec for this logic: https://linear.app/goldfinch/issue/GFI-638/as-unverified-user-we-display-this-pool-is-only-for-non-us-persons
  let initialBannerContent = "";
  let expandedBannerContent = "";
  const poolSupportsUs =
    tranchedPool?.allowedUidTypes.includes(UidType.UsAccreditedIndividual) ||
    tranchedPool?.allowedUidTypes.includes(UidType.UsEntity);
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
  if (poolSupportsUs && noUid) {
    initialBannerContent =
      "This offering is only available to non-U.S. persons or U.S. accredited investors.";
    expandedBannerContent =
      "Eligibility to participate in this offering is determined by your (i) investor accreditation status and (ii) your residency. This offering has not been registered under the U.S. Securities Act of 1933 (”Securities Act”), as amended, and may not be offered or sold to a U.S. person that is not an accredited investor, absent registration or an applicable exemption from the registration requirements. Log in with your address and claim your UID to see if you're eligible to participate.";
  } else if (poolSupportsUs && uidIsUs) {
    initialBannerContent =
      "This offering is only available to U.S. accredited investors.";
    expandedBannerContent =
      "This offering is only available to U.S. accredited investors. This offering has not been registered under the U.S. Securities Act of 1933 (”Securities Act”), as amended, or under the securities laws of certain states. This offering may not be offered, sold or otherwise transferred, pledged or hypothecated except as permitted under the Securities Act and applicable state securities laws pursuant to an effective registration statement or an exemption therefrom.";
  } else if (poolSupportsUs && uidIsNonUs) {
    initialBannerContent =
      "This offering is only available to non-U.S. persons.";
    expandedBannerContent =
      "This offering is only available to non-U.S. persons. This offering has not been registered under the U.S. Securities Act of 1933 (“Securities Act”), as amended, and may not be offered or sold in the United States or to a U.S. person (as defined in Regulation S promulgated under the Securities Act) absent registration or an applicable exemption from the registration requirements.";
  } else if (!poolSupportsUs) {
    initialBannerContent =
      "This offering is only available to non-U.S. persons.";
    expandedBannerContent =
      "This offering is only available to non-U.S. persons. This offering has not been registered under the U.S. Securities Act of 1933 (“Securities Act”), as amended, and may not be offered or sold in the United States or to a U.S. person (as defined in Regulation S promulgated under the Securities Act) absent registration or an applicable exemption from the registration requirements.";
  }

  return (
    <>
      <SEO title={dealDetails.name} />

      {initialBannerContent && expandedBannerContent ? (
        <BannerPortal>
          <Banner
            initialContent={initialBannerContent}
            expandedContent={expandedBannerContent}
          />
        </BannerPortal>
      ) : null}

      {poolStatus !== null && poolStatus !== undefined && (
        <SubnavPortal>
          <Marquee colorScheme={getMarqueeColor(poolStatus)}>
            {getMarqueeText(poolStatus, tranchedPool?.numBackers)}
          </Marquee>
          {/* gives the illusion of rounded corners on the top of the page */}
          <div className="-mt-3 h-3 rounded-t-xl bg-white" />
        </SubnavPortal>
      )}

      <div className="pool-layout">
        <div style={{ gridArea: "heading" }}>
          <div className="mb-8 flex flex-wrap justify-between gap-2">
            <div>
              <Breadcrumb label={dealDetails.name} image={borrower.logo?.url} />
            </div>
            {tranchedPool && poolStatus !== PoolStatus.ComingSoon ? (
              <Button
                variant="rounded"
                colorScheme="secondary"
                iconRight="ArrowTopRight"
                as="a"
                href={`https://etherscan.io/address/${tranchedPool.id}`}
                target="_blank"
                rel="noopener"
              >
                Contract
              </Button>
            ) : null}
          </div>
          <Heading
            level={1}
            className="mb-12 text-center text-sand-800 md:text-left"
          >
            {dealDetails.name}
          </Heading>

          {error ? (
            <HelperText isError>
              There was a problem fetching data on this pool. Shown data may be
              outdated.
            </HelperText>
          ) : null}

          {poolStatus === PoolStatus.Open ||
          poolStatus === PoolStatus.Closed ? (
            <FundingBar
              isMultitranche={isMultitranche}
              goal={
                tranchedPool?.creditLine.maxLimit
                  ? {
                      token: SupportedCrypto.Usdc,
                      amount: tranchedPool.creditLine.maxLimit,
                    }
                  : undefined
              }
              backerSupply={backerSupply}
              seniorSupply={seniorSupply}
            />
          ) : null}

          {poolStatus && tranchedPool && seniorPool && fiatPerGfi ? (
            <StatusSection
              className="mt-12"
              poolStatus={poolStatus}
              tranchedPool={tranchedPool}
              seniorPoolApyFromGfiRaw={
                seniorPool.latestPoolStatus.estimatedApyFromGfiRaw
              }
              fiatPerGfi={fiatPerGfi}
            />
          ) : null}
        </div>

        <div className="relative" style={{ gridArea: "widgets" }}>
          {tranchedPool && seniorPool && fiatPerGfi ? (
            <div className="flex flex-col items-stretch gap-8">
              {poolStatus === PoolStatus.Open ? (
                <SupplyPanel
                  tranchedPool={tranchedPool}
                  user={user}
                  fiatPerGfi={fiatPerGfi}
                  seniorPoolApyFromGfiRaw={
                    seniorPool.latestPoolStatus.estimatedApyFromGfiRaw
                  }
                  seniorPoolSharePrice={seniorPool.latestPoolStatus.sharePrice}
                  agreement={dealDetails.agreement}
                  isUnitrancheDeal={
                    dealDetails.dealType === Deal_DealType.Unitranche
                  }
                />
              ) : null}

              {data?.user &&
              (data?.user.tranchedPoolTokens.length > 0 ||
                data?.user.zaps.length > 0 ||
                data?.user.vaultedPoolTokens.length > 0) ? (
                <WithdrawalPanel
                  tranchedPoolAddress={tranchedPool.id}
                  poolTokens={data.user.tranchedPoolTokens}
                  vaultedPoolTokens={data.user.vaultedPoolTokens.map(
                    (v) => v.poolToken
                  )}
                  zaps={data.user.zaps}
                  isPoolLocked={
                    !tranchedPool.juniorTranches[0].lockedUntil.isZero() &&
                    BigNumber.from(data?.currentBlock?.timestamp ?? 0).gt(
                      tranchedPool.juniorTranches[0].lockedUntil
                    )
                  }
                />
              ) : null}

              {tranchedPool &&
              (poolStatus === PoolStatus.Full ||
                poolStatus === PoolStatus.Repaid) ? (
                <RepaymentProgressPanel
                  poolStatus={poolStatus}
                  tranchedPool={tranchedPool}
                  userPoolTokens={user?.tranchedPoolTokens ?? []}
                />
              ) : null}

              {poolStatus === PoolStatus.ComingSoon ? (
                <ComingSoonPanel fundableAt={tranchedPool?.fundableAt} />
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={{ gridArea: "info" }}>
          <TabGroup>
            <TabList>
              <TabButton>Deal Overview</TabButton>
              <TabButton>Borrower Profile</TabButton>
            </TabList>
            <TabPanels>
              <TabContent>
                {tranchedPool && poolStatus !== null ? (
                  <DealSummary
                    dealData={dealDetails}
                    poolChainData={tranchedPool}
                    poolStatus={poolStatus}
                  />
                ) : (
                  <ShimmerLines lines={10} />
                )}
              </TabContent>
              <TabContent>
                {data && data.borrowerOtherPools ? (
                  <BorrowerProfile
                    borrower={borrower}
                    borrowerPools={data.borrowerOtherPools}
                  />
                ) : null}
              </TabContent>
            </TabPanels>
          </TabGroup>
        </div>
      </div>
    </>
  );
}

interface StaticParams extends ParsedUrlQuery {
  address: string;
}

const allDealsQuery = gql`
  query AllDeals @api(name: cms) {
    Deals(limit: 100) {
      docs {
        id
      }
    }
  }
`;

export const getStaticPaths: GetStaticPaths<StaticParams> = async () => {
  const res = await apolloClient.query<AllDealsQuery>({
    query: allDealsQuery,
  });

  const paths =
    res.data.Deals?.docs?.map((pool) => ({
      params: {
        address: pool?.id || "",
      },
    })) || [];

  return {
    paths,
    fallback: "blocking",
  };
};

export const getStaticProps: GetStaticProps<
  PoolPageProps,
  StaticParams
> = async (context) => {
  const address = context.params?.address;
  if (!address) {
    throw new Error("No address param in getStaticProps");
  }
  const res = await apolloClient.query<
    SingleDealQuery,
    SingleDealQueryVariables
  >({
    query: singleDealQuery,
    variables: {
      id: address,
    },
    fetchPolicy: "network-only",
  });

  const poolDetails = res.data.Deal;
  if (!poolDetails) {
    return { notFound: true };
  }

  return {
    props: {
      dealDetails: poolDetails,
    },
  };
};
