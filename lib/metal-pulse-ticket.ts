/**
 * What a Gold 15 bet costs and pays, computed the way the program computes it.
 *
 * The screen promises a bettor an exact cost before the wallet opens, so this mirrors the on-chain
 * arithmetic rather than approximating it. Two details matter and both are easy to get wrong:
 *
 *   - The program rounds the quote and the fee UP (`ceil_mul_div`), so a floating-point estimate
 *     drifts below the real debit and the wallet then asks for more than the screen quoted.
 *   - It charges the difference between the order's cumulative quote and what it has already
 *     collected, not the cost of this fill in isolation. On a partially filled order those differ by
 *     a base unit or two, which is exactly the size of discrepancy that reads as dishonest.
 *
 * Everything here is integer base units: collateral and contracts both carry six decimals, so one
 * contract is 1_000_000 and it redeems for 1_000_000 collateral if it wins.
 */

export const PULSE_TOKEN_DECIMALS = 6;
export const PULSE_TOKEN_SCALE = 1_000_000n;
const BPS_SCALE = 10_000n;

/** The stakes offered on the screen, in whole collateral units. */
export const PULSE_STAKE_CHOICES = [1, 5, 10, 25] as const;

export interface PulseOffer {
  maker: string;
  orderId: string;
  priceMicroUsdc: string;
  remainingQuantity: string;
  feeBps: number;
  originalQuantity: string;
  quoteFilled: string;
  feePaid: string;
}

export interface PulseTicket {
  /** Contracts bought, in base units. This is the `quantity` the fill instruction takes. */
  quantity: bigint;
  /** Paid to the maker. */
  gross: bigint;
  /** Paid to the fee recipient, on top of the gross. */
  fee: bigint;
  /** What actually leaves the taker's collateral account. */
  cost: bigint;
  /** What the position redeems for if the round settles this side. */
  payout: bigint;
  /** Payout less cost. Negative is impossible here but the type does not know that. */
  profit: bigint;
  /** True when the offer could not absorb the requested stake and the ticket was cut down. */
  capped: boolean;
}

function ceilMulDiv(left: bigint, right: bigint, denominator: bigint) {
  const product = left * right;
  return (product + denominator - 1n) / denominator;
}

/** `quote_for_quantity` from the program. */
export function pulseQuote(quantity: bigint, priceMicroUsdc: bigint) {
  return ceilMulDiv(quantity, priceMicroUsdc, PULSE_TOKEN_SCALE);
}

/** `fee_for_quote` from the program. */
export function pulseFee(quote: bigint, feeBps: number) {
  if (feeBps === 0 || quote === 0n) return 0n;
  return ceilMulDiv(quote, BigInt(feeBps), BPS_SCALE);
}

/**
 * Price a stake against a resting ask.
 *
 * `stake` is what the bettor asked to spend, in base units. The quantity is floored so the cost
 * never exceeds it, and clamped to what the offer has left. Returns null when nothing can be
 * bought, which is the honest answer for an exhausted book and keeps the caller from rendering a
 * zero-contract ticket.
 */
export function priceMetalPulseTicket(input: { offer: PulseOffer; stake: bigint }): PulseTicket | null {
  const price = BigInt(input.offer.priceMicroUsdc);
  const remaining = BigInt(input.offer.remainingQuantity);
  if (price <= 0n || remaining <= 0n || input.stake <= 0n) return null;

  // Floor, so the quoted cost lands at or under the stake the bettor chose.
  const requested = (input.stake * PULSE_TOKEN_SCALE) / price;
  const quantity = requested > remaining ? remaining : requested;
  if (quantity <= 0n) return null;

  // The program's own delta arithmetic: cumulative totals at the new fill level, less what the
  // order has already taken.
  const filledBefore = BigInt(input.offer.originalQuantity) - remaining;
  const quoteAfter = pulseQuote(filledBefore + quantity, price);
  const feeAfter = pulseFee(quoteAfter, input.offer.feeBps);
  const gross = quoteAfter - BigInt(input.offer.quoteFilled);
  const fee = feeAfter - BigInt(input.offer.feePaid);
  const cost = gross + fee;

  return {
    quantity,
    gross,
    fee,
    cost,
    // A winning contract redeems one for one, so the payout is the contract count itself.
    payout: quantity,
    profit: quantity - cost,
    capped: requested > remaining,
  };
}

/** Base units to a human string, without the float round trip. */
export function formatPulseAmount(baseUnits: bigint, decimals = 2) {
  const negative = baseUnits < 0n;
  const magnitude = negative ? -baseUnits : baseUnits;
  const whole = magnitude / PULSE_TOKEN_SCALE;
  const fraction = magnitude % PULSE_TOKEN_SCALE;
  const padded = fraction.toString().padStart(PULSE_TOKEN_DECIMALS, "0").slice(0, decimals);
  return `${negative ? "−" : ""}${whole}${decimals > 0 ? `.${padded}` : ""}`;
}
