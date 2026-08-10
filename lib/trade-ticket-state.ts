import type { TradeSide } from "./execution-types";

export function defaultAmountForTradeSide(
  side: TradeSide,
  betaMaximumUsd: number,
  selectedProductBalance: string | undefined,
) {
  if (side === "buy") return String(Math.min(100, betaMaximumUsd));
  return selectedProductBalance && Number(selectedProductBalance) > 0
    ? selectedProductBalance
    : "0.1";
}
