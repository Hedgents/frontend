import { address, type Address, type Instruction } from "@solana/kit";
import {
  METAL_PULSE_INTERVAL_SECONDS,
  METAL_PULSE_ENTRY_FREEZE_SECONDS,
  METAL_PULSE_OBSERVATION_TOLERANCE_SECONDS,
  pulseRoundId,
  pulseRoundStart,
  pulseRoundWindow,
  settlePulseRound,
  type MetalPulsePricePoint,
} from "./metal-pulse";
import { GOLD_PYTH_FEED_ID } from "./metal-pulse-source";
import { deriveMarketAddresses } from "./scarcity-exchange/addresses";
import {
  getCreateMarketInstruction,
  getResolveMarketInstruction,
} from "./scarcity-exchange/instructions";
import { canonicalJson, hexToBytes, sha256Hex } from "./scarcity-markets/canonical";

export const METAL_PULSE_ENTRY_LEAD_SECONDS = METAL_PULSE_INTERVAL_SECONDS;
export { METAL_PULSE_ENTRY_FREEZE_SECONDS } from "./metal-pulse";
export const METAL_PULSE_RESOLUTION_GRACE_SECONDS = METAL_PULSE_OBSERVATION_TOLERANCE_SECONDS;
export const METAL_PULSE_SOURCE_HEALTH_SECONDS = 120;

export interface MetalPulseQuestionDocument {
  schemaVersion: "1.0.0";
  template: "hedgents-metal-pulse-15";
  roundId: string;
  slug: string;
  title: string;
  question: string;
  metal: { id: "gold"; symbol: "Au"; name: "Gold" };
  observation: {
    source: "pyth-core";
    symbol: "XAU/USD";
    feedId: string;
    openingAt: string;
    closingAt: string;
    toleranceSeconds: number;
    comparison: "closing-price-greater-than-opening-price";
    equalPriceOutcome: "invalid";
  };
  invalidConditions: string[];
}

export interface MetalPulseRulesDocument {
  schemaVersion: "1.0.0";
  marketType: "binary-price-window";
  schedule: {
    tradingOpensAt: string;
    tradingClosesAt: string;
    observationStartsAt: string;
    observationEndsAt: string;
    resolveAfter: string;
  };
  network: "solana";
  collateral: { symbol: "USDC"; decimals: 6; mint: string };
  payout: { yes: 1; no: 1; invalid: 0.5 };
  resolution: {
    reportSchemaVersion: "1.0.0";
    authorityModel: "snapshotted-resolver";
    sourcePrecedence: ["pyth-core"];
  };
}

export interface CompiledMetalPulseMarket {
  marketId: string;
  questionHash: string;
  rulesHash: string;
  canonicalQuestion: string;
  canonicalRules: string;
  question: MetalPulseQuestionDocument;
  rules: MetalPulseRulesDocument;
  onchainSchedule: { opensAt: bigint; closesAt: bigint; resolveAfter: bigint };
}

export interface MetalPulseResolutionReport {
  schemaVersion: "1.0.0";
  template: "hedgents-metal-pulse-15-resolution";
  marketId: string;
  questionHash: string;
  rulesHash: string;
  roundId: string;
  feed: { source: "pyth-core"; symbol: "XAU/USD"; feedId: string };
  opening: MetalPulseCommittedPrice | null;
  closing: MetalPulseCommittedPrice | null;
  evidenceArtifactHashes: string[];
  outcome: "yes" | "no" | "invalid";
  invalidReason: string | null;
  comparison: "closing-price-greater-than-opening-price";
  generatedAt: string;
}

export interface MetalPulseCommittedPrice {
  price: string;
  confidence: string;
  exponent: number;
  publishedAt: string;
  artifactHash: string;
  sourceUrl: string;
  retrievedAt: string;
  binaryEncoding: "hex" | "base64";
  binaryUpdateCount: number;
  slot: number | null;
  proofAvailableAt: string | null;
  previousPublishAt: string | null;
}

export type MetalPulsePlanAction = "create-ready" | "queued" | "exists" | "missed" | "source-paused";

