export const METAL_PULSE_INTERVAL_SECONDS = 15 * 60;

/**
 * How stale the gold feed may be before the underlying market counts as shut.
 *
 * Pyth publishes XAU/USD roughly every second while spot gold trades, and stops dead at the daily
 * break (21:00 UTC) and over the weekend. The API stays healthy throughout, so provider health says
 * nothing about whether the market is open: only the publish time does.
 *
 * This matters beyond presentation. A round whose window falls inside the break opens and closes at
 * the same frozen price, ties, and settles invalid, so every bet placed in it is refunded and none
 * can win. Three minutes is far beyond any normal publishing gap and well short of the shortest
 * closure.
 */
export const METAL_PULSE_STALE_AFTER_SECONDS = 180;

/** Whether the feed is still publishing, given its most recent publish time. */
export function isMetalPulseMarketOpen(input: { publishedAt: string | null; nowUnix: number }) {
  if (!input.publishedAt) return false;
  const publishedAtUnix = Math.floor(Date.parse(input.publishedAt) / 1_000);
  if (!Number.isFinite(publishedAtUnix)) return false;
  return input.nowUnix - publishedAtUnix <= METAL_PULSE_STALE_AFTER_SECONDS;
}
export const METAL_PULSE_FREEZE_SECONDS = 15;
export const METAL_PULSE_ENTRY_FREEZE_SECONDS = 15;
export const METAL_PULSE_OBSERVATION_TOLERANCE_SECONDS = 60;
export const METAL_PULSE_PAPER_PRICE_CENTS = 50;

export type MetalPulseDirection = "up" | "down";
export type MetalPulseOutcome = MetalPulseDirection | "invalid";
export type MetalPulseRoundStatus = "scheduled" | "trading" | "frozen" | "resolved" | "invalid" | "session-closed";

export interface MetalPulsePricePoint {
  priceUsd: number;
  confidenceUsd: number;
  publishedAt: string;
  raw?: {
    price: string;
    confidence: string;
    exponent: number;
  };
  evidence?: {
    artifactHash: string;
    sourceUrl: string;
    retrievedAt: string;
    binaryEncoding: "hex" | "base64";
    binaryUpdateCount: number;
    slot: number | null;
    proofAvailableAt: string | null;
    previousPublishAt: string | null;
  };
}

export interface MetalPulseRound {
  id: string;
  metalId: "gold";
  sourceSymbol: "XAU/USD";
  intervalSeconds: number;
  entryClosesAt: string;
  startsAt: string;
  freezesAt: string;
  endsAt: string;
  status: MetalPulseRoundStatus;
  opening: MetalPulsePricePoint | null;
  latest: MetalPulsePricePoint | null;
  closing: MetalPulsePricePoint | null;
  outcome: MetalPulseOutcome | null;
  invalidReason: string | null;
  paperQuote: {
    kind: "fixed-simulation";
    upCents: number;
    downCents: number;
  };
}

export interface MetalPulseSnapshot {
  mode: "paper";
  asOf: string;
  providerState: "online" | "degraded";
  providerMessage?: string;
  source: {
    name: "Pyth Core";
    symbol: "XAU/USD";
    feedId: string;
    settlementState: "paper-only";
  };
  previous: MetalPulseRound;
  current: MetalPulseRound;
  next: MetalPulseRound;
  refreshAfterMs: number;
  separation: string;
}

export interface MetalPulsePaperPosition {
  id: string;
  roundId: string;
  direction: MetalPulseDirection;
  stakeUsdc: number;
  entryPriceCents: number;
  shares: number;
  placedAt: string;
  status: "open" | "won" | "lost" | "invalid";
  payoutUsdc: number;
}

export interface MetalPulsePaperAccount {
  version: 1;
  balanceUsdc: number;
  positions: MetalPulsePaperPosition[];
}

