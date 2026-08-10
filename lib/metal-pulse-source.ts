import {
  METAL_PULSE_INTERVAL_SECONDS,
  buildPulseRound,
  pulseRoundStart,
  pulseRoundWindow,
  type MetalPulsePricePoint,
  type MetalPulseRound,
  type MetalPulseSnapshot,
} from "./metal-pulse";
import { sha256Hex } from "./scarcity-markets/canonical";

export const GOLD_PYTH_FEED_ID = "765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2";

interface ParsedPythPrice {
  id: string;
  price: { price: string; conf: string; expo: number; publish_time: number };
  metadata?: {
    slot?: number;
    proof_available_time?: number;
    prev_publish_time?: number;
  };
}

interface PythResponse {
  binary?: {
    data?: string[];
    encoding?: "hex" | "base64";
  };
  parsed?: ParsedPythPrice[];
}

export interface MetalPulsePythArtifact {
  schemaVersion: "1.0.0";
  artifactHash: string;
  contentType: "application/json";
  body: string;
  sourceUrl: string;
  retrievedAt: string;
  requestedPublishTime: number | null;
  feedId: string;
  binaryEncoding: "hex" | "base64";
  binaryUpdateCount: number;
}

export interface MetalPulseRoundFetch {
  round: MetalPulseRound;
  artifacts: { opening: MetalPulsePythArtifact | null; closing: MetalPulsePythArtifact | null };
  providerState: "online" | "degraded";
  providerMessage?: string;
}

interface FetchedPythPoint {
  point: MetalPulsePricePoint | null;
  artifact: MetalPulsePythArtifact;
}

type PulseFetch = (input: string | URL | Request, init?: RequestInit & { next?: { revalidate?: number } }) => Promise<Response>;

function pythNumber(price: ParsedPythPrice["price"], field: "price" | "conf") {
  return Number(price[field]) * 10 ** price.expo;
}

function optionalTimestamp(value: number | undefined) {
  return Number.isInteger(value) && Number(value) > 0 ? new Date(Number(value) * 1_000).toISOString() : null;
}

function normalizePythPoint(payload: PythResponse, artifact: MetalPulsePythArtifact): MetalPulsePricePoint | null {
  const item = payload.parsed?.find((candidate) => candidate.id === GOLD_PYTH_FEED_ID);
  if (!item || item.price.publish_time <= 0) return null;
  const priceUsd = pythNumber(item.price, "price");
  const confidenceUsd = pythNumber(item.price, "conf");
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || !Number.isFinite(confidenceUsd) || confidenceUsd < 0) return null;
  return {
    priceUsd,
    confidenceUsd,
    publishedAt: new Date(item.price.publish_time * 1_000).toISOString(),
    raw: {
      price: item.price.price,
      confidence: item.price.conf,
      exponent: item.price.expo,
    },
    evidence: {
      artifactHash: artifact.artifactHash,
      sourceUrl: artifact.sourceUrl,
      retrievedAt: artifact.retrievedAt,
      binaryEncoding: artifact.binaryEncoding,
      binaryUpdateCount: artifact.binaryUpdateCount,
      slot: Number.isSafeInteger(item.metadata?.slot) ? Number(item.metadata?.slot) : null,
      proofAvailableAt: optionalTimestamp(item.metadata?.proof_available_time),
      previousPublishAt: optionalTimestamp(item.metadata?.prev_publish_time),
    },
  };
}

function pythConfig(apiKey = process.env.PYTH_API_KEY?.trim()) {
  return apiKey
    ? { baseUrl: "https://pyth.dourolabs.app/hermes", headers: { Authorization: `Bearer ${apiKey}` } as Record<string, string> }
    : { baseUrl: "https://hermes.pyth.network", headers: {} as Record<string, string> };
}

