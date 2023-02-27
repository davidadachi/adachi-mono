import { gql } from "@apollo/client";
import { format } from "date-fns";
import { FixedNumber } from "ethers";

import {
  InfoIconTooltip,
  Shimmer,
  Stat,
  StatGrid,
} from "@/components/design-system";
import { formatCrypto, formatPercent } from "@/lib/format";
import { CapitalStatsFieldsFragment } from "@/lib/graphql/generated";

export const CAPITAL_STATS_SENIOR_POOL_FIELDS = gql`
  fragment CapitalStatsFields on SeniorPool {
    assets
    totalLoansOutstanding
    defaultRate
    tranchedPools(orderBy: nextDueTime, orderDirection: desc, first: 1) {
      id
      nextDueTime
    }
  }
`;

interface CapitalStatsProps {
  seniorPool: CapitalStatsFieldsFragment;
}

export function CapitalStats({ seniorPool }: CapitalStatsProps) {
  const { assets, totalLoansOutstanding, defaultRate, tranchedPools } =
    seniorPool;
  const utilizationRate = FixedNumber.from(totalLoansOutstanding).divUnsafe(
    FixedNumber.from(assets)
  );
  return (
    <StatGrid bgColor="mustard-50" numColumns={3}>
      <div className="col-span-full bg-mustard-50 p-6">
        <div className="mb-5 flex justify-between gap-8">
          <div>
            <div className="mb-3 flex gap-2 text-sm">
              Capital allocated <InfoIconTooltip content="TODO content" />
            </div>
            <div className="text-lg font-medium">
              {formatCrypto({ token: "USDC", amount: totalLoansOutstanding })}
            </div>
          </div>
          <div>
            <div className="mb-3 flex gap-2 text-sm">
              Total pool assets <InfoIconTooltip content="TODO content" />
            </div>
            <div className="text-lg font-medium">
              {formatCrypto({ token: "USDC", amount: assets })}
            </div>
          </div>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-mustard-100">
          <div
            className="h-full rounded-full bg-mustard-600"
            style={{
              width: `${utilizationRate
                .mulUnsafe(FixedNumber.from(100))
                .toString()}%`,
            }}
          />
        </div>
      </div>
      <Stat
        label="Utilization rate"
        tooltip="Utilization rate of capital invested in the Senior Pool."
        value={formatPercent(utilizationRate)}
      />
      <Stat
        label="Avg. default rate"
        tooltip="Default rate experienced by the Senior Pool."
        value={formatPercent(defaultRate)}
      />
      <Stat
        label="Next repayment"
        tooltip="The next expected repayment date for a Tranched Pool that the Senior Pool has invested in."
        value={
          tranchedPools.length !== 0
            ? format(
                tranchedPools[0].nextDueTime.toNumber() * 1000,
                "MMM dd, yyyy"
              )
            : "-"
        }
      />
    </StatGrid>
  );
}

export function CapitalStatsPlaceholder() {
  return (
    <StatGrid bgColor="mustard-50" numColumns={3}>
      <div className="col-span-full bg-mustard-50 p-6">
        <div className="mb-5 flex justify-between gap-8">
          <div>
            <div className="mb-3 flex gap-2 text-sm">Capital allocated</div>
            <div className="text-lg font-medium">
              <Shimmer style={{ width: "12ch" }} />
            </div>
          </div>
          <div>
            <div className="mb-3 flex gap-2 text-sm">Total pool assets</div>
            <div className="text-lg font-medium">
              <Shimmer style={{ width: "12ch" }} />
            </div>
          </div>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-mustard-100"></div>
      </div>
      <Stat label="Utilization rate" />
      <Stat label="Avg. default rate" />
      <Stat label="Next repayment" />
    </StatGrid>
  );
}
