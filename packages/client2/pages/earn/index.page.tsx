import { gql } from "@apollo/client";
import { GetStaticProps, InferGetStaticPropsType } from "next";
import { useState } from "react";

import { Button, HelperText } from "@/components/design-system";
import { apolloClient } from "@/lib/graphql/apollo";
import {
  useEarnPageQuery,
  EarnPageCmsQuery,
  TranchedPoolCardDealFieldsFragment,
} from "@/lib/graphql/generated";
import {
  computeApyFromGfiInFiat,
  getTranchedPoolFundingStatus,
  TranchedPoolFundingStatus,
} from "@/lib/pools";
import {
  GoldfinchPoolsMetrics,
  GoldfinchPoolsMetricsPlaceholder,
} from "@/pages/earn/goldfinch-pools-metrics";
import {
  OpenDealCard,
  OpenDealCardPlaceholder,
} from "@/pages/earn/open-deal-card";

import { ClosedDealCard, ClosedDealCardPlaceholder } from "./closed-deal-card";

gql`
  query EarnPage {
    seniorPools(first: 1) {
      id
      name @client
      category @client
      icon @client
      estimatedApy
      estimatedApyFromGfiRaw
      sharePrice
    }
    tranchedPools(orderBy: createdAt, orderDirection: desc) {
      id
      estimatedJuniorApy
      estimatedJuniorApyFromGfiRaw
      fundableAt
      remainingCapacity
      creditLine {
        id
        limit
        balance
        termInDays
        termEndTime
        isLate @client
        isInDefault @client
      }
    }
    protocols(first: 1) {
      id
      totalDrawdowns
      totalWritedowns
      totalReserveCollected
      totalInterestCollected
      totalPrincipalCollected
    }
    gfiPrice(fiat: USD) @client {
      lastUpdated
      price {
        amount
        symbol
      }
    }
    viewer @client {
      fiduBalance
    }
  }
`;

const earnCmsQuery = gql`
  query EarnPageCMS @api(name: cms) {
    Deals(limit: 100, where: { hidden: { not_equals: true } }) {
      docs {
        id
        name
        dealType
        borrower {
          id
          name
          logo {
            url
          }
        }
      }
    }
  }
`;

