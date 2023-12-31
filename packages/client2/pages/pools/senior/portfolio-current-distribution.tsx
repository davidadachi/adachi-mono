import { gql } from "@apollo/client";
import { format as formatDate } from "date-fns";
import { BigNumber } from "ethers/lib/ethers";
import Image from "next/future/image";
import { useState } from "react";

import { Chip, Link } from "@/components/design-system";
import { DropdownMenu } from "@/components/design-system/dropdown-menu";
import { computePercentage, formatCrypto, formatPercent } from "@/lib/format";
import {
  SeniorPoolPortfolioDistributionFieldsFragment,
  SeniorPoolPortfolioPoolsDealsFieldsFragment,
} from "@/lib/graphql/generated";
import {
  getLoanRepaymentStatus,
  getLoanRepaymentStatusLabel,
  LoanRepaymentStatus,
} from "@/lib/pools";

gql`
  fragment SeniorPoolPortfolioDistributionFields on SeniorPool {
    poolsOrderedBySpInvestment: tranchedPools(
      orderBy: actualSeniorPoolInvestment
      orderDirection: desc
      # Active pools with contributions to SP
      where: {
        balance_gt: 0
        termEndTime_gt: 0
        actualSeniorPoolInvestment_gt: 0
      }
    ) {
      ...RepaymentStatusLoanFields
      actualSeniorPoolInvestment
    }
  }
`;

gql`
  fragment SeniorPoolPortfolioPoolsDealsFields on Deal {
    id
    name
    category
    dealType
    borrower {
      id
      name
      logo {
        url
      }
    }
  }
`;

interface PortfolioCurrentDistributionProps {
  seniorPool: SeniorPoolPortfolioDistributionFieldsFragment;
  dealMetadata: Record<string, SeniorPoolPortfolioPoolsDealsFieldsFragment>;
}

enum DistributionGroupByValue {
  BY_DEAL,
  BY_BORROWER,
}

const GROUP_BY_OPTIONS = [
  { value: DistributionGroupByValue.BY_DEAL, label: "by Deal" },
  { value: DistributionGroupByValue.BY_BORROWER, label: "by Borrower" },
];

interface PoolTableData {
  name: string;
  href?: string;
  icon?: string | null;
  portfolioShare: number;
  principalOwed: BigNumber;
  termEndTime?: BigNumber;
  poolRepaymentStatus?: LoanRepaymentStatus;
}
[];

function PoolStatus({
  poolRepaymentStatus,
}: {
  poolRepaymentStatus: LoanRepaymentStatus;
}) {
  return (
    <Chip
      size="sm"
      colorScheme={
        poolRepaymentStatus === LoanRepaymentStatus.GracePeriod
          ? "mustard"
          : poolRepaymentStatus === LoanRepaymentStatus.Current
          ? "dark-mint"
          : poolRepaymentStatus === LoanRepaymentStatus.Late
          ? "clay"
          : undefined
      }
    >
      {getLoanRepaymentStatusLabel(poolRepaymentStatus)}
    </Chip>
  );
}

const getTableDataByDeal = (
  dealMetadata: Record<string, SeniorPoolPortfolioPoolsDealsFieldsFragment>,
  seniorPool: SeniorPoolPortfolioDistributionFieldsFragment,
  totalSeniorPoolFundsCurrentlyInvested: BigNumber
) => {
  const poolTableData: PoolTableData[] = [];

  for (const pool of seniorPool.poolsOrderedBySpInvestment) {
    const dealDetails = dealMetadata[pool.id];

    const poolRepaymentStatus = getLoanRepaymentStatus(pool);

    const actualSeniorPoolInvestment =
      pool.actualSeniorPoolInvestment as BigNumber;

    const portfolioShare = computePercentage(
      actualSeniorPoolInvestment,
      totalSeniorPoolFundsCurrentlyInvested
    );

    poolTableData.push({
      name: dealDetails.name,
      href: `/pools/${pool.id}`,
      icon: dealDetails.borrower.logo?.url,
      portfolioShare,
      principalOwed: actualSeniorPoolInvestment,
      termEndTime: pool.termEndTime,
      poolRepaymentStatus,
    });
  }

  return poolTableData;
};