export interface MetalPulseRoundPlan {
  action: MetalPulsePlanAction;
  reason: string;
  market: CompiledMetalPulseMarket;
  addresses: Awaited<ReturnType<typeof deriveMarketAddresses>>;
  createInstruction: Instruction;
}

function iso(unixSeconds: number) {
  return new Date(unixSeconds * 1_000).toISOString();
}

function unix(isoTimestamp: string, label: string) {
  const parsed = Date.parse(isoTimestamp) / 1_000;
  if (!Number.isInteger(parsed) || new Date(parsed * 1_000).toISOString() !== isoTimestamp) {
    throw new Error(`${label} must be a whole-second ISO-8601 UTC timestamp.`);
  }
  return parsed;
}

function committedPrice(point: MetalPulsePricePoint | null) {
  if (!point) return null;
  if (!point.raw || !/^-?\d+$/.test(point.raw.price) || !/^\d+$/.test(point.raw.confidence)) {
    throw new Error("Pyth resolution points require exact raw price and confidence integers.");
  }
  if (!Number.isInteger(point.raw.exponent) || point.raw.exponent < -18 || point.raw.exponent > 18) {
    throw new Error("Pyth resolution exponent is outside the supported range.");
  }
  if (!point.evidence || !/^[a-f0-9]{64}$/.test(point.evidence.artifactHash)) {
    throw new Error("Pyth resolution points require a content-addressed Hermes evidence artifact.");
  }
  const sourceUrl = new URL(point.evidence.sourceUrl);
  if (sourceUrl.protocol !== "https:" || !sourceUrl.pathname.includes("/v2/updates/price/")) {
    throw new Error("Pyth evidence source URL is invalid.");
  }
  if (!Number.isInteger(point.evidence.binaryUpdateCount) || point.evidence.binaryUpdateCount < 1) {
    throw new Error("Pyth evidence must contain at least one signed binary update.");
  }
  unix(point.publishedAt, "Pyth publish time");
  unix(point.evidence.retrievedAt, "Pyth retrieval time");
  return {
    price: point.raw.price,
    confidence: point.raw.confidence,
    exponent: point.raw.exponent,
    publishedAt: point.publishedAt,
    ...point.evidence,
  } satisfies MetalPulseCommittedPrice;
}

