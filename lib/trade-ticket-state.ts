import type { TradeSide } from "./execution-types";

// The sell side is quoted in metal units but capped in dollars, so a default or Max size taken
// straight from the wallet balance is unexecutable for any holder above the beta cap. Leave a
// margin so a small price move between sizing the ticket and quoting it does not cross the cap.
const SELL_CAP_SAFETY_MARGIN = 0.98;
const FALLBACK_SELL_AMOUNT = "0.1";

function flooredUnits(units: number) {
  if (!Number.isFinite(units) || units <= 0) return null;
  const decimals = units >= 1 ? 4 : 8;
  const factor = 10 ** decimals;
  // Round down: rounding up would push the default back over the cap it was derived from.
  const floored = Math.floor(units * factor) / factor;
  return floored > 0 ? String(Number(floored.toFixed(decimals))) : null;
}

/**
 * Largest metal quantity the closed beta will actually execute, given the wallet balance and the
 * current unit price. Without a price the cap cannot be expressed in metal units, so the balance
 * is returned unchanged and the server remains the authority.
 */
export function maximumSellAmount(
  betaMaximumUsd: number,
  selectedProductBalance: string | undefined,
  unitPriceUsd?: number | null,
) {
  const balance = Number(selectedProductBalance);
  const heldUnits = Number.isFinite(balance) && balance > 0 ? balance : 0;
  const price = typeof unitPriceUsd === "number" && Number.isFinite(unitPriceUsd) && unitPriceUsd > 0
    ? unitPriceUsd
    : null;
  if (!price) return heldUnits > 0 ? selectedProductBalance! : FALLBACK_SELL_AMOUNT;
  const cappedUnits = (betaMaximumUsd * SELL_CAP_SAFETY_MARGIN) / price;
  const target = heldUnits > 0 ? Math.min(heldUnits, cappedUnits) : cappedUnits;
  return flooredUnits(target) ?? FALLBACK_SELL_AMOUNT;
}

export function defaultAmountForTradeSide(
  side: TradeSide,
  betaMaximumUsd: number,
  selectedProductBalance: string | undefined,
  unitPriceUsd?: number | null,
) {
  if (side === "buy") return String(Math.min(100, betaMaximumUsd));
  return maximumSellAmount(betaMaximumUsd, selectedProductBalance, unitPriceUsd);
}
