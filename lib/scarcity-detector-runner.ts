import { createHash } from "node:crypto";
import { publishScarcityObservationBatch } from "@/lib/scarcity-data-store";
import {
  loadOnlineDetectorState,
  saveOnlineDetectorArtifact,
  saveOnlineDetectorState,
} from "@/lib/scarcity-detector-store";
import {
  ONLINE_DETECTOR_SOURCES,
  ONLINE_DISCOVERY_SOURCES,
  ONLINE_REFERENCE_SOURCES,
  createSourceHealth,
  evidenceFromRecord,
  matchMetalTerms,
  mergeDetectorEvidence,
  rebuildOnlineOutputs,
  type DetectorRecord,
  type OnlineDetectorAlert,
  type OnlineDetectorRun,
  type OnlineDetectorSource,
  type OnlineDetectorState,
  type OnlineMetalEvidence,
  type OnlineSourceHealth,
} from "@/lib/scarcity/online-detector";
import { listMetalIntelligence } from "@/lib/scarcity/intelligence";
import { loadScarcityDataset } from "@/lib/scarcity/service";
import { SCARCITY_METALS } from "@/lib/scarcity/registry";
import { USGS_MCS_BASELINE_SOURCE_METADATA } from "@/lib/scarcity/usgs-baseline";
import { parseUsgsMcsCsv } from "@/lib/scarcity/usgs-mcs-parser";
import type { ScarcityObservationBatch } from "@/lib/scarcity/types";

type FetchImplementation = typeof fetch;

interface FetchResult {
  response: Response;
  text: string;
}

interface FederalRegisterDocument {
  title?: string;
  type?: string;
  abstract?: string | null;
  excerpts?: string | null;
  document_number?: string;
  html_url?: string;
  pdf_url?: string | null;
  publication_date?: string;
  agencies?: Array<{ name?: string; raw_name?: string }>;
}

interface CrossrefWork {
  DOI?: string;
  URL?: string;
  title?: string[];
  abstract?: string;
  publisher?: string;
  type?: string;
  subject?: string[];
  created?: { "date-time"?: string };
  published?: { "date-parts"?: number[][] };
}

interface ScienceBaseItemSummary {
  id?: string;
  title?: string;
  summary?: string;
  hasChildren?: boolean;
}

interface ScienceBaseItem {
  id?: string;
  title?: string;
  summary?: string;
  citation?: string;
  provenance?: { lastUpdated?: string };
  dates?: Array<{ type?: string; dateString?: string }>;
  files?: Array<{
    name?: string;
    contentType?: string;
    checksum?: { value?: string; type?: string };
    url?: string;
    downloadUri?: string;
  }>;
}

interface RunOptions {
  now?: Date;
  fetchImpl?: FetchImplementation;
}

const REQUEST_TIMEOUT_MS = 8_000;
const CROSSREF_BATCH_SIZE = 1;
const MAX_REFERENCE_TEXT = 500_000;
const MAX_UPSTREAM_BYTES = 6_000_000;
const MAX_REDIRECTS = 3;
const TRUSTED_UPSTREAM_SUFFIXES = [
  "crossref.org",
  "eia.gov",
  "federalregister.gov",
  "iaea.org",
  "noaa.gov",
  "sciencebase.gov",
  "usgs.gov",
] as const;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function cleanHtml(input: string) {
  const main = input.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i)?.[1] ?? input;
  return main
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_REFERENCE_TEXT);
}

function htmlTitle(input: string, fallback: string) {
  return cleanHtml(input.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? fallback).slice(0, 180) || fallback;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown detector error";
  return message.replace(/https?:\/\/[^\s]+/g, "upstream source").slice(0, 240);
}

export function assertSafeDetectorUpstreamUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const trusted = TRUSTED_UPSTREAM_SUFFIXES.some((suffix) => (
    hostname === suffix || hostname.endsWith(`.${suffix}`)
  ));
  if (url.protocol !== "https:" || url.username || url.password || url.port || !trusted) {
    throw new Error("Detector upstream URL is outside the pinned HTTPS source allowlist.");
  }
  return url;
}

