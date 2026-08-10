import { canonicalJson, sha256Hex } from "./scarcity-markets/canonical";

const PRICE_SCALE = 1_000_000n;
const BPS_SCALE = 10_000n;

export type MakerResolutionOutcome = "yes" | "no" | "invalid";

export interface MetalPulseMakerQuotePlan {
  mode: "simulation";
  marketId: string;
  allocationMicroUsdc: bigint;
  completeSetQuantity: bigint;
  yesAsk: { priceMicroUsdc: bigint; quantity: bigint; orderId: string };
  noAsk: { priceMicroUsdc: bigint; quantity: bigint; orderId: string };
  maximumOneSidedLossMicroUsdc: bigint;
  bothFilledGrossEdgeMicroUsdc: bigint;
}

export interface MetalPulseMakerRoundInput {
  quote: MetalPulseMakerQuotePlan;
  yesFilled: bigint;
  noFilled: bigint;
  outcome: MakerResolutionOutcome;
  startingCapitalMicroUsdc: bigint;
}

function requireNonNegative(value: bigint, label: string) {
  if (value < 0n) throw new Error(`${label} cannot be negative.`);
}

function quoteFor(quantity: bigint, priceMicroUsdc: bigint) {
  requireNonNegative(quantity, "Quantity");
  if (priceMicroUsdc <= 0n || priceMicroUsdc > PRICE_SCALE) throw new Error("Maker price must be in (0, 1] USDC.");
  return (quantity * priceMicroUsdc + PRICE_SCALE - 1n) / PRICE_SCALE;
}

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}

export function buildMetalPulseMakerQuotePlan(input: {
  marketId: string;
  availableCapitalMicroUsdc: bigint;
  maxRoundAllocationMicroUsdc: bigint;
  allocationBps?: number;
  yesAskPriceMicroUsdc?: bigint;
  noAskPriceMicroUsdc?: bigint;
  quoteVersion?: number;
}): MetalPulseMakerQuotePlan {
  if (!/^[a-f0-9]{64}$/.test(input.marketId)) throw new Error("Maker plan requires a canonical 32-byte market ID.");
  requireNonNegative(input.availableCapitalMicroUsdc, "Available capital");
  requireNonNegative(input.maxRoundAllocationMicroUsdc, "Round allocation cap");
  const allocationBps = input.allocationBps ?? 2_000;
  if (!Number.isInteger(allocationBps) || allocationBps < 1 || allocationBps > 10_000) {
    throw new Error("Maker allocation must be between 1 and 10,000 bps.");
  }
  const yesPrice = input.yesAskPriceMicroUsdc ?? 520_000n;
  const noPrice = input.noAskPriceMicroUsdc ?? 520_000n;
  if (yesPrice <= 0n || yesPrice > PRICE_SCALE || noPrice <= 0n || noPrice > PRICE_SCALE) {
    throw new Error("Maker asks must be greater than zero and no more than one USDC.");
  }
  if (yesPrice + noPrice < PRICE_SCALE) {
    throw new Error("A fully collateralized two-sided ask must not lock in a loss when both outcomes fill.");
  }
  const proportional = input.availableCapitalMicroUsdc * BigInt(allocationBps) / BPS_SCALE;
  const allocation = minimum(minimum(proportional, input.maxRoundAllocationMicroUsdc), input.availableCapitalMicroUsdc);
  if (allocation === 0n) throw new Error("Maker allocation rounds to zero.");
  const quoteVersion = input.quoteVersion ?? 1;
  if (!Number.isInteger(quoteVersion) || quoteVersion < 1) throw new Error("Maker quote version must be a positive integer.");
  const orderId = (outcome: "yes" | "no") => sha256Hex(canonicalJson({
    schemaVersion: "1.0.0",
    strategy: "metal-pulse-symmetric-asks",
    marketId: input.marketId,
    outcome,
    quoteVersion,
    priceMicroUsdc: String(outcome === "yes" ? yesPrice : noPrice),
    quantity: String(allocation),
  }));
  const bothFilledGross = quoteFor(allocation, yesPrice) + quoteFor(allocation, noPrice);
  const cheapestFill = yesPrice < noPrice ? yesPrice : noPrice;
  const maximumOneSidedLoss = allocation - quoteFor(allocation, cheapestFill);
  return {
    mode: "simulation",
    marketId: input.marketId,
    allocationMicroUsdc: allocation,
    completeSetQuantity: allocation,
    yesAsk: { priceMicroUsdc: yesPrice, quantity: allocation, orderId: orderId("yes") },
    noAsk: { priceMicroUsdc: noPrice, quantity: allocation, orderId: orderId("no") },
    maximumOneSidedLossMicroUsdc: maximumOneSidedLoss,
    bothFilledGrossEdgeMicroUsdc: bothFilledGross - allocation,
  };
}

