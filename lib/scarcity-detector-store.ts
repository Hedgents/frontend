import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";
import { ApiSecurityError } from "@/lib/api-security";
import {
  EMPTY_ONLINE_DETECTOR_STATE,
  rebuildOnlineOutputs,
  type OnlineDetectorState,
  type OnlineEvidenceStatus,
} from "@/lib/scarcity/online-detector";

const STATE_PATH = "scarcity/detector/state-v1.json";
const MAX_STATE_ITEMS = 2_000;
const STATE_ETAG = Symbol("hedgents-detector-state-etag");
type RevisionedDetectorState = OnlineDetectorState & { [STATE_ETAG]?: string | null };

const detectorGlobalState = globalThis as typeof globalThis & {
  __hedgentsOnlineDetectorState?: string;
  __hedgentsOnlineDetectorArtifacts?: Map<string, { content: string; contentType: string }>;
};

function storageConfigured() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

function artifactPath(hash: string) {
  return `scarcity/detector/artifacts/${hash}`;
}

function publicArtifactPath(hash: string) {
  return `/api/scarcity/detector/artifacts/${hash}`;
}

function cloneEmptyState(): OnlineDetectorState {
  return structuredClone(EMPTY_ONLINE_DETECTOR_STATE);
}

function validIsoOrNull(value: unknown) {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function parseState(value: string): OnlineDetectorState {
  const parsed = JSON.parse(value) as OnlineDetectorState;
  if (parsed.schemaVersion !== "1.0.0") throw new Error("Online detector state version is unsupported.");
  if (!Array.isArray(parsed.sources) || !Array.isArray(parsed.evidence) || !Array.isArray(parsed.signals)
    || !Array.isArray(parsed.candidates) || !Array.isArray(parsed.alerts) || !Array.isArray(parsed.runs)) {
    throw new Error("Online detector state is malformed.");
  }
  if (!validIsoOrNull(parsed.lastRunAt) || !validIsoOrNull(parsed.lastSuccessfulRunAt)) {
    throw new Error("Online detector timestamps are malformed.");
  }
  if (parsed.evidence.length > MAX_STATE_ITEMS) throw new Error("Online detector evidence exceeds the storage bound.");
  return parsed;
}

function withRevision(state: OnlineDetectorState, etag: string | null) {
  Object.defineProperty(state, STATE_ETAG, { value: etag, enumerable: true, configurable: false });
  return state as RevisionedDetectorState;
}

export function onlineDetectorStorageConfigured() {
  return storageConfigured();
}

export async function loadOnlineDetectorState(): Promise<OnlineDetectorState> {
  if (!storageConfigured()) {
    return detectorGlobalState.__hedgentsOnlineDetectorState
      ? parseState(detectorGlobalState.__hedgentsOnlineDetectorState)
      : cloneEmptyState();
  }
  const result = await get(STATE_PATH, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return withRevision(cloneEmptyState(), null);
  return withRevision(parseState(await new Response(result.stream).text()), result.blob.etag);
}

export async function saveOnlineDetectorState(state: OnlineDetectorState) {
  const etag = (state as RevisionedDetectorState)[STATE_ETAG] ?? null;
  const bounded: OnlineDetectorState = {
    ...state,
    evidence: state.evidence.slice(0, MAX_STATE_ITEMS),
    signals: state.signals.slice(0, 5_000),
    candidates: state.candidates.slice(0, 1_000),
    alerts: state.alerts.slice(0, 200),
    runs: state.runs.slice(0, 90),
  };
  const serialized = JSON.stringify(bounded);
  parseState(serialized);
  if (!storageConfigured()) {
    if (process.env.NODE_ENV === "production") throw new ApiSecurityError("Online detector storage is not configured.", 503);
    detectorGlobalState.__hedgentsOnlineDetectorState = serialized;
    return bounded;
  }
  await put(STATE_PATH, serialized, {
    access: "private",
    contentType: "application/json",
    cacheControlMaxAge: 0,
    addRandomSuffix: false,
    allowOverwrite: Boolean(etag),
    ...(etag ? { ifMatch: etag } : {}),
  });
  return bounded;
}

export async function saveOnlineDetectorArtifact(content: string, contentType: string) {
  if (!content || content.length > 5_000_000) throw new Error("Detector artifacts must contain between 1 and 5,000,000 characters.");
  const hash = createHash("sha256").update(content).digest("hex");
  if (!storageConfigured()) {
    if (process.env.NODE_ENV === "production") throw new ApiSecurityError("Online detector storage is not configured.", 503);
    detectorGlobalState.__hedgentsOnlineDetectorArtifacts ??= new Map();
    detectorGlobalState.__hedgentsOnlineDetectorArtifacts.set(hash, { content, contentType });
    return { hash, path: publicArtifactPath(hash) };
  }
  const path = artifactPath(hash);
  const existing = await get(path, { access: "private", useCache: true });
  if (!existing || existing.statusCode !== 200) {
    await put(path, content, {
      access: "private",
      contentType,
      cacheControlMaxAge: 31_536_000,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  }
  return { hash, path: publicArtifactPath(hash) };
}

export async function readOnlineDetectorArtifact(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  if (!storageConfigured()) return detectorGlobalState.__hedgentsOnlineDetectorArtifacts?.get(hash) ?? null;
  const result = await get(artifactPath(hash), { access: "private", useCache: true });
  if (!result || result.statusCode !== 200) return null;
  return {
    content: await new Response(result.stream).text(),
    contentType: result.blob.contentType || "application/octet-stream",
  };
}

export async function reviewOnlineDetectorEvidence(options: {
  evidenceId: string;
  decision: Exclude<OnlineEvidenceStatus, "quarantined">;
  reviewer: string;
  notes?: string;
  reviewedAt?: string;
}) {
  if (!options.reviewer.trim()) throw new Error("A reviewer identifier is required.");
  const reviewedAt = options.reviewedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error("Review time is invalid.");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await loadOnlineDetectorState();
    const evidence = state.evidence.find((item) => item.id === options.evidenceId);
    if (!evidence) throw new Error("Online detector evidence was not found.");
    evidence.status = options.decision;
    evidence.review = {
      reviewer: options.reviewer.trim(),
      reviewedAt: new Date(reviewedAt).toISOString(),
      notes: options.notes?.trim() || null,
    };
    const outputs = rebuildOnlineOutputs(state.evidence);
    state.signals = outputs.signals;
    state.candidates = outputs.candidates;
    try {
      await saveOnlineDetectorState(state);
      return { reviewed: true, evidence, candidates: state.candidates.filter((candidate) => candidate.evidenceId === evidence.id) };
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
  }
  throw lastError;
}

export function resetOnlineDetectorForTests() {
  if (process.env.NODE_ENV === "production") throw new Error("Cannot reset online detector state in production.");
  detectorGlobalState.__hedgentsOnlineDetectorState = undefined;
  detectorGlobalState.__hedgentsOnlineDetectorArtifacts = undefined;
}