async function readBoundedText(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPSTREAM_BYTES) {
    throw new Error("Upstream source response exceeds the detector size limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_UPSTREAM_BYTES) {
        await reader.cancel();
        throw new Error("Upstream source response exceeds the detector size limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function fetchWithTimeout(
  fetchImpl: FetchImplementation,
  url: string,
  init: RequestInit = {},
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let current = assertSafeDetectorUpstreamUrl(url);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await fetchImpl(current, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "application/json, text/html;q=0.9, text/plain;q=0.8, */*;q=0.5",
          "user-agent": "HedgentsMetalSignalDetector/1.0 (+https://hedgents.com)",
          ...(init.headers ?? {}),
        },
        cache: "no-store",
      });
      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        const location = response.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) throw new Error("Upstream source returned an unsafe redirect chain.");
        current = assertSafeDetectorUpstreamUrl(new URL(location, current).toString());
        continue;
      }
      if (response.url) assertSafeDetectorUpstreamUrl(response.url);
      if (response.status === 304) return { response, text: "" };
      if (!response.ok) throw new Error(`HTTP ${response.status} from upstream source.`);
      return { response, text: await readBoundedText(response) };
    }
    throw new Error("Upstream source redirect limit exceeded.");
  } finally {
    clearTimeout(timer);
  }
}

function sourceHealthMap(state: OnlineDetectorState) {
  const health = new Map(state.sources.map((source) => [source.sourceId, source]));
  for (const source of ONLINE_DETECTOR_SOURCES) {
    if (!health.has(source.id)) health.set(source.id, createSourceHealth(source));
  }
  return health;
}

function sourceSuccess(options: {
  source: OnlineDetectorSource;
  current: OnlineSourceHealth;
  checkedAt: string;
  contentHash: string | null;
  etag?: string | null;
  lastModified?: string | null;
  changed: boolean;
}) {
  return {
    ...options.current,
    name: options.source.name,
    url: options.source.url,
    kind: options.source.kind,
    metalIds: [...options.source.metalIds],
    lastCheckedAt: options.checkedAt,
    lastSuccessAt: options.checkedAt,
    lastChangedAt: options.changed ? options.checkedAt : options.current.lastChangedAt,
    contentHash: options.contentHash ?? options.current.contentHash,
    etag: options.etag ?? options.current.etag,
    lastModified: options.lastModified ?? options.current.lastModified,
    status: "healthy" as const,
    consecutiveFailures: 0,
    lastError: null,
  };
}

function sourceFailure(source: OnlineDetectorSource, current: OnlineSourceHealth, checkedAt: string, error: unknown) {
  return {
    ...current,
    name: source.name,
    url: source.url,
    kind: source.kind,
    metalIds: [...source.metalIds],
    lastCheckedAt: checkedAt,
    status: "failing" as const,
    consecutiveFailures: current.consecutiveFailures + 1,
    lastError: safeError(error),
  };
}

async function scanReferenceSource(options: {
  source: OnlineDetectorSource;
  current: OnlineSourceHealth;
  now: string;
  fetchImpl: FetchImplementation;
}) {
  const headers: Record<string, string> = {};
  if (options.current.etag) headers["if-none-match"] = options.current.etag;
  if (options.current.lastModified) headers["if-modified-since"] = options.current.lastModified;
  const { response, text } = await fetchWithTimeout(options.fetchImpl, options.source.url, { headers });
  if (response.status === 304) {
    return {
      health: sourceSuccess({ source: options.source, current: options.current, checkedAt: options.now, contentHash: null, changed: false }),
      evidence: [] as OnlineMetalEvidence[],
      changed: false,
    };
  }
  const normalized = cleanHtml(text);
  if (normalized.length < 80) throw new Error("Upstream source returned too little stable text to fingerprint.");
  const contentHash = hash(normalized);
  const isBaseline = options.current.contentHash === null;
  const changed = !isBaseline && options.current.contentHash !== contentHash;
  const evidence: OnlineMetalEvidence[] = [];
  if (changed) {
    const artifact = await saveOnlineDetectorArtifact(normalized, "text/plain");
    evidence.push(...evidenceFromRecord({
      sourceId: options.source.id,
      sourceKind: options.source.kind,
      publisher: options.source.publisher,
      title: `Official source update: ${htmlTitle(text, options.source.name)}`,
      summary: normalized.slice(0, 1_200),
      url: options.source.url,
      category: options.source.category,
      metalIds: options.source.metalIds,
      publishedAt: options.now,
      retrievedAt: options.now,
      authority: "primary",
      artifactHash: artifact.hash,
      artifactPath: artifact.path,
    }));
  }
  return {
    health: sourceSuccess({
      source: options.source,
      current: options.current,
      checkedAt: options.now,
      contentHash,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      changed,
    }),
    evidence,
    changed,
  };
}

