import { get, put } from "@vercel/blob";
import { ApiSecurityError } from "@/lib/api-security";
import { loadOnlineDetectorState } from "@/lib/scarcity-detector-store";
import { SCARCITY_METALS } from "@/lib/scarcity";
import { MAINNET_USDC_MINT } from "@/lib/scarcity-exchange";
import {
  SCARCITY_MARKET_CATALOG,
  compileMarketDocuments,
  type ScarcityMarketRecord,
  type ScarcityQuestionDocument,
  type ScarcityRulesDocument,
} from "@/lib/scarcity-markets";

const STORE_PATH = "scarcity/markets/reviewed-specifications-v1.json";
const MAX_REVIEWED_MARKETS = 1_000;

export interface ReviewedMarketSpecification {
  schemaVersion: "1.0.0";
  candidateId: string;
  evidenceId: string;
  reviewer: string;
  publishedAt: string;
  market: ScarcityMarketRecord;
}

const marketGlobalState = globalThis as typeof globalThis & {
  __hedgentsReviewedMarketSpecifications?: string;
};

function storageConfigured() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

function validateStoredSpecification(value: ReviewedMarketSpecification) {
  if (value.schemaVersion !== "1.0.0" || !value.candidateId || !value.evidenceId || !value.reviewer.trim()) {
    throw new Error("Reviewed market provenance is malformed.");
  }
  if (!Number.isFinite(Date.parse(value.publishedAt))) throw new Error("Reviewed market publication time is invalid.");
  const compiled = compileMarketDocuments(value.market.question, value.market.rules);
  if (
    compiled.marketId !== value.market.marketId
    || compiled.questionHash !== value.market.questionHash
    || compiled.rulesHash !== value.market.rulesHash
    || compiled.canonicalQuestion !== value.market.canonicalQuestion
    || compiled.canonicalRules !== value.market.canonicalRules
  ) {
    throw new Error("Reviewed market commitments do not reproduce from the stored documents.");
  }
  if (value.market.lifecycle !== "research" || value.market.onchain !== null) {
    throw new Error("Reviewed detector markets must remain undeployed research specifications.");
  }
  return value;
}

function parseStore(serialized: string): ReviewedMarketSpecification[] {
  const parsed = JSON.parse(serialized) as unknown;
  if (!Array.isArray(parsed) || parsed.length > MAX_REVIEWED_MARKETS) {
    throw new Error("Reviewed market store is malformed or exceeds its bound.");
  }
  return parsed.map((entry) => validateStoredSpecification(entry as ReviewedMarketSpecification));
}

async function saveReviewedMarkets(markets: ReviewedMarketSpecification[], etag: string | null) {
  const serialized = JSON.stringify(markets);
  parseStore(serialized);
  if (!storageConfigured()) {
    if (process.env.NODE_ENV === "production") throw new ApiSecurityError("Reviewed market storage is not configured.", 503);
    marketGlobalState.__hedgentsReviewedMarketSpecifications = serialized;
    return;
  }
  await put(STORE_PATH, serialized, {
    access: "private",
    contentType: "application/json",
    cacheControlMaxAge: 0,
    addRandomSuffix: false,
    allowOverwrite: Boolean(etag),
    ...(etag ? { ifMatch: etag } : {}),
  });
}

