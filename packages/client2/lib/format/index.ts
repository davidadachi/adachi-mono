import { BigNumber, FixedNumber, utils } from "ethers";

import { USDC_DECIMALS } from "@/constants";

const percentageFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dollarFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});

export function formatPercent(n: number | FixedNumber) {
  if (n instanceof FixedNumber) {
    return percentageFormatter.format(n.toUnsafeFloat());
  }
  return percentageFormatter.format(n);
}

export function formatUsdc(n: BigNumber) {
  const asFloat = parseFloat(utils.formatUnits(n, USDC_DECIMALS));
  return dollarFormatter.format(asFloat);
}