async function scanFederalRegister(options: {
  source: OnlineDetectorSource;
  current: OnlineSourceHealth;
  now: string;
  fetchImpl: FetchImplementation;
}) {
  const { response, text } = await fetchWithTimeout(options.fetchImpl, options.source.url);
  const payload = JSON.parse(text) as { results?: FederalRegisterDocument[] };
  const records = payload.results ?? [];
  const contentHash = hash(canonical(records.map((record) => [record.document_number, record.publication_date])));
  const evidence: OnlineMetalEvidence[] = [];
  const recordTypes = new Map<string, string>();
  for (const record of records) {
    const title = record.title?.trim();
    const url = record.pdf_url || record.html_url;
    const publicationDate = record.publication_date;
    if (!title || !url || !publicationDate) continue;
    const abstract = cleanHtml(record.abstract ?? "");
    if (matchMetalTerms(`${title}\n${abstract}`).length === 0) continue;
    const summary = cleanHtml(`${record.abstract ?? ""} ${record.excerpts ?? ""}`).slice(0, 1_200);
    const artifactContent = canonical(record);
    const artifact = await saveOnlineDetectorArtifact(artifactContent, "application/json");
    const detected = evidenceFromRecord({
      sourceId: `${options.source.id}:${record.document_number ?? hash(url).slice(0, 12)}`,
      sourceKind: options.source.kind,
      publisher: record.agencies?.map((agency) => agency.name || agency.raw_name).filter(Boolean).join(" / ") || options.source.publisher,
      title,
      summary,
      url,
      category: "policy",
      publishedAt: `${publicationDate}T00:00:00.000Z`,
      retrievedAt: options.now,
      authority: "official-index",
      artifactHash: artifact.hash,
      artifactPath: artifact.path,
      recordType: record.type,
    });
    for (const item of detected) recordTypes.set(item.id, record.type ?? "");
    evidence.push(...detected);
  }
  const changed = options.current.contentHash !== null && options.current.contentHash !== contentHash;
  return {
    health: sourceSuccess({
      source: options.source,
      current: options.current,
      checkedAt: options.now,
      contentHash,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      changed,
    }),
    evidence,
    recordTypes,
    changed,
  };
}

function crossrefPublishedAt(work: CrossrefWork, fallback: string) {
  const created = work.created?.["date-time"];
  if (created && Number.isFinite(Date.parse(created))) return new Date(created).toISOString();
  const dateParts = work.published?.["date-parts"]?.[0];
  if (!dateParts?.[0]) return fallback;
  return new Date(Date.UTC(dateParts[0], Math.max(0, (dateParts[1] ?? 1) - 1), dateParts[2] ?? 1)).toISOString();
}

function scientificContext(title: string, metalId: string) {
  if (!new Set(["lead", "iron", "tin", "gold", "silver", "mercury"]).has(metalId)) return true;
  return /\b(metal|mineral|alloy|ore|oxide|isotope|nuclide|atom|ion|nanoparticle|compound|element|catalyst|electrode)\b/i.test(title);
}