async function loadReviewedMarketStore(): Promise<{ markets: ReviewedMarketSpecification[]; etag: string | null }> {
  if (!storageConfigured()) {
    return { markets: marketGlobalState.__hedgentsReviewedMarketSpecifications
      ? parseStore(marketGlobalState.__hedgentsReviewedMarketSpecifications)
      : [], etag: null };
  }
  const result = await get(STORE_PATH, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return { markets: [], etag: null };
  return { markets: parseStore(await new Response(result.stream).text()), etag: result.blob.etag };
}

export async function loadReviewedMarketSpecifications() {
  return (await loadReviewedMarketStore()).markets;
}

function plusDays(value: string, days: number) {
  return new Date(Date.parse(value) + days * 86_400_000).toISOString();
}

export async function publishReviewedDetectorCandidate(options: {
  candidateId: string;
  reviewer: string;
  publishedAt?: string;
}) {
  if (!options.reviewer.trim()) throw new Error("A reviewer identifier is required.");
  const publishedAt = new Date(options.publishedAt ?? Date.now()).toISOString();
  const state = await loadOnlineDetectorState();
  const candidate = state.candidates.find((entry) => entry.id === options.candidateId);
  if (!candidate) throw new Error("Detector candidate was not found.");
  if (candidate.readiness !== "review-ready") throw new Error("Only review-ready candidates can be published.");
  const evidence = state.evidence.find((entry) => entry.id === candidate.evidenceId);
  if (!evidence || evidence.status !== "approved" || !evidence.review) {
    throw new Error("Candidate evidence must be approved before publication.");
  }
  if (Date.parse(candidate.observationDeadline) <= Date.parse(publishedAt) + 86_400_000) {
    throw new Error("Candidate deadline is too close or has passed; create a new reviewed specification.");
  }
  const metal = SCARCITY_METALS.find((entry) => entry.id === candidate.metalId);
  if (!metal) throw new Error("Candidate references an unknown metal namespace.");

  const existing = await loadReviewedMarketSpecifications();
  const alreadyPublished = existing.find((entry) => entry.candidateId === candidate.id);
  if (alreadyPublished) return { created: false, specification: alreadyPublished };

  const slug = `${metal.id}-detector-${candidate.id.slice(0, 12)}`;
  const question: ScarcityQuestionDocument = {
    schemaVersion: "1.0.0",
    kind: "event",
    slug,
    title: `${metal.name} official-action outcome`,
    question: candidate.question,
    metal: { id: metal.id, symbol: metal.symbol, name: metal.name },
    event: {
      eventLabel: evidence.title,
      qualifyingOutcome: `The named authority publishes a final action that explicitly addresses ${metal.name} under the identified proceeding by the deadline.`,
      resolvesAt: candidate.observationDeadline,
      resolverLabel: evidence.publisher,
    },
    sources: [{
      id: evidence.sourceId,
      publisher: evidence.publisher,
      title: evidence.title,
      url: candidate.resolverUrl,
      cadence: "Event-driven official publication",
      precedence: 1,
    }],
    revisionPolicy: "Use the first final action published by the named authority by the deadline. Proposed or draft actions do not qualify; later revisions do not alter the result.",
    invalidConditions: [
      "The named authority or proceeding cannot be unambiguously identified from the preserved evidence artifact.",
      "The authority changes the proceeding so materially that the committed YES criterion is no longer objectively comparable.",
      "The primary-source artifact required to determine the outcome cannot be independently preserved and reproduced.",
    ],
  };
  const rules: ScarcityRulesDocument = {
    schemaVersion: "1.0.0",
    schedule: {
      opensAt: publishedAt,
      closesAt: candidate.observationDeadline,
      resolveAfter: plusDays(candidate.observationDeadline, 7),
    },
    network: "solana",
    collateral: { symbol: "USDC", decimals: 6, mint: String(MAINNET_USDC_MINT) },
    payout: { yes: 1, no: 1, invalid: 0.5 },
    resolution: {
      observationDelayHours: 168,
      sourceConflictPolicy: "Use the preserved named authority record. If it does not conclusively establish YES or NO after the evidence delay, resolve invalid.",
      reportSchemaVersion: "1.0.0",
    },
  };
  const market: ScarcityMarketRecord = {
    ...compileMarketDocuments(question, rules),
    lifecycle: "research",
    publication: "verified",
    warning: "Operator-reviewed detector specification only. It is not deployed, funded, quoted, or open for trading.",
    onchain: null,
  };
  const specification: ReviewedMarketSpecification = validateStoredSpecification({
    schemaVersion: "1.0.0",
    candidateId: candidate.id,
    evidenceId: evidence.id,
    reviewer: options.reviewer.trim(),
    publishedAt,
    market,
  });
  const marketIds = new Set([...SCARCITY_MARKET_CATALOG, ...existing.map((entry) => entry.market)].map((entry) => entry.marketId));
  const slugs = new Set([...SCARCITY_MARKET_CATALOG, ...existing.map((entry) => entry.market)].map((entry) => entry.question.slug));
  if (marketIds.has(market.marketId) || slugs.has(market.question.slug)) throw new Error("Reviewed market collides with an existing specification.");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await loadReviewedMarketStore();
    const duplicate = latest.markets.find((entry) => entry.candidateId === candidate.id);
    if (duplicate) return { created: false, specification: duplicate };
    const latestMarketIds = new Set([...SCARCITY_MARKET_CATALOG, ...latest.markets.map((entry) => entry.market)].map((entry) => entry.marketId));
    const latestSlugs = new Set([...SCARCITY_MARKET_CATALOG, ...latest.markets.map((entry) => entry.market)].map((entry) => entry.question.slug));
    if (latestMarketIds.has(market.marketId) || latestSlugs.has(market.question.slug)) {
      throw new Error("Reviewed market collides with an existing specification.");
    }
    try {
      await saveReviewedMarkets([specification, ...latest.markets].slice(0, MAX_REVIEWED_MARKETS), latest.etag);
      return { created: true, specification };
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
  }
  throw lastError;
}

export async function loadScarcityMarketCatalog() {
  const reviewed = await loadReviewedMarketSpecifications();
  return Object.freeze([...SCARCITY_MARKET_CATALOG, ...reviewed.map((entry) => entry.market)]);
}

export async function getStoredScarcityMarket(identifier: string) {
  const catalog = await loadScarcityMarketCatalog();
  return catalog.find((market) => market.question.slug === identifier || market.marketId === identifier) ?? null;
}

export function resetReviewedMarketsForTests() {
  if (process.env.NODE_ENV === "production") throw new Error("Cannot reset reviewed markets in production.");
  marketGlobalState.__hedgentsReviewedMarketSpecifications = undefined;
}