export function simulateMetalPulseMakerRound(input: MetalPulseMakerRoundInput) {
  const quantity = input.quote.completeSetQuantity;
  requireNonNegative(input.startingCapitalMicroUsdc, "Starting capital");
  requireNonNegative(input.yesFilled, "YES fill");
  requireNonNegative(input.noFilled, "NO fill");
  if (quantity > input.startingCapitalMicroUsdc) throw new Error("Maker does not have enough free collateral for this quote.");
  if (input.yesFilled > quantity || input.noFilled > quantity) throw new Error("A simulated fill exceeds the quoted quantity.");

  let freeCollateral = input.startingCapitalMicroUsdc - quantity;
  let yesInventory = quantity - input.yesFilled;
  let noInventory = quantity - input.noFilled;
  const quoteCollected = quoteFor(input.yesFilled, input.quote.yesAsk.priceMicroUsdc)
    + quoteFor(input.noFilled, input.quote.noAsk.priceMicroUsdc);
  freeCollateral += quoteCollected;

  const mergedCompleteSets = minimum(yesInventory, noInventory);
  yesInventory -= mergedCompleteSets;
  noInventory -= mergedCompleteSets;
  freeCollateral += mergedCompleteSets;

  const resolutionPayout = input.outcome === "yes"
    ? yesInventory
    : input.outcome === "no"
      ? noInventory
      : yesInventory / 2n + noInventory / 2n;
  const endingCapital = freeCollateral + resolutionPayout;
  return {
    marketId: input.quote.marketId,
    startingCapitalMicroUsdc: input.startingCapitalMicroUsdc,
    allocatedMicroUsdc: quantity,
    yesFilled: input.yesFilled,
    noFilled: input.noFilled,
    quoteCollectedMicroUsdc: quoteCollected,
    mergedCompleteSets,
    yesInventoryAtResolution: yesInventory,
    noInventoryAtResolution: noInventory,
    outcome: input.outcome,
    resolutionPayoutMicroUsdc: resolutionPayout,
    endingCapitalMicroUsdc: endingCapital,
    profitMicroUsdc: endingCapital - input.startingCapitalMicroUsdc,
    capitalTurnoverBps: input.startingCapitalMicroUsdc === 0n
      ? 0n
      : quantity * BPS_SCALE / input.startingCapitalMicroUsdc,
  };
}

export function simulateRollingMetalPulseMaker(input: {
  initialCapitalMicroUsdc: bigint;
  rounds: Array<{
    marketId: string;
    yesFilledBps: number;
    noFilledBps: number;
    outcome: MakerResolutionOutcome;
  }>;
  maxRoundAllocationMicroUsdc: bigint;
  allocationBps?: number;
  yesAskPriceMicroUsdc?: bigint;
  noAskPriceMicroUsdc?: bigint;
}) {
  requireNonNegative(input.initialCapitalMicroUsdc, "Initial capital");
  let capital = input.initialCapitalMicroUsdc;
  const results = input.rounds.map((round, index) => {
    for (const [label, value] of [["YES fill", round.yesFilledBps], ["NO fill", round.noFilledBps]] as const) {
      if (!Number.isInteger(value) || value < 0 || value > 10_000) throw new Error(`${label} must be between 0 and 10,000 bps.`);
    }
    const quote = buildMetalPulseMakerQuotePlan({
      marketId: round.marketId,
      availableCapitalMicroUsdc: capital,
      maxRoundAllocationMicroUsdc: input.maxRoundAllocationMicroUsdc,
      allocationBps: input.allocationBps,
      yesAskPriceMicroUsdc: input.yesAskPriceMicroUsdc,
      noAskPriceMicroUsdc: input.noAskPriceMicroUsdc,
      quoteVersion: index + 1,
    });
    const result = simulateMetalPulseMakerRound({
      quote,
      startingCapitalMicroUsdc: capital,
      yesFilled: quote.completeSetQuantity * BigInt(round.yesFilledBps) / BPS_SCALE,
      noFilled: quote.completeSetQuantity * BigInt(round.noFilledBps) / BPS_SCALE,
      outcome: round.outcome,
    });
    capital = result.endingCapitalMicroUsdc;
    return { quote, result };
  });
  return {
    mode: "simulation" as const,
    initialCapitalMicroUsdc: input.initialCapitalMicroUsdc,
    endingCapitalMicroUsdc: capital,
    profitMicroUsdc: capital - input.initialCapitalMicroUsdc,
    rounds: results,
  };
}