async function scanCrossref(options: {
  source: OnlineDetectorSource;
  current: OnlineSourceHealth;
  now: string;
  cursor: number;
  fetchImpl: FetchImplementation;
}) {
  const start = options.cursor % SCARCITY_METALS.length;
  const metals = Array.from({ length: Math.min(CROSSREF_BATCH_SIZE, SCARCITY_METALS.length) }, (_, offset) =>
    SCARCITY_METALS[(start + offset) % SCARCITY_METALS.length],
  );
  // One polite request per day rotates through all 99 cells. The 120-day
  // window overlaps the cycle; returned records are intentionally bounded.
  const fromDate = new Date(Date.parse(options.now) - 120 * 86_400_000).toISOString().slice(0, 10);
  const untilDate = options.now.slice(0, 10);
  const responses: PromiseSettledResult<{ metal: typeof SCARCITY_METALS[number]; works: CrossrefWork[] }>[] = [];
  for (const metal of metals) {
    try {
      const query = new URLSearchParams({
        "query.title": metal.name,
        filter: `from-created-date:${fromDate},until-created-date:${untilDate}`,
        select: "DOI,title,abstract,published,created,URL,publisher,type,subject",
        sort: "created",
        order: "desc",
        rows: "10",
      });
      const mailto = process.env.HEDGENTS_CROSSREF_MAILTO?.trim();
      if (mailto) query.set("mailto", mailto);
      const { text } = await fetchWithTimeout(options.fetchImpl, `${options.source.url}?${query.toString()}`);
      const payload = JSON.parse(text) as { message?: { items?: CrossrefWork[] } };
      responses.push({ status: "fulfilled", value: { metal, works: payload.message?.items ?? [] } });
    } catch (reason) {
      responses.push({ status: "rejected", reason });
    }
  }
  const evidence: OnlineMetalEvidence[] = [];
  const recordHashes: string[] = [];
  const errors: string[] = [];
  for (const response of responses) {
    if (response.status === "rejected") {
      errors.push(safeError(response.reason));
      continue;
    }
    for (const work of response.value.works.slice(0, 3)) {
      const title = work.title?.[0]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const doi = work.DOI?.toLowerCase();
      if (!title || !doi || !scientificContext(title, response.value.metal.id)) continue;
      const exactMatches = matchMetalTerms(title);
      if (!exactMatches.some((match) => match.metalId === response.value.metal.id)) continue;
      const artifactContent = canonical(work);
      const artifact = await saveOnlineDetectorArtifact(artifactContent, "application/json");
      recordHashes.push(artifact.hash);
      evidence.push(...evidenceFromRecord({
        sourceId: `${options.source.id}:${doi}`,
        sourceKind: options.source.kind,
        publisher: work.publisher?.trim() || options.source.publisher,
        title,
        summary: cleanHtml(work.abstract ?? "").slice(0, 1_200),
        url: work.URL || `https://doi.org/${doi}`,
        category: "science",
        metalIds: [response.value.metal.id],
        publishedAt: crossrefPublishedAt(work, options.now),
        retrievedAt: options.now,
        authority: "registry",
        artifactHash: artifact.hash,
        artifactPath: artifact.path,
        recordType: work.type,
      }));
    }
  }
  if (responses.length > 0 && errors.length === responses.length) throw new Error("Every Crossref query in the rotating batch failed.");
  const contentHash = hash(canonical({ metalIds: metals.map((metal) => metal.id), recordHashes: recordHashes.sort() }));
  const changed = options.current.contentHash !== null && options.current.contentHash !== contentHash;
  return {
    health: sourceSuccess({ source: options.source, current: options.current, checkedAt: options.now, contentHash, changed }),
    evidence,
    changed,
    cursor: (start + metals.length) % SCARCITY_METALS.length,
    errors,
  };
}

async function discoverScienceBaseRelease(fetchImpl: FetchImplementation, now: string) {
  const currentYear = new Date(now).getUTCFullYear();
  const years = [currentYear + 1, currentYear, currentYear - 1];
  for (const year of years) {
    const query = new URLSearchParams({ q: `Mineral Commodity Summaries ${year} Data Release`, format: "json", max: "10" });
    const { text } = await fetchWithTimeout(fetchImpl, `https://www.sciencebase.gov/catalog/items?${query.toString()}`);
    const results = (JSON.parse(text) as { items?: ScienceBaseItemSummary[] }).items ?? [];
    const item = results.find((candidate) =>
      candidate.title?.includes(`Mineral Commodity Summaries ${year} Data Release - Commodity Salient U.S. and World Statistics`)
      && !candidate.hasChildren,
    );
    if (!item?.id) continue;
    const detail = await fetchWithTimeout(fetchImpl, `https://www.sciencebase.gov/catalog/item/${encodeURIComponent(item.id)}?format=json`);
    return { year, item: JSON.parse(detail.text) as ScienceBaseItem };
  }
  throw new Error("No current USGS MCS commodity data release was found in ScienceBase.");
}