async function fetchPythPoint(input: {
  timestamp?: number;
  fetchImpl: PulseFetch;
  apiKey?: string;
}): Promise<FetchedPythPoint> {
  const { baseUrl, headers } = pythConfig(input.apiKey);
  const path = input.timestamp === undefined
    ? "/v2/updates/price/latest"
    : `/v2/updates/price/${input.timestamp}`;
  const params = new URLSearchParams({ parsed: "true", ignore_invalid_price_ids: "true" });
  params.append("ids[]", GOLD_PYTH_FEED_ID);
  const sourceUrl = `${baseUrl}${path}?${params}`;
  const response = await input.fetchImpl(sourceUrl, {
    headers: { ...headers, Accept: "application/json" },
    cache: input.timestamp === undefined ? "no-store" : undefined,
    next: input.timestamp === undefined ? undefined : { revalidate: 86_400 },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Pyth Core returned ${response.status}.`);
  const body = await response.text();
  if (!body || body.length > 1_000_000) throw new Error("Pyth Core response body is empty or exceeds the evidence limit.");
  let payload: PythResponse;
  try {
    payload = JSON.parse(body) as PythResponse;
  } catch {
    throw new Error("Pyth Core returned malformed JSON.");
  }
  const encoding = payload.binary?.encoding;
  const binaryData = payload.binary?.data;
  if ((encoding !== "hex" && encoding !== "base64") || !Array.isArray(binaryData) || binaryData.length === 0) {
    throw new Error("Pyth Core response does not include the signed binary update payload.");
  }
  if (binaryData.some((value) => typeof value !== "string" || value.length === 0 || value.length > 500_000)) {
    throw new Error("Pyth Core binary update payload is malformed.");
  }
  const artifact: MetalPulsePythArtifact = {
    schemaVersion: "1.0.0",
    artifactHash: sha256Hex(body),
    contentType: "application/json",
    body,
    sourceUrl,
    retrievedAt: new Date(Math.floor(Date.now() / 1_000) * 1_000).toISOString(),
    requestedPublishTime: input.timestamp ?? null,
    feedId: GOLD_PYTH_FEED_ID,
    binaryEncoding: encoding,
    binaryUpdateCount: binaryData.length,
  };
  return { point: normalizePythPoint(payload, artifact), artifact };
}

async function settledPoint<T>(promise: Promise<T>) {
  try {
    return { value: await promise, error: null as string | null };
  } catch (error) {
    return { value: null as T | null, error: error instanceof Error ? error.message : "Pyth Core request failed." };
  }
}

export async function fetchMetalPulseSnapshot(options: {
  now?: Date;
  fetchImpl?: PulseFetch;
  apiKey?: string;
} = {}): Promise<MetalPulseSnapshot> {
  const now = options.now ?? new Date();
  const nowUnix = Math.floor(now.getTime() / 1_000);
  const currentStart = pulseRoundStart(nowUnix);
  const previousStart = currentStart - METAL_PULSE_INTERVAL_SECONDS;
  const nextStart = currentStart + METAL_PULSE_INTERVAL_SECONDS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const [latestResult, previousOpeningResult, boundaryResult] = await Promise.all([
    settledPoint(fetchPythPoint({ fetchImpl, apiKey: options.apiKey })),
    settledPoint(fetchPythPoint({ timestamp: previousStart, fetchImpl, apiKey: options.apiKey })),
    settledPoint(fetchPythPoint({ timestamp: currentStart, fetchImpl, apiKey: options.apiKey })),
  ]);
  const errors = [latestResult.error, previousOpeningResult.error, boundaryResult.error].filter(Boolean);
  const latest = latestResult.value?.point ?? null;
  const boundary = boundaryResult.value?.point ?? null;
  return {
    mode: "paper",
    asOf: now.toISOString(),
    providerState: errors.length ? "degraded" : "online",
    ...(errors.length ? { providerMessage: [...new Set(errors)].join(" ") } : {}),
    source: {
      name: "Pyth Core",
      symbol: "XAU/USD",
      feedId: GOLD_PYTH_FEED_ID,
      settlementState: "paper-only",
    },
    previous: buildPulseRound({
      startsAtUnix: previousStart,
      nowUnix,
      opening: previousOpeningResult.value?.point ?? null,
      closing: boundary,
      latest: boundary,
    }),
    current: buildPulseRound({
      startsAtUnix: currentStart,
      nowUnix,
      opening: boundary,
      latest,
    }),
    next: buildPulseRound({ startsAtUnix: nextStart, nowUnix }),
    refreshAfterMs: 5_000,
    separation: "Metal Pulse is a paper execution simulator. Its fixed 50-cent quote is not a crowd probability, executable venue price, or live-capital offer.",
  };
}

export async function fetchMetalPulseRound(input: {
  startsAtUnix: number;
  now?: Date;
  fetchImpl?: PulseFetch;
  apiKey?: string;
}): Promise<MetalPulseRoundFetch> {
  const now = input.now ?? new Date();
  const nowUnix = Math.floor(now.getTime() / 1_000);
  const fetchImpl = input.fetchImpl ?? fetch;
  const { endsAtUnix } = pulseRoundWindow(input.startsAtUnix);
  const [openingResult, secondResult] = await Promise.all([
    settledPoint(fetchPythPoint({ timestamp: input.startsAtUnix, fetchImpl, apiKey: input.apiKey })),
    settledPoint(fetchPythPoint({
      timestamp: endsAtUnix <= nowUnix ? endsAtUnix : undefined,
      fetchImpl,
      apiKey: input.apiKey,
    })),
  ]);
  const errors = [openingResult.error, secondResult.error].filter(Boolean);
  const openingFetch = openingResult.value;
  const closingFetch = endsAtUnix <= nowUnix ? secondResult.value : null;
  return {
    round: buildPulseRound({
      startsAtUnix: input.startsAtUnix,
      nowUnix,
      opening: openingFetch?.point ?? null,
      latest: secondResult.value?.point ?? null,
      closing: closingFetch?.point ?? null,
    }),
    artifacts: {
      opening: openingFetch?.artifact ?? null,
      closing: closingFetch?.artifact ?? null,
    },
    providerState: errors.length ? "degraded" : "online",
    ...(errors.length ? { providerMessage: [...new Set(errors)].join(" ") } : {}),
  };
}