export function compileMetalPulseMarket(input: {
  startsAtUnix: number;
  collateralMint: Address | string;
}): CompiledMetalPulseMarket {
  if (pulseRoundStart(input.startsAtUnix) !== input.startsAtUnix) {
    throw new Error("Metal Pulse observation start must align to a 15-minute UTC boundary.");
  }
  const collateralMint = String(address(String(input.collateralMint)));
  const { id: roundId, startsAtUnix, endsAtUnix } = pulseRoundWindow(input.startsAtUnix);
  const tradingOpensAtUnix = startsAtUnix - METAL_PULSE_ENTRY_LEAD_SECONDS;
  const tradingClosesAtUnix = startsAtUnix - METAL_PULSE_ENTRY_FREEZE_SECONDS;
  const resolveAfterUnix = endsAtUnix + METAL_PULSE_RESOLUTION_GRACE_SECONDS;
  const question: MetalPulseQuestionDocument = {
    schemaVersion: "1.0.0",
    template: "hedgents-metal-pulse-15",
    roundId,
    slug: `metal-pulse-${roundId}`,
    title: `Gold 15 · ${iso(startsAtUnix)}`,
    question: `Will the Pyth XAU/USD closing price at ${iso(endsAtUnix)} be higher than its opening price at ${iso(startsAtUnix)}?`,
    metal: { id: "gold", symbol: "Au", name: "Gold" },
    observation: {
      source: "pyth-core",
      symbol: "XAU/USD",
      feedId: GOLD_PYTH_FEED_ID,
      openingAt: iso(startsAtUnix),
      closingAt: iso(endsAtUnix),
      toleranceSeconds: METAL_PULSE_OBSERVATION_TOLERANCE_SECONDS,
      comparison: "closing-price-greater-than-opening-price",
      equalPriceOutcome: "invalid",
    },
    invalidConditions: [
      "No opening observation from the committed feed is published inside the allowed opening window.",
      "No closing observation from the committed feed is published inside the allowed closing window.",
      "The exact opening and closing Pyth integer prices are equal after exponent normalization.",
      "The committed feed identity or canonical resolution report cannot be verified.",
    ],
  };
  const rules: MetalPulseRulesDocument = {
    schemaVersion: "1.0.0",
    marketType: "binary-price-window",
    schedule: {
      tradingOpensAt: iso(tradingOpensAtUnix),
      tradingClosesAt: iso(tradingClosesAtUnix),
      observationStartsAt: iso(startsAtUnix),
      observationEndsAt: iso(endsAtUnix),
      resolveAfter: iso(resolveAfterUnix),
    },
    network: "solana",
    collateral: { symbol: "USDC", decimals: 6, mint: collateralMint },
    payout: { yes: 1, no: 1, invalid: 0.5 },
    resolution: {
      reportSchemaVersion: "1.0.0",
      authorityModel: "snapshotted-resolver",
      sourcePrecedence: ["pyth-core"],
    },
  };
  const canonicalQuestion = canonicalJson(question);
  const canonicalRules = canonicalJson(rules);
  const questionHash = sha256Hex(canonicalQuestion);
  const rulesHash = sha256Hex(canonicalRules);
  const marketId = sha256Hex(canonicalJson({
    schemaVersion: "1.0.0",
    template: question.template,
    roundId,
    questionHash,
    rulesHash,
  }));
  return {
    marketId,
    questionHash,
    rulesHash,
    canonicalQuestion,
    canonicalRules,
    question,
    rules,
    onchainSchedule: {
      opensAt: BigInt(tradingOpensAtUnix),
      closesAt: BigInt(tradingClosesAtUnix),
      resolveAfter: BigInt(resolveAfterUnix),
    },
  };
}

export async function buildMetalPulseCreatePacket(input: {
  startsAtUnix: number;
  admin: Address;
  collateralMint: Address;
}) {
  const market = compileMetalPulseMarket(input);
  const marketId = hexToBytes(market.marketId);
  const addresses = await deriveMarketAddresses(marketId);
  const createInstruction = await getCreateMarketInstruction({
    admin: input.admin,
    collateralMint: input.collateralMint,
    marketId,
    questionHash: hexToBytes(market.questionHash),
    rulesHash: hexToBytes(market.rulesHash),
    ...market.onchainSchedule,
  });
  return { market, addresses, createInstruction };
}

export async function buildMetalPulseResolutionPacket(input: {
  market: CompiledMetalPulseMarket;
  resolver: Address;
  opening: MetalPulsePricePoint | null;
  closing: MetalPulsePricePoint | null;
  generatedAt: string;
}) {
  const generatedAtUnix = unix(input.generatedAt, "Resolution generation time");
  if (generatedAtUnix < Number(input.market.onchainSchedule.resolveAfter)) {
    throw new Error("Metal Pulse resolution cannot be prepared before the committed resolution time.");
  }
  const startsAtUnix = unix(input.market.question.observation.openingAt, "Opening time");
  if (pulseRoundId(startsAtUnix) !== input.market.question.roundId) {
    throw new Error("Metal Pulse market round identity does not match its observation window.");
  }
  const settled = settlePulseRound(input.opening, input.closing, startsAtUnix);
  const outcome = settled.outcome === "up" ? "yes" : settled.outcome === "down" ? "no" : "invalid";
  const opening = committedPrice(input.opening);
  const closing = committedPrice(input.closing);
  const evidenceArtifactHashes = [...new Set([opening?.artifactHash, closing?.artifactHash].filter((hash): hash is string => Boolean(hash)))].sort();
  const report: MetalPulseResolutionReport = {
    schemaVersion: "1.0.0",
    template: "hedgents-metal-pulse-15-resolution",
    marketId: input.market.marketId,
    questionHash: input.market.questionHash,
    rulesHash: input.market.rulesHash,
    roundId: input.market.question.roundId,
    feed: { source: "pyth-core", symbol: "XAU/USD", feedId: GOLD_PYTH_FEED_ID },
    opening,
    closing,
    evidenceArtifactHashes,
    outcome,
    invalidReason: settled.invalidReason,
    comparison: "closing-price-greater-than-opening-price",
    generatedAt: input.generatedAt,
  };
  const canonicalReport = canonicalJson(report);
  const resolutionReportHash = sha256Hex(canonicalReport);
  const resolveInstruction = await getResolveMarketInstruction({
    resolver: input.resolver,
    marketId: hexToBytes(input.market.marketId),
    outcome,
    resolutionReportHash: hexToBytes(resolutionReportHash),
  });
  return { report, canonicalReport, resolutionReportHash, resolveInstruction };
}

