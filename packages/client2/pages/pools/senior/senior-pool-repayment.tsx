import { gql } from "@apollo/client";
import { Menu } from "@headlessui/react";
import { format as formatDate } from "date-fns";
import Image from "next/future/image";
import { useMemo, useState } from "react";
import {
  BarChart,
  ResponsiveContainer,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  TooltipProps,
} from "recharts";
import {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

import { Icon } from "@/components/design-system";
import { cryptoToFloat, formatCrypto, formatFiat } from "@/lib/format";
import { SeniorPoolRepaymentFieldsFragment } from "@/lib/graphql/generated";
import {
  generateRepaymentSchedule,
  REPAYMENT_SCHEDULE_FIELDS,
} from "@/lib/pools";

export const SENIOR_POOL_REPAYMENTS_FIELDS = gql`
  ${REPAYMENT_SCHEDULE_FIELDS}
  fragment SeniorPoolRepaymentFields on SeniorPool {
    repayingPools: tranchedPools(
      orderBy: nextDueTime
      orderDirection: asc
      where: { nextDueTime_not: 0 }
    ) {
      id
      name @client
      borrowerLogo @client
      ...RepaymentScheduleFields
    }
  }
`;

interface SeniorPoolRepaymentSectionProps {
  seniorPool: SeniorPoolRepaymentFieldsFragment;
}

export function SeniorPoolRepaymentSection({
  seniorPool,
}: SeniorPoolRepaymentSectionProps) {
  const { repayingPools } = seniorPool;
  const [perspective, setPerspective] = useState<"past" | "future">("future");
  const allIncomingRepayments = useMemo(() => {
    const now = new Date();
    const beginningOfThisMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0,
      0
    );
    const oneYearFromBeginningOfMonth = new Date(
      beginningOfThisMonth.getTime() + 3.154e7 * 1000
    );
    const allIncomingRepayments = repayingPools
      .flatMap((pool) =>
        generateRepaymentSchedule(pool).map((r) => ({
          ...r,
          name: pool.name,
          borrowerLogo: pool.borrowerLogo,
        }))
      )
      .filter((repayment) => {
        if (perspective === "future") {
          return (
            repayment.estimatedPaymentDate >= beginningOfThisMonth.getTime() &&
            repayment.estimatedPaymentDate <=
              oneYearFromBeginningOfMonth.getTime()
          );
        } else {
          return repayment.estimatedPaymentDate < now.getTime();
        }
      });
    allIncomingRepayments.sort(
      (a, b) => a.estimatedPaymentDate - b.estimatedPaymentDate
    );
    return allIncomingRepayments;
  }, [repayingPools, perspective]);

  const chartData = useMemo(() => {
    const buckets = allIncomingRepayments.reduce((buckets, current) => {
      const date = new Date(current.estimatedPaymentDate);
      const key = `${date.getMonth()}-${date.getFullYear()}`;
      if (buckets[key]) {
        buckets[key] = {
          period: buckets[key].period,
          amount:
            buckets[key].amount +
            cryptoToFloat({
              token: "USDC",
              amount: current.interest.add(current.principal),
            }),
          timestamp: buckets[key].timestamp,
        };
      } else {
        buckets[key] = {
          period: formatDate(date, "MMM yy"),
          amount: cryptoToFloat({
            token: "USDC",
            amount: current.interest.add(current.principal),
          }),
          timestamp: date.getTime(),
        };
      }
      return buckets;
    }, {} as Record<string, { period: string; amount: number; timestamp: number }>);
    return Object.values(buckets);
  }, [allIncomingRepayments]);

  return (
    <div className="overflow-hidden rounded-lg border border-sand-300">
      <div className="py-8 px-6">
        <div>
          <Menu as="div" className="relative mb-2">
            <Menu.Button className="flex items-center gap-2 text-xs font-medium">
              {perspective === "future"
                ? "Future repayments"
                : "Past repayments"}
              <Icon name="ChevronDown" />
            </Menu.Button>
            <Menu.Items className="absolute left-0 z-50 mt-1 flex flex-col rounded-md bg-white text-xs">
              <Menu.Item>
                <button
                  className="block px-3 py-3 text-left hover:bg-sand-50"
                  onClick={() => setPerspective("future")}
                >
                  Future repayments
                </button>
              </Menu.Item>
              <Menu.Item>
                <button
                  className="block px-3 py-3 text-left hover:bg-sand-50"
                  onClick={() => setPerspective("past")}
                >
                  Past repayments
                </button>
              </Menu.Item>
            </Menu.Items>
          </Menu>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 20 }}>
            <CartesianGrid vertical={false} />
            <Tooltip content={<CustomChartTooltip />} />
            <Bar dataKey="amount" fill="#65C397" />
            <XAxis
              dataKey="period"
              tick={{ fontSize: "8px" }}
              interval={perspective === "future" ? 0 : 1}
              padding={{ left: 36 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              mirror
              type="number"
              tick={{ fontSize: "8px", dx: -8, dy: -6, textAnchor: "start" }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-xs [&_th]:px-3.5 [&_th]:py-2 [&_th]:font-normal [&_td]:px-3.5 [&_td]:py-2">
          <thead>
            <tr className="sticky top-0 z-10 bg-mustard-100">
              <th scope="col" className="w-1/2 text-left">
                Source
              </th>
              <th scope="col" className="text-left">
                Payment date
              </th>
              <th scope="col" className="text-right">
                Amount expected
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-300">
            {allIncomingRepayments.map(
              (
                {
                  name,
                  borrowerLogo,
                  estimatedPaymentDate,
                  principal,
                  interest,
                },
                index
              ) => (
                <tr key={index}>
                  <td className="flex items-center gap-1 text-left">
                    {borrowerLogo ? (
                      <div className="relative h-3 w-3 shrink-0 overflow-hidden rounded-full">
                        <Image src={borrowerLogo} fill sizes="12px" alt="" />
                      </div>
                    ) : null}
                    <span>{name}</span>
                  </td>
                  <td className="text-left">
                    {formatDate(estimatedPaymentDate, "MMM d, y")}
                  </td>
                  <td className="text-right">
                    {formatCrypto({
                      token: "USDC",
                      amount: principal.add(interest),
                    })}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomChartTooltip({
  active,
  payload,
}: TooltipProps<ValueType, NameType>) {
  if (active && payload) {
    return (
      <div className="rounded-lg bg-white p-2 text-xs shadow-lg outline-none">
        <div className="mb-1 font-medium">
          {formatDate(payload[0].payload.timestamp, "MMMM yyyy")}
        </div>
        <div>
          {formatFiat({ amount: payload[0].payload.amount, symbol: "USD" })}
        </div>
      </div>
    );
  }
  return null;
}