export default function EarnPage({
  dealMetadata,
}: InferGetStaticPropsType<typeof getStaticProps>) {
  const { data, error } = useEarnPageQuery();

  const [showMoreClosedPools, setShowMoreClosedPools] = useState(false);

  const seniorPool = data?.seniorPools?.[0]?.estimatedApy
    ? data.seniorPools[0]
    : undefined;
  // Only display tranched pools for which we have deal metadata
  const tranchedPools = data?.tranchedPools?.filter(
    (tranchedPool) => !!dealMetadata[tranchedPool.id]
  );

  const protocol = data?.protocols[0];

  const fiatPerGfi = data?.gfiPrice?.price.amount;

  const openTranchedPools =
    tranchedPools?.filter(
      (tranchedPool) =>
        getTranchedPoolFundingStatus(tranchedPool) ===
        TranchedPoolFundingStatus.Open
    ) ?? [];
  const closedTranchedPools =
    tranchedPools?.filter(
      (tranchedPool) =>
        getTranchedPoolFundingStatus(tranchedPool) ===
          TranchedPoolFundingStatus.Closed ||
        getTranchedPoolFundingStatus(tranchedPool) ===
          TranchedPoolFundingStatus.Full
    ) ?? [];

  // +1 for Senior Pool
  const openDealsCount = openTranchedPools ? openTranchedPools.length + 1 : 0;

  const loading = !seniorPool || !fiatPerGfi || !tranchedPools || !protocol;

  return (
    <div>
      {error ? (
        <HelperText isError className="mb-12">
          There was a problem fetching data on pools. Shown data may be
          outdated.
        </HelperText>
      ) : null}
      {loading ? (
        <>
          <GoldfinchPoolsMetricsPlaceholder className="mb-20" />
          <div className="invisible mb-6">Loading</div>
          <div className="mb-15 grid gap-5 xs:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <OpenDealCardPlaceholder key={i} />
            ))}
          </div>
          <div className="invisible mb-6">Loading</div>
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <ClosedDealCardPlaceholder key={i} />
            ))}
          </div>
        </>
      ) : (
        <>
          <GoldfinchPoolsMetrics protocol={protocol} className="mb-20" />
          <div className="mb-6 font-medium text-sand-700">
            {`${openDealsCount} Open Deal${openDealsCount > 1 ? "s" : ""}`}
          </div>
          <div className="mb-15 grid gap-5 xs:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            <OpenDealCard
              icon={seniorPool.icon}
              title={seniorPool.name}
              subtitle={seniorPool.category}
              usdcApy={seniorPool.estimatedApy}
              gfiApy={computeApyFromGfiInFiat(
                seniorPool.estimatedApyFromGfiRaw,
                fiatPerGfi
              )}
              href="/pools/senior"
              dealType="seniorPool"
            />
            {openTranchedPools?.map((tranchedPool) => {
              const dealDetails = dealMetadata[
                tranchedPool.id
              ] as TranchedPoolCardDealFieldsFragment;

              const tranchedPoolApyFromGfi = computeApyFromGfiInFiat(
                tranchedPool.estimatedJuniorApyFromGfiRaw,
                fiatPerGfi
              );

              const seniorPoolApyFromGfi = computeApyFromGfiInFiat(
                seniorPool.estimatedApyFromGfiRaw,
                fiatPerGfi
              );

              const apyFromGfi =
                tranchedPool.estimatedJuniorApyFromGfiRaw.isZero()
                  ? tranchedPool.estimatedJuniorApyFromGfiRaw
                  : tranchedPoolApyFromGfi.addUnsafe(seniorPoolApyFromGfi);

              const termLengthInMonths = Math.floor(
                tranchedPool.creditLine.termInDays.toNumber() / 30
              );

              return (
                <OpenDealCard
                  key={tranchedPool.id}
                  icon={dealDetails.borrower.logo?.url}
                  title={dealDetails.name}
                  subtitle={dealDetails.category}
                  usdcApy={tranchedPool.estimatedJuniorApy}
                  gfiApy={apyFromGfi}
                  termLengthInMonths={termLengthInMonths}
                  dealType={dealDetails.dealType ?? "multitranche"}
                  href={`/pools/${tranchedPool.id}`}
                />
              );
            })}
          </div>

          <div className="mb-6 font-medium text-sand-700">
            {`${closedTranchedPools.length} Closed Pools`}
          </div>
          <div className="space-y-2">
            {closedTranchedPools.map((tranchedPool, i) => (
              <ClosedDealCard
                key={tranchedPool.id}
                // For SEO purposes, using invisible to hide pools but keep them in DOM before user clicks "view more pools"
                className={
                  !showMoreClosedPools && i >= 4 ? "hidden" : undefined
                }
                href={`/pools/${tranchedPool.id}`}
                tranchedPool={tranchedPool}
                deal={dealMetadata[tranchedPool.id]}
              />
            ))}
          </div>
          {!showMoreClosedPools && closedTranchedPools?.length > 4 && (
            <Button
              onClick={() => setShowMoreClosedPools(true)}
              className="w-full"
              colorScheme="secondary"
              size="lg"
            >
              {`View ${closedTranchedPools?.length - 4} more closed pools`}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export const getStaticProps: GetStaticProps = async () => {
  const res = await apolloClient.query<EarnPageCmsQuery>({
    query: earnCmsQuery,
    fetchPolicy: "network-only",
  });

  const deals = res.data.Deals?.docs;
  if (!deals) {
    throw new Error("No metadata found for any deals");
  }

  // This type is a crime against humanity. Blame PayloadCMS for having way too many nullable fields in the schema (https://github.com/payloadcms/payload/issues/1148)
  const dealMetadata: Record<
    string,
    NonNullable<
      NonNullable<NonNullable<EarnPageCmsQuery["Deals"]>["docs"]>[number]
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