function roundMoney(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function pulseRoundStart(unixSeconds: number) {
  if (!Number.isFinite(unixSeconds)) throw new Error("Round time must be finite.");
  return Math.floor(unixSeconds / METAL_PULSE_INTERVAL_SECONDS) * METAL_PULSE_INTERVAL_SECONDS;
}

export function pulseRoundId(startsAtUnix: number) {
  const canonicalStart = pulseRoundStart(startsAtUnix);
  if (canonicalStart !== startsAtUnix) throw new Error("Round start must align to a 15-minute boundary.");
  return `gold-15m-${canonicalStart}`;
}

export function parsePulseRoundId(id: string) {
  const match = /^gold-15m-(\d{10})$/.exec(id);
  if (!match) return null;
  const startsAtUnix = Number(match[1]);
  return pulseRoundStart(startsAtUnix) === startsAtUnix ? startsAtUnix : null;
}

export function pulseRoundWindow(startsAtUnix: number) {
  const id = pulseRoundId(startsAtUnix);
  const endsAtUnix = startsAtUnix + METAL_PULSE_INTERVAL_SECONDS;
  return {
    id,
    entryClosesAtUnix: startsAtUnix - METAL_PULSE_ENTRY_FREEZE_SECONDS,
    startsAtUnix,
    freezesAtUnix: endsAtUnix - METAL_PULSE_FREEZE_SECONDS,
    endsAtUnix,
  };
}

export function observationFitsWindow(point: MetalPulsePricePoint | null, targetUnix: number) {
  if (!point) return false;
  const observedUnix = Date.parse(point.publishedAt) / 1_000;
  return Number.isFinite(observedUnix)
    && observedUnix >= targetUnix
    && observedUnix <= targetUnix + METAL_PULSE_OBSERVATION_TOLERANCE_SECONDS;
}

function exactPythPrice(point: MetalPulsePricePoint) {
  if (
    !point.raw
    || !/^-?\d+$/.test(point.raw.price)
    || !Number.isInteger(point.raw.exponent)
    || point.raw.exponent < -18
    || point.raw.exponent > 18
  ) return null;
  return { value: BigInt(point.raw.price), exponent: point.raw.exponent };
}

export function compareMetalPulsePrices(opening: MetalPulsePricePoint, closing: MetalPulsePricePoint) {
  const openingExact = exactPythPrice(opening);
  const closingExact = exactPythPrice(closing);
  if (openingExact && closingExact) {
    const commonExponent = Math.min(openingExact.exponent, closingExact.exponent);
    const openingValue = openingExact.value * 10n ** BigInt(openingExact.exponent - commonExponent);
    const closingValue = closingExact.value * 10n ** BigInt(closingExact.exponent - commonExponent);
    return closingValue === openingValue ? 0 : closingValue > openingValue ? 1 : -1;
  }
  return closing.priceUsd === opening.priceUsd ? 0 : closing.priceUsd > opening.priceUsd ? 1 : -1;
}

export function settlePulseRound(
  opening: MetalPulsePricePoint | null,
  closing: MetalPulsePricePoint | null,
  startsAtUnix: number,
): { outcome: MetalPulseOutcome; invalidReason: string | null } {
  const { endsAtUnix } = pulseRoundWindow(startsAtUnix);
  if (!opening || !observationFitsWindow(opening, startsAtUnix)) {
    return { outcome: "invalid", invalidReason: "No valid Pyth opening observation was published inside the committed window." };
  }
  if (!closing || !observationFitsWindow(closing, endsAtUnix)) {
    return { outcome: "invalid", invalidReason: "No valid Pyth closing observation was published inside the committed window." };
  }
  const comparison = compareMetalPulsePrices(opening, closing);
  if (comparison === 0) {
    return { outcome: "invalid", invalidReason: "Opening and closing prices were equal; paper positions are returned at cost." };
  }
  return { outcome: comparison > 0 ? "up" : "down", invalidReason: null };
}

export function buildPulseRound(input: {
  startsAtUnix: number;
  nowUnix: number;
  opening?: MetalPulsePricePoint | null;
  latest?: MetalPulsePricePoint | null;
  closing?: MetalPulsePricePoint | null;
}): MetalPulseRound {
  const { id, startsAtUnix, freezesAtUnix, endsAtUnix } = pulseRoundWindow(input.startsAtUnix);
  const opening = input.opening ?? null;
  const closing = input.closing ?? null;
  const latest = input.latest ?? closing ?? opening;
  let status: MetalPulseRoundStatus;
  let outcome: MetalPulseOutcome | null = null;
  let invalidReason: string | null = null;

  if (input.nowUnix < startsAtUnix) {
    status = "scheduled";
  } else if (input.nowUnix >= endsAtUnix) {
    const settlement = settlePulseRound(opening, closing, startsAtUnix);
    outcome = settlement.outcome;
    invalidReason = settlement.invalidReason;
    status = outcome === "invalid" ? "invalid" : "resolved";
  } else if (!observationFitsWindow(opening, startsAtUnix)) {
    status = "session-closed";
    invalidReason = "The source did not publish an opening observation for this interval.";
  } else if (!latest || Date.parse(latest.publishedAt) / 1_000 < startsAtUnix) {
    status = "session-closed";
    invalidReason = "The source is not publishing inside this interval.";
  } else {
    status = input.nowUnix >= freezesAtUnix ? "frozen" : "trading";
  }

  return {
    id,
    metalId: "gold",
    sourceSymbol: "XAU/USD",
    intervalSeconds: METAL_PULSE_INTERVAL_SECONDS,
    entryClosesAt: new Date((startsAtUnix - METAL_PULSE_ENTRY_FREEZE_SECONDS) * 1_000).toISOString(),
    startsAt: new Date(startsAtUnix * 1_000).toISOString(),
    freezesAt: new Date(freezesAtUnix * 1_000).toISOString(),
    endsAt: new Date(endsAtUnix * 1_000).toISOString(),
    status,
    opening,
    latest,
    closing,
    outcome,
    invalidReason,
    paperQuote: {
      kind: "fixed-simulation",
      upCents: METAL_PULSE_PAPER_PRICE_CENTS,
      downCents: METAL_PULSE_PAPER_PRICE_CENTS,
    },
  };
}

export function createMetalPulsePaperAccount(balanceUsdc = 1_000): MetalPulsePaperAccount {
  return { version: 1, balanceUsdc: roundMoney(balanceUsdc), positions: [] };
}

export function placeMetalPulsePaperPosition(input: {
  account: MetalPulsePaperAccount;
  round: MetalPulseRound;
  direction: MetalPulseDirection;
  stakeUsdc: number;
  placedAt?: string;
  positionId?: string;
}) {
  if (input.round.status !== "scheduled") throw new Error("Paper entries are accepted only before the observation window opens.");
  const placedAt = input.placedAt ?? new Date().toISOString();
  const placedAtUnix = Date.parse(placedAt);
  if (!Number.isFinite(placedAtUnix)) throw new Error("Paper entry time is invalid.");
  if (placedAtUnix >= Date.parse(input.round.entryClosesAt)) {
    throw new Error("Paper entry is frozen for the final 15 seconds before the observation window.");
  }
  if (!Number.isFinite(input.stakeUsdc) || input.stakeUsdc < 1 || input.stakeUsdc > 100) {
    throw new Error("Paper stake must be between 1 and 100 USDC.");
  }
  if (input.stakeUsdc > input.account.balanceUsdc) throw new Error("Paper balance is too low for this entry.");
  if (input.account.positions.some((position) => position.roundId === input.round.id)) {
    throw new Error("Only one paper position is allowed per round in the current simulator.");
  }
  const entryPriceCents = input.direction === "up" ? input.round.paperQuote.upCents : input.round.paperQuote.downCents;
  const position: MetalPulsePaperPosition = {
    id: input.positionId ?? `${input.round.id}:${input.direction}:${placedAt}`,
    roundId: input.round.id,
    direction: input.direction,
    stakeUsdc: roundMoney(input.stakeUsdc),
    entryPriceCents,
    shares: roundMoney(input.stakeUsdc / (entryPriceCents / 100)),
    placedAt,
    status: "open",
    payoutUsdc: 0,
  };
  return {
    account: {
      ...input.account,
      balanceUsdc: roundMoney(input.account.balanceUsdc - input.stakeUsdc),
      positions: [position, ...input.account.positions],
    },
    position,
  };
}

export function settleMetalPulsePaperAccount(
  account: MetalPulsePaperAccount,
  rounds: ReadonlyMap<string, MetalPulseRound>,
) {
  let credit = 0;
  let changed = false;
  const positions = account.positions.map((position) => {
    if (position.status !== "open") return position;
    const round = rounds.get(position.roundId);
    if (!round || (round.status !== "resolved" && round.status !== "invalid")) return position;
    changed = true;
    if (round.outcome === "invalid") {
      credit += position.stakeUsdc;
      return { ...position, status: "invalid" as const, payoutUsdc: position.stakeUsdc };
    }
    if (round.outcome === position.direction) {
      const payoutUsdc = roundMoney(position.shares);
      credit += payoutUsdc;
      return { ...position, status: "won" as const, payoutUsdc };
    }
    return { ...position, status: "lost" as const, payoutUsdc: 0 };
  });
  return changed
    ? { ...account, balanceUsdc: roundMoney(account.balanceUsdc + credit), positions }
    : account;
}