function scienceBasePublication(item: ScienceBaseItem, fallback: string) {
  const updated = item.provenance?.lastUpdated;
  if (updated && Number.isFinite(Date.parse(updated))) return new Date(updated).toISOString();
  const publication = item.dates?.find((date) => date.type === "Publication")?.dateString;
  return publication && Number.isFinite(Date.parse(publication)) ? new Date(publication).toISOString() : fallback;
}

function buildUsgsBatch(options: {
  csv: string;
  releaseYear: number;
  checksum: string;
  item: ScienceBaseItem;
  csvUrl: string;
  retrievedAt: string;
}): ScarcityObservationBatch {
  const records = parseUsgsMcsCsv(options.csv, options.releaseYear);
  const observedMetalCount = records.filter((record) => record.metrics.length > 0).length;
  const metricCount = records.reduce((sum, record) => sum + record.metrics.length, 0);
  if (observedMetalCount < 45 || metricCount < 90) {
    throw new Error(`USGS MCS parser coverage gate failed (${observedMetalCount} metals / ${metricCount} metrics).`);
  }
  const observedYear = options.releaseYear - 1;
  const observedAt = `${observedYear}-12-31T23:59:59.000Z`;
  const publishedAt = scienceBasePublication(options.item, options.retrievedAt);
  const sourceId = `usgs-mcs-${options.releaseYear}-${options.checksum.slice(0, 12).toLowerCase()}`;
  return {
    schemaVersion: "1.0.0",
    batchId: `usgs:mcs:${options.releaseYear}:${options.checksum.slice(0, 12).toLowerCase()}`,
    datasetId: "production-v1",
    source: {
      id: sourceId,
      name: options.item.title ?? `USGS Mineral Commodity Summaries ${options.releaseYear}`,
      kind: "official-statistics",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: `https://www.sciencebase.gov/catalog/item/${options.item.id}`,
      updateCadenceDays: 365,
      nextExpectedAt: `${options.releaseYear + 1}-02-15T00:00:00.000Z`,
      redistribution: "permitted",
      settlementUse: "unknown",
      rightsReviewedAt: publishedAt,
      notes: `Automatically imported from the official ScienceBase CSV after deterministic schema and coverage gates. Source checksum ${options.checksum}.`,
    },
    observations: records.flatMap((record) => record.metrics.map((metric) => ({
      id: `${sourceId}:${record.metalId}:${metric.metricId}:${observedYear}`,
      datasetId: "production-v1" as const,
      metalId: record.metalId,
      metricId: metric.metricId,
      value: metric.value,
      unit: metric.unit,
      observedAt,
      publishedAt,
      sourceId,
      status: "estimated" as const,
      coverageRatio: metric.coverageRatio,
      independentSourceCount: 1,
      notes: [
        `${record.commodity} — ${record.commercialForm}.`,
        record.reportingMode === "group" ? "Group-reported observation; not an element-specific production claim." : "Directly reported commodity observation.",
        metric.derivation,
        `Inputs: ${JSON.stringify(metric.inputs)}.`,
        record.notes,
      ].filter(Boolean).join(" "),
    }))),
    artifact: {
      contentType: "text/csv",
      content: options.csv,
      retrievedAt: options.retrievedAt,
      sourceUrl: options.csvUrl,
    },
    review: {
      reviewer: "detector:usgs-mcs-schema-v1",
      reviewedAt: options.retrievedAt,
      notes: `Automatic publication passed pinned field mapping, exact-number parsing, >=45-metal coverage, and >=90-metric coverage gates. Settlement-use rights remain separately gated.`,
    },
  };
}