export function serializeMetalPulseInstruction(instruction: Instruction) {
  return {
    programAddress: String(instruction.programAddress),
    accounts: instruction.accounts?.map((account) => ({ address: String(account.address), role: account.role })) ?? [],
    dataHex: Array.from(instruction.data ?? []).map((value) => value.toString(16).padStart(2, "0")).join(""),
  };
}

export async function planMetalPulseRounds(input: {
  now: Date;
  admin: Address;
  collateralMint: Address;
  sourceLatestPublishedAt: string | null;
  existingMarketIds?: ReadonlySet<string>;
  horizonRounds?: number;
}) {
  const nowUnix = Math.floor(input.now.getTime() / 1_000);
  if (!Number.isFinite(nowUnix)) throw new Error("Planner time is invalid.");
  const horizonRounds = input.horizonRounds ?? 4;
  if (!Number.isInteger(horizonRounds) || horizonRounds < 1 || horizonRounds > 12) {
    throw new Error("Metal Pulse planning horizon must be between one and twelve rounds.");
  }
  let sourceAgeSeconds: number | null = null;
  if (input.sourceLatestPublishedAt) {
    sourceAgeSeconds = nowUnix - unix(input.sourceLatestPublishedAt, "Latest Pyth publish time");
  }
  const sourceHealthy = sourceAgeSeconds !== null
    && sourceAgeSeconds >= -METAL_PULSE_OBSERVATION_TOLERANCE_SECONDS
    && sourceAgeSeconds <= METAL_PULSE_SOURCE_HEALTH_SECONDS;
  const firstStart = pulseRoundStart(nowUnix) + METAL_PULSE_INTERVAL_SECONDS;
  const plans: MetalPulseRoundPlan[] = [];
  for (let index = 0; index < horizonRounds; index += 1) {
    const startsAtUnix = firstStart + index * METAL_PULSE_INTERVAL_SECONDS;
    const packet = await buildMetalPulseCreatePacket({
      startsAtUnix,
      admin: input.admin,
      collateralMint: input.collateralMint,
    });
    const opensAt = Number(packet.market.onchainSchedule.opensAt);
    const closesAt = Number(packet.market.onchainSchedule.closesAt);
    let action: MetalPulsePlanAction;
    let reason: string;
    if (input.existingMarketIds?.has(packet.market.marketId)) {
      action = "exists";
      reason = "The deterministic market ID is already present in the supplied deployment inventory.";
    } else if (nowUnix >= closesAt) {
      action = "missed";
      reason = "The entry window has already closed; the factory must not create this round late.";
    } else if (nowUnix < opensAt) {
      action = "queued";
      reason = "The round is outside the one-interval creation window.";
    } else if (!sourceHealthy) {
      action = "source-paused";
      reason = "The Pyth metal source is stale or unavailable, so automated creation fails closed.";
    } else {
      action = "create-ready";
      reason = "The source is current and the committed entry window is open.";
    }
    plans.push({ action, reason, ...packet });
  }
  return {
    mode: "prepare-only" as const,
    now: input.now.toISOString(),
    sourceHealthy,
    sourceAgeSeconds,
    horizonRounds,
    readyCount: plans.filter((plan) => plan.action === "create-ready").length,
    plans,
  };
}
