import { get, put } from "@vercel/blob";
import { canonicalJson, sha256Hex } from "@/lib/scarcity-markets";
import { calculateScarcitySnapshot } from "@/lib/scarcity/engine";
import { materializeMetalState } from "@/lib/scarcity/intelligence";
import { getScarcityMetal } from "@/lib/scarcity/registry";
import { BUNDLED_USGS_SCARCITY_DATASET } from "@/lib/scarcity/usgs-baseline";
import {
  type ScarcityDataset,
  type ScarcityObservation,
  type ScarcityObservationBatch,
  type ScarcitySource,
} from "@/lib/scarcity/types";
import { validateScarcityObservation, validateScarcitySource } from "@/lib/scarcity/validation";
import { ApiSecurityError } from "@/lib/api-security";
import { strongEtag } from "./blob-etag";

const DATASET_PATH = "scarcity/data/production-v1.json";
const MAX_ARTIFACT_CHARACTERS = 5_000_000;
const MAX_DATASET_SOURCES = 2_000;
const MAX_DATASET_OBSERVATIONS = 50_000;
const MAX_STATE_SNAPSHOTS = 100_000;
const ALLOWED_ARTIFACT_TYPES = new Set([
  "application/json",
  "text/csv",
  "text/plain",
  "application/xml",
  "text/xml",
]);

const EMPTY_PRODUCTION_DATASET: ScarcityDataset = {
  id: "production-v1",
  label: "Verified production observations",
  kind: "production",
  description: "Admin-reviewed observations with content-addressed source artifacts.",
  sources: [],
  observations: [],
  stateSnapshots: [],
};
const DATASET_ETAG = Symbol("hedgents-scarcity-dataset-etag");
type RevisionedDataset = ScarcityDataset & { [DATASET_ETAG]?: string | null };

function withDatasetRevision(dataset: ScarcityDataset, etag: string | null) {
  Object.defineProperty(dataset, DATASET_ETAG, { value: etag, enumerable: true, configurable: false });
  return dataset as RevisionedDataset;
}

function withBundledBaseline(dataset?: ScarcityDataset): ScarcityDataset {
  if (!dataset) return structuredClone(BUNDLED_USGS_SCARCITY_DATASET);
  const sources = new Map(BUNDLED_USGS_SCARCITY_DATASET.sources.map((source) => [source.id, source]));
  for (const source of dataset.sources) sources.set(source.id, source);
  const observations = new Map(BUNDLED_USGS_SCARCITY_DATASET.observations.map((observation) => [observation.id, observation]));
  for (const observation of dataset.observations) observations.set(observation.id, observation);
  return {
    ...EMPTY_PRODUCTION_DATASET,
    label: dataset.observations.length > 0
      ? "USGS baseline + reviewed operator observations"
      : BUNDLED_USGS_SCARCITY_DATASET.label,
    description: dataset.observations.length > 0
      ? `${BUNDLED_USGS_SCARCITY_DATASET.description} Additional operator-reviewed observations are merged by immutable id.`
      : BUNDLED_USGS_SCARCITY_DATASET.description,
    sources: [...sources.values()].sort((left, right) => left.id.localeCompare(right.id)),
    observations: [...observations.values()].sort((left, right) => {
      const timestamp = Date.parse(left.publishedAt) - Date.parse(right.publishedAt);
      return timestamp || left.id.localeCompare(right.id);
    }),
    stateSnapshots: [...(dataset.stateSnapshots ?? [])],
  };
}

const globalScarcityDataState = globalThis as typeof globalThis & {
  __hedgentsScarcityDataset?: string;
  __hedgentsScarcityArtifacts?: Map<string, string>;
  __hedgentsScarcityBatches?: Map<string, string>;
};

function storageConfigured() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

export function scarcityDataStorageConfigured() {
  return storageConfigured();
}

function artifactPath(hash: string) {
  return `scarcity/artifacts/${hash}`;
}

function batchPath(hash: string) {
  return `scarcity/data/batches/${hash}.json`;
}

function apiArtifactPath(hash: string) {
  return `/api/scarcity/artifacts/${hash}`;
}

