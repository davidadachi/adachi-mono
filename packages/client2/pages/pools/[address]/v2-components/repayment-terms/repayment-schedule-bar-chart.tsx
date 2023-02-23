import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Legend,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  TooltipProps,
} from "recharts";
import type { ContentType } from "recharts/types/component/DefaultLegendContent";
import {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

import { cryptoToFloat, formatFiat } from "@/lib/format";

import { RepaymentScheduleData } from "./repayment-terms-schedule";

const MAX_X_AXIS_TICKS_BEFORE_LABEL_OVERFLOW = 40;
const Y_AXIS_ROUNDING_INTERVAL = 100000;

interface RepaymentScheduleBarChartProps {
  className?: string;
  repaymentScheduleData: RepaymentScheduleData[];
}

const RepaymentScheduleBarChartLegend: ContentType = ({ payload }) => (
  <div className="flex justify-between">
    <div className="text-sm font-normal text-sand-600">Repayment schedule</div>
    <div className="flex">
      {payload?.map(({ value, color }) => (
        <div key={value} className="ml-4 flex items-center">
          <svg className="mr-2 h-1.5 w-1.5">
            <circle cx={3} cy={3} r={3} fill={color} />
          </svg>
          <div className="text-xs capitalize text-sand-500">{value}</div>
        </div>
      ))}
    </div>
  </div>
);

const RepaymentScheduleBarChartTooltip = ({
  active,
  payload,
  label,
}: TooltipProps<ValueType, NameType>) => {
  if (active && payload) {
    const interestDataPoint = payload[0];
    const principalDataPoint = payload[1];

    return (
      <div className="rounded-xl border-sand-300 bg-white p-6 outline-none">
        <div className="text-xs outline-none">
          <div className="mb-2">No.: {label}</div>
          <div style={{ color: principalDataPoint.color }} className="mb-1">
            {`Principal: ${formatFiat({
              amount: principalDataPoint.payload.principal,
              symbol: "USD",
            })}`}
          </div>
          <div style={{ color: interestDataPoint.color }}>
            {`Interest: ${formatFiat({
              amount: interestDataPoint.payload.interest,
              symbol: "USD",
            })}`}
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export function RepaymentScheduleBarChart({
  className,
  repaymentScheduleData,
}: RepaymentScheduleBarChartProps) {
  const repaymentScheduleDataFloat = repaymentScheduleData.map((data) => ({
    ...data,
    interest: cryptoToFloat({ amount: data.interest, token: "USDC" }),
    principal: cryptoToFloat({ amount: data.principal, token: "USDC" }),
  }));

  const maxYValue =
    repaymentScheduleDataFloat[repaymentScheduleDataFloat.length - 1]
      .principal +
    repaymentScheduleDataFloat[repaymentScheduleDataFloat.length - 1].interest;

  const yAxisTicks = [
    0,
    maxYValue / 4,
    maxYValue / 2,
    (3 * maxYValue) / 4,
    // Add a bit to the max Y domain i.e 2% of the max
    maxYValue + maxYValue * 0.02,
  ].map((yAxisTick) =>
    yAxisTick > Y_AXIS_ROUNDING_INTERVAL
      ? Math.round(yAxisTick / Y_AXIS_ROUNDING_INTERVAL) *
        Y_AXIS_ROUNDING_INTERVAL
      : Math.trunc(yAxisTick)
  );

  return (
    <ResponsiveContainer width="100%" height={225} className={className}>
      <BarChart
        data={repaymentScheduleDataFloat}
        margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
      >
        <Legend
          content={RepaymentScheduleBarChartLegend}
          align="right"
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 32 }}
        />
        <XAxis
          dataKey="paymentPeriod"
          tick={{ fontSize: "8px" }}
          interval={
            repaymentScheduleDataFloat.length <=
            MAX_X_AXIS_TICKS_BEFORE_LABEL_OVERFLOW
              ? 0
              : 1
          }
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: "8px", dx: -30, dy: -8, textAnchor: "start" }}
          domain={[0, maxYValue]}
          ticks={yAxisTicks}
          tickCount={5}
          width={40}
        />
        <CartesianGrid vertical={false} x={0} width={650} />
        {/* TODO: Waiting on official Tooltip UI design */}
        <Tooltip
          content={RepaymentScheduleBarChartTooltip}
          offset={15}
          // This removes the purple outline applied to the currently active tooltip
          wrapperStyle={{ boxShadow: "none" }}
        />
        <Bar dataKey="principal" stackId="a" fill="#3D755B" />
        <Bar dataKey="interest" stackId="a" fill="#65C397" />
      </BarChart>
    </ResponsiveContainer>
  );
}