async function scanScienceBase(options: {
  source: OnlineDetectorSource;
  current: OnlineSourceHealth;
  now: string;
  fetchImpl: FetchImplementation;
}) {
  const release = await discoverScienceBaseRelease(options.fetchImpl, options.now);
  const csvFile = release.item.files?.find((file) => file.name?.toLowerCase().endsWith("_commodities_data.csv"));
  const checksum = csvFile?.checksum?.value?.toLowerCase();
  const csvUrl = csvFile?.downloadUri || csvFile?.url;
  if (!checksum || !csvUrl) throw new Error("The ScienceBase MCS release has no checksummed commodity CSV.");
  assertSafeDetectorUpstreamUrl(csvUrl);
  const bundledChecksum = USGS_MCS_BASELINE_SOURCE_METADATA.sourceCsvMd5.toLowerCase();
  const isBundledBaseline = release.year === 2026 && checksum === bundledChecksum;
  const priorHash = options.current.contentHash;
  const changed = priorHash !== null && priorHash !== checksum;
  const newStructuredRelease = changed || (priorHash === null && !isBundledBaseline);
  const evidence: OnlineMetalEvidence[] = [];
  let publication: Awaited<ReturnType<typeof publishScarcityObservationBatch>> | null = null;
  if (newStructuredRelease) {
    const csvResponse = await fetchWithTimeout(options.fetchImpl, csvUrl, { headers: { accept: "text/csv" } });
    const batch = buildUsgsBatch({
      csv: csvResponse.text,
      releaseYear: release.year,
      checksum,
      item: release.item,
      csvUrl,
      retrievedAt: options.now,
    });
    publication = await publishScarcityObservationBatch(batch);
    const artifact = await saveOnlineDetectorArtifact(canonical(release.item), "application/json");
    evidence.push(...evidenceFromRecord({
      sourceId: `${options.source.id}:${release.year}:${checksum.slice(0, 12)}`,
      sourceKind: options.source.kind,
      publisher: options.source.publisher,
      title: release.item.title ?? `USGS Mineral Commodity Summaries ${release.year} data release`,
      summary: release.item.summary ?? "A new official annual mineral commodity dataset was published.",
      url: `https://www.sciencebase.gov/catalog/item/${release.item.id}`,
      category: "price-data",
      metalIds: options.source.metalIds,
      publishedAt: scienceBasePublication(release.item, options.now),
      retrievedAt: options.now,
      authority: "primary",
      artifactHash: artifact.hash,
      artifactPath: artifact.path,
    }));
  }
  return {
    health: sourceSuccess({ source: options.source, current: options.current, checkedAt: options.now, contentHash: checksum, changed: newStructuredRelease }),
    evidence,
    changed: newStructuredRelease,
    publication,
  };
}

function detectorAlerts(sources: OnlineSourceHealth[], now: string): OnlineDetectorAlert[] {
  return sources.flatMap((source) => {
    if (source.consecutiveFailures < 3) return [];
    const severity = source.consecutiveFailures >= 7 ? "critical" as const : "warning" as const;
    return [{
      id: hash(canonical({ sourceId: source.sourceId, severity, failures: source.consecutiveFailures })),
      severity,
      sourceId: source.sourceId,
      message: `${source.name} has failed ${source.consecutiveFailures} scheduled checks. ${source.lastError ?? "Inspect the upstream source."}`,
      detectedAt: now,
    }];
  });
}