function parseTimestamp(value: string, label: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be an ISO timestamp.`);
  return timestamp;
}

function parseProductionDataset(value: string): ScarcityDataset {
  const parsed = JSON.parse(value) as ScarcityDataset;
  if (parsed.id !== "production-v1" || parsed.kind !== "production") {
    throw new Error("Stored scarcity dataset has an unsupported identity.");
  }
  if (!Array.isArray(parsed.sources) || !Array.isArray(parsed.observations)) {
    throw new Error("Stored scarcity dataset is malformed.");
  }
  if (parsed.sources.length > MAX_DATASET_SOURCES || parsed.observations.length > MAX_DATASET_OBSERVATIONS) {
    throw new Error("Stored scarcity dataset exceeds its bounded source or observation capacity.");
  }
  parsed.sources.forEach(validateScarcitySource);
  parsed.observations.forEach(validateScarcityObservation);
  if (parsed.stateSnapshots !== undefined && !Array.isArray(parsed.stateSnapshots)) {
    throw new Error("Stored scarcity state history is malformed.");
  }
  if ((parsed.stateSnapshots?.length ?? 0) > MAX_STATE_SNAPSHOTS) {
    throw new Error("Stored scarcity state history exceeds its capacity.");
  }
  return parsed;
}

export async function loadProductionScarcityDataset(): Promise<ScarcityDataset> {
  if (!storageConfigured()) {
    const stored = globalScarcityDataState.__hedgentsScarcityDataset;
    return stored ? withBundledBaseline(parseProductionDataset(stored)) : withBundledBaseline();
  }
  const result = await get(DATASET_PATH, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return withDatasetRevision(withBundledBaseline(), null);
  return withDatasetRevision(withBundledBaseline(parseProductionDataset(await new Response(result.stream).text())), strongEtag(result.blob.etag));
}

function validateBatch(batch: ScarcityObservationBatch) {
  if (batch.schemaVersion !== "1.0.0") throw new Error("Unsupported scarcity observation batch version.");
  if (batch.datasetId !== "production-v1") throw new Error("Only the production-v1 dataset can be published.");
  if (!/^[a-z0-9][a-z0-9:_-]{7,127}$/.test(batch.batchId)) throw new Error("Batch id is invalid.");
  validateScarcitySource(batch.source);
  if (batch.source.kind === "sample") throw new Error("Sample sources cannot be published to production.");
  if (batch.source.id.includes("replace-with") || batch.source.url?.includes("example.com")) {
    throw new Error("Schema template placeholders must be replaced before publication.");
  }
  if (!Array.isArray(batch.observations) || batch.observations.length === 0 || batch.observations.length > 1_000) {
    throw new Error("A batch must contain between 1 and 1,000 observations.");
  }
  if (!batch.artifact || !ALLOWED_ARTIFACT_TYPES.has(batch.artifact.contentType)) {
    throw new Error("Artifact content type is unsupported.");
  }
  if (!batch.artifact.content || batch.artifact.content.length > MAX_ARTIFACT_CHARACTERS) {
    throw new Error("Artifact content must contain between 1 and 5,000,000 characters.");
  }
  const sourceUrl = new URL(batch.artifact.sourceUrl);
  if (sourceUrl.protocol !== "https:" || sourceUrl.username || sourceUrl.password || batch.artifact.sourceUrl.length > 2_048) {
    throw new Error("Artifact source URL must use credential-free HTTPS.");
  }
  if (sourceUrl.hostname === "example.com" || batch.artifact.content.startsWith("Paste the exact")) {
    throw new Error("Schema template placeholders must be replaced before publication.");
  }
  const retrievedAt = parseTimestamp(batch.artifact.retrievedAt, "Artifact retrieval time");
  const reviewedAt = parseTimestamp(batch.review?.reviewedAt, "Review time");
  if (!batch.review?.reviewer?.trim()) throw new Error("A reviewer identifier is required.");
  if (reviewedAt < retrievedAt) throw new Error("Review time cannot precede artifact retrieval.");
  if (reviewedAt > Date.now() + 300_000) throw new Error("Review time cannot be in the future.");
  const ids = new Set<string>();
  for (const observation of batch.observations) {
    validateScarcityObservation(observation);
    if (observation.datasetId !== batch.datasetId) throw new Error(`Observation ${observation.id} has the wrong dataset id.`);
    if (observation.sourceId !== batch.source.id) throw new Error(`Observation ${observation.id} has the wrong source id.`);
    if (ids.has(observation.id)) throw new Error(`Observation ${observation.id} is duplicated in the batch.`);
    if (Date.parse(observation.publishedAt) > retrievedAt) {
      throw new Error(`Observation ${observation.id} was published after the source artifact was retrieved.`);
    }
    ids.add(observation.id);
  }
}

function sameCanonical(left: unknown, right: unknown) {
  return canonicalJson(left) === canonicalJson(right);
}

export async function publishScarcityObservationBatch(batch: ScarcityObservationBatch) {
  validateBatch(batch);
  const current = await loadProductionScarcityDataset();
  const datasetEtag = (current as RevisionedDataset)[DATASET_ETAG] ?? null;
  const artifactHash = sha256Hex(batch.artifact.content);
  const storedArtifactPath = artifactPath(artifactHash);
  const publicArtifactPath = apiArtifactPath(artifactHash);
  const existingSources = new Map(current.sources.map((source) => [source.id, source]));
  const existingSource = existingSources.get(batch.source.id);
  if (existingSource && !sameCanonical(existingSource, batch.source)) {
    throw new Error(`Source ${batch.source.id} is immutable; publish changed metadata under a new source id.`);
  }
  existingSources.set(batch.source.id, batch.source);

  const existingObservations = new Map(current.observations.map((observation) => [observation.id, observation]));
  const publishedObservations: ScarcityObservation[] = batch.observations.map((observation) => ({
    ...observation,
    retrievedAt: batch.artifact.retrievedAt,
    artifactHash,
    artifactPath: publicArtifactPath,
    artifactContentType: batch.artifact.contentType,
  }));
  for (const observation of publishedObservations) {
    const existing = existingObservations.get(observation.id);
    if (existing && !sameCanonical(existing, observation)) {
      throw new Error(`Observation ${observation.id} is immutable; publish a revision with a new id.`);
    }
    if (observation.revisionOf) {
      const previous = existingObservations.get(observation.revisionOf);
      if (!previous) throw new Error(`Observation ${observation.id} references an unknown revision predecessor.`);
      if (previous.metalId !== observation.metalId || previous.metricId !== observation.metricId) {
        throw new Error(`Observation ${observation.id} cannot revise a different metal or metric.`);
      }
    }
    existingObservations.set(observation.id, observation);
  }

  const next: ScarcityDataset = {
    ...EMPTY_PRODUCTION_DATASET,
    sources: [...existingSources.values()].sort((left, right) => left.id.localeCompare(right.id)),
    observations: [...existingObservations.values()].sort((left, right) => {
      const timestamp = Date.parse(left.publishedAt) - Date.parse(right.publishedAt);
      return timestamp || left.id.localeCompare(right.id);
    }),
    stateSnapshots: [...(current.stateSnapshots ?? [])],
  };
  if (next.sources.length > MAX_DATASET_SOURCES || next.observations.length > MAX_DATASET_OBSERVATIONS) {
    throw new ApiSecurityError("The production scarcity dataset has reached its reviewed-data capacity.", 409);
  }
  const stateById = new Map((next.stateSnapshots ?? []).map((state) => [state.id, state]));
  const affectedMetalIds = [...new Set(publishedObservations.map((observation) => observation.metalId))].sort();
  for (const metalId of affectedMetalIds) {
    const metal = getScarcityMetal(metalId);
    if (!metal) throw new Error(`Published observations reference unknown metal ${metalId}.`);
    const prior = [...stateById.values()]
      .filter((state) => state.metalId === metalId && Date.parse(state.asOf) < Date.parse(batch.review.reviewedAt))
      .sort((left, right) => Date.parse(right.asOf) - Date.parse(left.asOf))[0] ?? null;
    const snapshot = calculateScarcitySnapshot(metal, next, batch.review.reviewedAt);
    const materialized = materializeMetalState(snapshot, prior, batch.review.reviewedAt);
    stateById.set(materialized.id, materialized);
  }
  next.stateSnapshots = [...stateById.values()].sort((left, right) => {
    const timestamp = Date.parse(left.asOf) - Date.parse(right.asOf);
    return timestamp || left.metalId.localeCompare(right.metalId) || left.id.localeCompare(right.id);
  });
  if (next.stateSnapshots.length > MAX_STATE_SNAPSHOTS) {
    throw new ApiSecurityError("The production scarcity state history has reached its capacity.", 409);
  }
  const canonicalDataset = canonicalJson(next);
  const datasetHash = sha256Hex(canonicalDataset);
  const publishedBatch = canonicalJson({
    schemaVersion: batch.schemaVersion,
    batchId: batch.batchId,
    datasetId: batch.datasetId,
    source: batch.source,
    observations: publishedObservations,
    artifact: {
      hash: artifactHash,
      path: publicArtifactPath,
      contentType: batch.artifact.contentType,
      retrievedAt: batch.artifact.retrievedAt,
      sourceUrl: batch.artifact.sourceUrl,
    },
    review: batch.review,
    datasetHash,
  });
  const batchHash = sha256Hex(publishedBatch);

  if (!storageConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new ApiSecurityError("Scarcity data storage is not configured.", 503);
    }
    globalScarcityDataState.__hedgentsScarcityArtifacts ??= new Map();
    globalScarcityDataState.__hedgentsScarcityBatches ??= new Map();
    globalScarcityDataState.__hedgentsScarcityArtifacts.set(artifactHash, batch.artifact.content);
    globalScarcityDataState.__hedgentsScarcityBatches.set(batchHash, publishedBatch);
    globalScarcityDataState.__hedgentsScarcityDataset = canonicalDataset;
  } else {
    const existingArtifact = await get(storedArtifactPath, { access: "private", useCache: true });
    if (!existingArtifact || existingArtifact.statusCode !== 200) {
      await put(storedArtifactPath, batch.artifact.content, {
        access: "private",
        contentType: batch.artifact.contentType,
        cacheControlMaxAge: 31_536_000,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
    }
    const existingBatch = await get(batchPath(batchHash), { access: "private", useCache: true });
    if (!existingBatch || existingBatch.statusCode !== 200) {
      await put(batchPath(batchHash), publishedBatch, {
        access: "private",
        contentType: "application/json",
        cacheControlMaxAge: 31_536_000,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
    }
    await put(DATASET_PATH, canonicalDataset, {
      access: "private",
      contentType: "application/json",
      cacheControlMaxAge: 0,
      addRandomSuffix: false,
      allowOverwrite: Boolean(datasetEtag),
      ...(datasetEtag ? { ifMatch: datasetEtag } : {}),
    });
  }
  return {
    published: true,
    batchId: batch.batchId,
    batchHash,
    datasetHash,
    artifactHash,
    artifactPath: publicArtifactPath,
    observationCount: publishedObservations.length,
    datasetObservationCount: next.observations.length,
    materializedStateCount: next.stateSnapshots.length,
  };
}

export async function getScarcityObservation(id: string) {
  const dataset = await loadProductionScarcityDataset();
  return dataset.observations.find((observation) => observation.id === id) ?? null;
}

export async function readScarcityArtifact(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  if (!storageConfigured()) {
    const content = globalScarcityDataState.__hedgentsScarcityArtifacts?.get(hash);
    if (content === undefined) return null;
    const observation = (await loadProductionScarcityDataset()).observations.find((item) => item.artifactHash === hash);
    return { content, contentType: observation?.artifactContentType ?? "application/octet-stream" };
  }
  const result = await get(artifactPath(hash), { access: "private", useCache: true });
  if (!result || result.statusCode !== 200) return null;
  const observation = (await loadProductionScarcityDataset()).observations.find((item) => item.artifactHash === hash);
  return {
    content: await new Response(result.stream).text(),
    contentType: observation?.artifactContentType ?? "application/octet-stream",
  };
}

export function resetScarcityDataForTests() {
  if (process.env.NODE_ENV === "production") throw new Error("Cannot reset scarcity data in production.");
  globalScarcityDataState.__hedgentsScarcityDataset = undefined;
  globalScarcityDataState.__hedgentsScarcityArtifacts = undefined;
  globalScarcityDataState.__hedgentsScarcityBatches = undefined;
}