const getTableDataByBorrower = (
  dealMetadata: Record<string, SeniorPoolPortfolioPoolsDealsFieldsFragment>,
  seniorPool: SeniorPoolPortfolioDistributionFieldsFragment,
  totalSeniorPoolFundsCurrentlyInvested: BigNumber
) => {
  const tableDataByBorrowerId: Record<string, PoolTableData> = {};

  for (const pool of seniorPool.poolsOrderedBySpInvestment) {
    const deal = dealMetadata[pool.id];
    const borrowerId = deal.borrower.id;

    const actualSeniorPoolInvestment =
      pool.actualSeniorPoolInvestment as BigNumber;

    if (borrowerId) {
      if (!tableDataByBorrowerId[borrowerId]) {
        tableDataByBorrowerId[borrowerId] = {
          name: deal.borrower.name,
          icon: deal.borrower.logo?.url,
          portfolioShare: computePercentage(
            actualSeniorPoolInvestment,
            totalSeniorPoolFundsCurrentlyInvested
          ),
          principalOwed: actualSeniorPoolInvestment,
        };
      } else {
        const currentPoolTableData = tableDataByBorrowerId[borrowerId];

        tableDataByBorrowerId[borrowerId] = {
          ...currentPoolTableData,
          portfolioShare: computePercentage(
            actualSeniorPoolInvestment.add(currentPoolTableData.principalOwed),
            totalSeniorPoolFundsCurrentlyInvested
          ),
          principalOwed: actualSeniorPoolInvestment.add(
            currentPoolTableData.principalOwed
          ),
        };
      }
    }
  }

  return Object.values(tableDataByBorrowerId).sort(
    (a, b) => b.principalOwed.toNumber() - a.principalOwed.toNumber()
  );
};

export function PortfolioCurrentDistribution({
  seniorPool,
  dealMetadata,
}: PortfolioCurrentDistributionProps) {
  const [distributionGroupByOption, setDistributionGroupByOption] = useState(
    GROUP_BY_OPTIONS[0]
  );

  const totalSeniorPoolFundsCurrentlyInvested =
    seniorPool.poolsOrderedBySpInvestment.reduce(
      (sum, { actualSeniorPoolInvestment }) =>
        sum.add(actualSeniorPoolInvestment as BigNumber),
      BigNumber.from(0)
    );

  const tableData =
    distributionGroupByOption.value === DistributionGroupByValue.BY_DEAL
      ? getTableDataByDeal(
          dealMetadata,
          seniorPool,
          totalSeniorPoolFundsCurrentlyInvested
        )
      : getTableDataByBorrower(
          dealMetadata,
          seniorPool,
          totalSeniorPoolFundsCurrentlyInvested
        );

  return (
    <div className="overflow-auto rounded-xl border border-sand-300">
      <div className="flex justify-between p-6">
        <div className="text-sm">Current distribution</div>
        <DropdownMenu
          options={GROUP_BY_OPTIONS}
          selectedOption={distributionGroupByOption}
          onSelect={(option) => setDistributionGroupByOption(option)}
        />
      </div>

      <table className="w-full whitespace-nowrap text-xs [&_th]:px-3.5 [&_th]:py-2 [&_th]:font-normal [&_td]:px-3.5 [&_td]:py-2">
        <thead>
          <tr className="border-b border-sand-300 bg-mustard-100">
            <th scope="col" className="w-[30%] text-left">
              {distributionGroupByOption.value ===
              DistributionGroupByValue.BY_DEAL
                ? "Deal name"
                : "Borrower name"}
            </th>
            <th scope="col" className="w-[17.5%] text-right">
              Portfolio share
            </th>
            <th scope="col" className="w-[17.5%] text-right">
              Principal owed
            </th>
            {distributionGroupByOption.value ===
              DistributionGroupByValue.BY_DEAL && (
              <th scope="col" className="w-[17.5%] text-right">
                Maturity date
              </th>
            )}
            {distributionGroupByOption.value ===
              DistributionGroupByValue.BY_DEAL && (
              <th scope="col" className="w-[17.5%] text-right">
                Status
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-sand-300">
          {tableData?.map(
            ({
              name,
              href,
              icon,
              portfolioShare,
              principalOwed,
              termEndTime,
              poolRepaymentStatus,
            }) => {
              return (
                <tr key={name}>
                  <td className="relative w-[30%] max-w-0 !pr-0 text-left">
                    <div className="flex items-center gap-1.5">
                      <div className="relative h-3.5 w-3.5 shrink-0 overflow-hidden rounded-full border border-sand-200 bg-sand-200">
                        {icon ? (
                          <Image
                            src={icon}
                            alt={`${name}`}
                            className="object-cover"
                            fill
                            sizes="12px"
                          />
                        ) : null}
                      </div>
                      {href ? (
                        <Link
                          className="!block truncate !no-underline before:absolute before:inset-0 hover:!underline"
                          href={href}
                        >
                          {name}
                        </Link>
                      ) : (
                        <div className="truncate">{name}</div>
                      )}
                    </div>
                  </td>
                  <td className="text-right">
                    {formatPercent(portfolioShare)}
                  </td>
                  <td className="text-right">
                    {formatCrypto({
                      amount: principalOwed,
                      token: "USDC",
                    })}
                  </td>
                  {termEndTime && (
                    <td className="text-right">
                      {formatDate(
                        termEndTime.toNumber() * 1000,
                        "MMM dd, yyyy"
                      )}
                    </td>
                  )}
                  {poolRepaymentStatus && (
                    <td className="text-right">
                      <PoolStatus poolRepaymentStatus={poolRepaymentStatus} />
                    </td>
                  )}
                </tr>
              );
            }
          )}
        </tbody>
      </table>
    </div>
  );
}