export async function runOnlineMetalDetector(options: RunOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const startedAt = (options.now ?? new Date()).toISOString();
  const state = await loadOnlineDetectorState();
  const health = sourceHealthMap(state);
  const incomingEvidence: OnlineMetalEvidence[] = [];
  const recordTypes = new Map<string, string>();
  const errors: string[] = [];
  let sourcesSucceeded = 0;
  let sourcesChanged = 0;
  let scientificCursor = state.scientificCursor;

  const referenceResults = await Promise.allSettled(ONLINE_REFERENCE_SOURCES.map((source) =>
    scanReferenceSource({ source, current: health.get(source.id)!, now: startedAt, fetchImpl }),
  ));
  referenceResults.forEach((result, index) => {
    const source = ONLINE_REFERENCE_SOURCES[index];
    if (result.status === "fulfilled") {
      health.set(source.id, result.value.health);
      incomingEvidence.push(...result.value.evidence);
      sourcesSucceeded += 1;
      if (result.value.changed) sourcesChanged += 1;
    } else {
      health.set(source.id, sourceFailure(source, health.get(source.id)!, startedAt, result.reason));
      errors.push(`${source.id}: ${safeError(result.reason)}`);
    }
  });

  for (const source of ONLINE_DISCOVERY_SOURCES) {
    try {
      if (source.id === "official:federal-register-minerals") {
        const result = await scanFederalRegister({ source, current: health.get(source.id)!, now: startedAt, fetchImpl });
        health.set(source.id, result.health);
        incomingEvidence.push(...result.evidence);
        for (const [evidenceId, type] of result.recordTypes) recordTypes.set(evidenceId, type);
        if (result.changed) sourcesChanged += 1;
      } else if (source.id === "registry:crossref-metal-science") {
        const result = await scanCrossref({ source, current: health.get(source.id)!, now: startedAt, cursor: scientificCursor, fetchImpl });
        health.set(source.id, result.health);
        incomingEvidence.push(...result.evidence);
        scientificCursor = result.cursor;
        errors.push(...result.errors.map((error) => `${source.id}: ${error}`));
        if (result.changed) sourcesChanged += 1;
      } else if (source.id === "official:usgs-sciencebase-mcs") {
        const result = await scanScienceBase({ source, current: health.get(source.id)!, now: startedAt, fetchImpl });
        health.set(source.id, result.health);
        incomingEvidence.push(...result.evidence);
        if (result.changed) sourcesChanged += 1;
      }
      sourcesSucceeded += 1;
    } catch (error) {
      health.set(source.id, sourceFailure(source, health.get(source.id)!, startedAt, error));
      errors.push(`${source.id}: ${safeError(error)}`);
    }
  }

  const merged = mergeDetectorEvidence(state.evidence, incomingEvidence);
  const outputs = rebuildOnlineOutputs(merged.evidence, recordTypes);
  const dataset = await loadScarcityDataset();
  const numericalSignalsComputed = listMetalIntelligence({ dataset, asOf: startedAt })
    .reduce((count, intelligence) => count + intelligence.signals.length, 0);
  const completedAt = new Date().toISOString();
  const sourcesAttempted = ONLINE_DETECTOR_SOURCES.length;
  const successRatio = sourcesAttempted === 0 ? 0 : sourcesSucceeded / sourcesAttempted;
  const status = successRatio >= 0.8 && errors.length === 0
    ? "healthy" as const
    : successRatio >= 0.4 ? "degraded" as const : "failed" as const;
  const run: OnlineDetectorRun = {
    id: hash(canonical({ schemaVersion: "1.0.0", startedAt, completedAt })),
    startedAt,
    completedAt,
    status,
    sourcesAttempted,
    sourcesSucceeded,
    sourcesChanged,
    evidenceDetected: incomingEvidence.length,
    evidenceDeduplicated: merged.deduplicated,
    signalsComputed: outputs.signals.length,
    candidatesCompiled: outputs.candidates.length,
    numericalSignalsComputed,
    scientificCursor,
    errors: errors.slice(0, 100),
  };
  const next: OnlineDetectorState = {
    schemaVersion: "1.0.0",
    lastRunAt: completedAt,
    lastSuccessfulRunAt: status === "failed" ? state.lastSuccessfulRunAt : completedAt,
    scientificCursor,
    sources: [...health.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    evidence: merged.evidence,
    signals: outputs.signals,
    candidates: outputs.candidates,
    alerts: detectorAlerts([...health.values()], completedAt),
    runs: [run, ...state.runs].slice(0, 90),
  };
  await saveOnlineDetectorState(next);
  if (status === "failed") console.error("Online metal detector run failed", { runId: run.id, sourcesSucceeded, sourcesAttempted });
  else if (status === "degraded") console.warn("Online metal detector run degraded", { runId: run.id, sourcesSucceeded, sourcesAttempted });
  return { run, state: next };
}
