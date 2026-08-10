import { get, put } from "@vercel/blob";
import { ApiSecurityError } from "@/lib/api-security";
import { METAL_PULSE_INTERVAL_SECONDS, parsePulseRoundId } from "@/lib/metal-pulse";
import type { MetalPulsePythArtifact } from "@/lib/metal-pulse-source";
import type { MetalPulseResolutionReport } from "@/lib/metal-pulse-market";
import { GOLD_PYTH_FEED_ID } from "@/lib/metal-pulse-source";
import { canonicalJson, sha256Hex } from "@/lib/scarcity-markets/canonical";

const globalPulseEvidenceState = globalThis as typeof globalThis & {
  __hedgentsPulseArtifacts?: Map<string, string>;
  __hedgentsPulseResolutions?: Map<string, string>;
};

function storageConfigured() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

function artifactPath(hash: string) {
  return `scarcity/pulse/artifacts/${hash}.json`;
}

function resolutionPath(hash: string) {
  return `scarcity/pulse/resolutions/${hash}.json`;
}

function assertHash(value: string, label: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is not a canonical SHA-256 hash.`);
}

interface StoredPythResponse {
  binary?: { encoding?: unknown; data?: unknown };
  parsed?: Array<{
    id?: unknown;
    price?: { price?: unknown; conf?: unknown; expo?: unknown; publish_time?: unknown };
    metadata?: { slot?: unknown; proof_available_time?: unknown; prev_publish_time?: unknown };
  }>;
}

function validateArtifact(artifact: MetalPulsePythArtifact) {
  if (artifact.schemaVersion !== "1.0.0" || artifact.contentType !== "application/json") {
    throw new Error("Metal Pulse Pyth artifact schema is unsupported.");
  }
  assertHash(artifact.artifactHash, "Pyth artifact hash");
  if (sha256Hex(artifact.body) !== artifact.artifactHash) throw new Error("Pyth artifact body does not match its content hash.");
  if (!artifact.body || artifact.body.length > 1_000_000) throw new Error("Pyth artifact body is empty or too large.");
  const sourceUrl = new URL(artifact.sourceUrl);
  if (sourceUrl.protocol !== "https:" || !sourceUrl.pathname.includes("/v2/updates/price/")) {
    throw new Error("Pyth artifact source URL is invalid.");
  }
  const retrievedAt = Date.parse(artifact.retrievedAt);
  if (!Number.isFinite(retrievedAt)) throw new Error("Pyth artifact retrieval time is invalid.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(artifact.body);
  } catch {
    throw new Error("Pyth artifact body is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Pyth artifact body is malformed.");
  const response = parsed as StoredPythResponse;
  if (response.binary?.encoding !== artifact.binaryEncoding || !Array.isArray(response.binary.data)) {
    throw new Error("Pyth artifact binary metadata does not match the exact response body.");
  }
  if (response.binary.data.length !== artifact.binaryUpdateCount || response.binary.data.length < 1) {
    throw new Error("Pyth artifact binary update count does not match the exact response body.");
  }
  if (!response.parsed?.some((price) => price.id === artifact.feedId)) {
    throw new Error("Pyth artifact does not contain the committed feed.");
  }
  return response;
}

function metadataTimestamp(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? new Date(Number(value) * 1_000).toISOString() : null;
}

function bindCommittedPrice(input: {
  label: "opening" | "closing";
  committed: NonNullable<MetalPulseResolutionReport["opening"]>;
  artifact: MetalPulsePythArtifact;
  response: StoredPythResponse;
  expectedRequestTime: number;
  feedId: string;
}) {
  if (input.artifact.requestedPublishTime !== input.expectedRequestTime) {
    throw new Error(`Pyth ${input.label} artifact was not requested for the committed observation timestamp.`);
  }
  if (
    input.committed.artifactHash !== input.artifact.artifactHash
    || input.committed.sourceUrl !== input.artifact.sourceUrl
    || input.committed.retrievedAt !== input.artifact.retrievedAt
    || input.committed.binaryEncoding !== input.artifact.binaryEncoding
    || input.committed.binaryUpdateCount !== input.artifact.binaryUpdateCount
  ) {
    throw new Error(`Pyth ${input.label} evidence metadata does not match its exact artifact.`);
  }
  const price = input.response.parsed?.find((candidate) => candidate.id === input.feedId);
  if (
    !price?.price
    || price.price.price !== input.committed.price
    || price.price.conf !== input.committed.confidence
    || price.price.expo !== input.committed.exponent
    || metadataTimestamp(price.price.publish_time) !== input.committed.publishedAt
  ) {
    throw new Error(`Pyth ${input.label} committed price does not match its exact artifact.`);
  }
  if (
    (Number.isSafeInteger(price.metadata?.slot) ? Number(price.metadata?.slot) : null) !== input.committed.slot
    || metadataTimestamp(price.metadata?.proof_available_time) !== input.committed.proofAvailableAt
    || metadataTimestamp(price.metadata?.prev_publish_time) !== input.committed.previousPublishAt
  ) {
    throw new Error(`Pyth ${input.label} metadata does not match its exact artifact.`);
  }
}

async function storeImmutable(path: string, content: string, existing: string | null) {
  if (existing !== null && existing !== content) throw new Error("Content-addressed evidence collision detected.");
  if (!storageConfigured() || existing !== null) return;
  await put(path, content, {
    access: "private",
    contentType: "application/json",
    cacheControlMaxAge: 31_536_000,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
}

export async function readMetalPulseArtifact(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  if (!storageConfigured()) return globalPulseEvidenceState.__hedgentsPulseArtifacts?.get(hash) ?? null;
  const result = await get(artifactPath(hash), { access: "private", useCache: true });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).text();
}

export async function readMetalPulseResolution(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  if (!storageConfigured()) return globalPulseEvidenceState.__hedgentsPulseResolutions?.get(hash) ?? null;
  const result = await get(resolutionPath(hash), { access: "private", useCache: true });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).text();
}

export async function publishMetalPulseResolutionEvidence(input: {
  report: MetalPulseResolutionReport;
  canonicalReport: string;
  resolutionReportHash: string;
  artifacts: MetalPulsePythArtifact[];
}) {
  assertHash(input.resolutionReportHash, "Resolution report hash");
  if (canonicalJson(input.report) !== input.canonicalReport || sha256Hex(input.canonicalReport) !== input.resolutionReportHash) {
    throw new Error("Metal Pulse resolution report does not match its canonical commitment.");
  }
  if (input.report.feed.feedId !== GOLD_PYTH_FEED_ID || input.report.feed.source !== "pyth-core") {
    throw new Error("Metal Pulse resolution report references an unsupported feed.");
  }
  const roundStart = parsePulseRoundId(input.report.roundId);
  if (roundStart === null) throw new Error("Metal Pulse resolution report contains an invalid round identity.");
  const artifacts = new Map<string, { artifact: MetalPulsePythArtifact; response: StoredPythResponse }>();
  for (const artifact of input.artifacts) {
    const response = validateArtifact(artifact);
    const previous = artifacts.get(artifact.artifactHash);
    if (previous && previous.artifact.body !== artifact.body) throw new Error("Duplicate Pyth artifact hash contains different content.");
    artifacts.set(artifact.artifactHash, { artifact, response });
  }
  const expected = new Set(input.report.evidenceArtifactHashes);
  for (const committed of [input.report.opening, input.report.closing]) {
    if (committed && !expected.has(committed.artifactHash)) {
      throw new Error("Committed Pyth price is not included in the report evidence manifest.");
    }
  }
  if (expected.size !== input.report.evidenceArtifactHashes.length) throw new Error("Resolution evidence manifest contains duplicate hashes.");
  for (const hash of expected) {
    assertHash(hash, "Resolution evidence artifact hash");
    if (!artifacts.has(hash)) throw new Error(`Resolution evidence artifact ${hash} was not supplied for persistence.`);
  }
  if (artifacts.size !== expected.size) throw new Error("Uncommitted Pyth artifacts cannot be attached to a resolution report.");
  for (const [label, committed, expectedRequestTime] of [
    ["opening", input.report.opening, roundStart],
    ["closing", input.report.closing, roundStart + METAL_PULSE_INTERVAL_SECONDS],
  ] as const) {
    if (!committed) continue;
    const evidence = artifacts.get(committed.artifactHash);
    if (!evidence) throw new Error(`Pyth ${label} evidence artifact is missing.`);
    bindCommittedPrice({
      label,
      committed,
      artifact: evidence.artifact,
      response: evidence.response,
      expectedRequestTime,
      feedId: input.report.feed.feedId,
    });
  }
  if (!storageConfigured() && process.env.NODE_ENV === "production") {
    throw new ApiSecurityError("Metal Pulse evidence storage is not configured.", 503);
  }

  for (const { artifact } of artifacts.values()) {
    const existing = await readMetalPulseArtifact(artifact.artifactHash);
    await storeImmutable(artifactPath(artifact.artifactHash), artifact.body, existing);
  }
  const existingReport = await readMetalPulseResolution(input.resolutionReportHash);
  await storeImmutable(resolutionPath(input.resolutionReportHash), input.canonicalReport, existingReport);
  if (!storageConfigured()) {
    globalPulseEvidenceState.__hedgentsPulseArtifacts ??= new Map();
    globalPulseEvidenceState.__hedgentsPulseResolutions ??= new Map();
    for (const { artifact } of artifacts.values()) {
      globalPulseEvidenceState.__hedgentsPulseArtifacts.set(artifact.artifactHash, artifact.body);
    }
    globalPulseEvidenceState.__hedgentsPulseResolutions.set(input.resolutionReportHash, input.canonicalReport);
  }
  const evidenceComplete = Boolean(input.report.opening && input.report.closing && expected.size > 0);
  return {
    persisted: true,
    evidenceComplete,
    signable: evidenceComplete,
    resolutionReportHash: input.resolutionReportHash,
    resolutionPath: `/api/scarcity/pulse/resolutions/${input.resolutionReportHash}`,
    artifactPaths: [...expected].sort().map((hash) => `/api/scarcity/pulse/artifacts/${hash}`),
  };
}

export function resetMetalPulseEvidenceForTests() {
  if (process.env.NODE_ENV === "production") throw new Error("Cannot reset Metal Pulse evidence in production.");
  globalPulseEvidenceState.__hedgentsPulseArtifacts = undefined;
  globalPulseEvidenceState.__hedgentsPulseResolutions = undefined;
}
