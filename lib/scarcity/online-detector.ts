import { createHash } from "node:crypto";
import { METAL_MARKET_NAMESPACE_BY_ID, type CatalystCategory } from "./market-namespaces";
import { METAL_REFERENCE_MARKETS } from "./reference-markets";
import { SCARCITY_METALS } from "./registry";

export type OnlineDetectorSourceKind =
  | "reference-page"
  | "official-feed"
  | "scientific-registry"
  | "structured-release";

export type OnlineEvidenceStatus = "quarantined" | "approved" | "rejected";
export type OnlineDetectorRunStatus = "healthy" | "degraded" | "failed";

export interface OnlineDetectorSource {
  id: string;
  name: string;
  publisher: string;
  url: string;
  kind: OnlineDetectorSourceKind;
  category: CatalystCategory;
  metalIds: string[];
}

export interface OnlineSourceHealth {
  sourceId: string;
  name: string;
  url: string;
  kind: OnlineDetectorSourceKind;
  metalIds: string[];
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastChangedAt: string | null;
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
  status: "pending" | "healthy" | "failing";
  consecutiveFailures: number;
  lastError: string | null;
}

export interface OnlineEvidenceReview {
  reviewer: string;
  reviewedAt: string;
  notes: string | null;
}

export interface OnlineMetalEvidence {
  id: string;
  sourceId: string;
  sourceKind: OnlineDetectorSourceKind;
  publisher: string;
  title: string;
  summary: string;
  url: string;
  category: CatalystCategory;
  metalIds: string[];
  matchedTerms: string[];
  publishedAt: string;
  retrievedAt: string;
  artifactHash: string;
  artifactPath: string;
  authority: "primary" | "official-index" | "registry";
  recordType: string | null;
  direction: "tightening" | "loosening" | "neutral";
  status: OnlineEvidenceStatus;
  review: OnlineEvidenceReview | null;
}

export interface OnlineMetalSignal {
  id: string;
  evidenceId: string;
  metalId: string;
  metalSymbol: string;
  metalName: string;
  category: CatalystCategory;
  label: string;
  description: string;
  direction: "tightening" | "loosening" | "neutral";
  severity: "info" | "watch" | "material";
  detectedAt: string;
  source: {
    publisher: string;
    url: string;
    authority: OnlineMetalEvidence["authority"];
  };
  publication: "quarantined" | "reviewed";
}

export interface OnlineMarketCandidate {
  id: string;
  evidenceId: string;
  metalId: string;
  metalSymbol: string;
  category: CatalystCategory;
  question: string;
  resolverUrl: string;
  observationDeadline: string;
  specificationHash: string;
  readiness: "quarantined" | "review-ready" | "rejected";
  blockers: string[];
}

export interface OnlineDetectorAlert {
  id: string;
  severity: "warning" | "critical";
  sourceId: string | null;
  message: string;
  detectedAt: string;
}

export interface OnlineDetectorRun {
  id: string;
  startedAt: string;
  completedAt: string;
  status: OnlineDetectorRunStatus;
  sourcesAttempted: number;
  sourcesSucceeded: number;
  sourcesChanged: number;
  evidenceDetected: number;
  evidenceDeduplicated: number;
  signalsComputed: number;
  candidatesCompiled: number;
  numericalSignalsComputed: number;
  scientificCursor: number;
  errors: string[];
}

export interface OnlineDetectorState {
  schemaVersion: "1.0.0";
  lastRunAt: string | null;
  lastSuccessfulRunAt: string | null;
  scientificCursor: number;
  sources: OnlineSourceHealth[];
  evidence: OnlineMetalEvidence[];
  signals: OnlineMetalSignal[];
  candidates: OnlineMarketCandidate[];
  alerts: OnlineDetectorAlert[];
  runs: OnlineDetectorRun[];
}

export interface DetectorRecord {
  sourceId: string;
  sourceKind: OnlineDetectorSourceKind;
  publisher: string;
  title: string;
  summary?: string;
  url: string;
  category?: CatalystCategory;
  metalIds?: string[];
  publishedAt: string;
  retrievedAt: string;
  authority: OnlineMetalEvidence["authority"];
  artifactHash: string;
  artifactPath: string;
  recordType?: string;
}

export const EMPTY_ONLINE_DETECTOR_STATE: OnlineDetectorState = Object.freeze({
  schemaVersion: "1.0.0",
  lastRunAt: null,
  lastSuccessfulRunAt: null,
  scientificCursor: 0,
  sources: [],
  evidence: [],
  signals: [],
  candidates: [],
  alerts: [],
  runs: [],
});

function stableHash(value: unknown) {
  const canonical = (candidate: unknown): string => {
    if (candidate === undefined || candidate === null) return "null";
    if (typeof candidate !== "object") return JSON.stringify(candidate) ?? "null";
    if (Array.isArray(candidate)) return `[${candidate.map(canonical).join(",")}]`;
    const record = candidate as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  };
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function categoryForReferences(metalIds: string[]) {
  const categories = metalIds
    .map((metalId) => METAL_MARKET_NAMESPACE_BY_ID[metalId]?.primaryCategory)
    .filter((category): category is CatalystCategory => Boolean(category));
  if (categories.includes("supply-projects")) return "supply-projects" as const;
  if (categories.includes("price-data")) return "price-data" as const;
  return categories[0] ?? "science" as const;
}

export const ONLINE_REFERENCE_SOURCES: readonly OnlineDetectorSource[] = Object.freeze(
  [...new Map(METAL_REFERENCE_MARKETS.map((reference) => [reference.source.id, reference.source])).values()]
    .map((source) => {
      const metalIds = METAL_REFERENCE_MARKETS
        .filter((reference) => reference.source.id === source.id)
        .map((reference) => reference.metalId)
        .sort();
      return {
        id: `reference:${source.id}`,
        name: source.name,
        publisher: source.operator,
        url: source.url,
        kind: "reference-page" as const,
        category: categoryForReferences(metalIds),
        metalIds,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id)),
);

export const ONLINE_DISCOVERY_SOURCES: readonly OnlineDetectorSource[] = Object.freeze([
  {
    id: "official:federal-register-minerals",
    name: "Federal Register minerals search",
    publisher: "Office of the Federal Register / U.S. Government Publishing Office",
    url: "https://www.federalregister.gov/api/v1/documents.json?per_page=100&order=newest&conditions%5Bterm%5D=critical%20minerals",
    kind: "official-feed",
    category: "policy",
    metalIds: SCARCITY_METALS.map((metal) => metal.id),
  },
  {
    id: "registry:crossref-metal-science",
    name: "Crossref metal publication registry",
    publisher: "Crossref",
    url: "https://api.crossref.org/works",
    kind: "scientific-registry",
    category: "science",
    metalIds: SCARCITY_METALS.map((metal) => metal.id),
  },
  {
    id: "official:usgs-sciencebase-mcs",
    name: "USGS ScienceBase Mineral Commodity Summaries release discovery",
    publisher: "U.S. Geological Survey",
    url: "https://www.sciencebase.gov/catalog/items",
    kind: "structured-release",
    category: "price-data",
    metalIds: SCARCITY_METALS.filter((metal) => metal.sourceCommodity).map((metal) => metal.id),
  },
]);

export const ONLINE_DETECTOR_SOURCES = Object.freeze([...ONLINE_REFERENCE_SOURCES, ...ONLINE_DISCOVERY_SOURCES]);

export const ONLINE_DETECTOR_COVERAGE = Object.freeze({
  sourceCount: ONLINE_DETECTOR_SOURCES.length,
  scheduledMetalCount: new Set(ONLINE_DETECTOR_SOURCES.flatMap((source) => source.metalIds)).size,
  referenceSourceCount: ONLINE_REFERENCE_SOURCES.length,
  discoverySourceCount: ONLINE_DISCOVERY_SOURCES.length,
});

const metalAliases: Readonly<Record<string, readonly string[]>> = Object.freeze({
  aluminium: ["aluminium", "aluminum", "bauxite"],
  barium: ["barium", "barite"],
  boron: ["boron", "borate"],
  caesium: ["caesium", "cesium"],
  calcium: ["calcium", "coral bleaching"],
  niobium: ["niobium", "columbium"],
  potassium: ["potassium", "potash"],
  sodium: ["sodium", "soda ash"],
  tungsten: ["tungsten", "wolfram"],
  mercury: ["mercury", "quicksilver"],
});

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchMetalTerms(text: string) {
  const normalized = text.normalize("NFKC").toLowerCase();
  const matches: Array<{ metalId: string; term: string }> = [];
  for (const metal of SCARCITY_METALS) {
    const terms = new Set([
      ...(metalAliases[metal.id] ?? [metal.name.toLowerCase()]),
      metal.name.toLowerCase(),
      ...(metal.sourceCommodity ? [metal.sourceCommodity.commodity.toLowerCase()] : []),
    ]);
    for (const term of terms) {
      if (term.length < 4) continue;
      if (new RegExp(`(^|[^a-z0-9])${escaped(term)}([^a-z0-9]|$)`, "i").test(normalized)) {
        matches.push({ metalId: metal.id, term });
        break;
      }
    }
  }
  return matches;
}

export function inferSignalDirection(text: string): OnlineMetalEvidence["direction"] {
  const value = text.toLowerCase();
  const tightening = /\b(export ban|export control|restriction|sanction|shutdown|outage|suspend|suspension|strike|deficit|shortage|declin(?:e|ing)|deplet(?:e|ion)|delay(?:ed)?|lower production|mine closure)\b/;
  const loosening = /\b(expansion|commission(?:ed|ing)|new mine|new capacity|production increase|higher production|recycling|substitut(?:e|ion)|discovery|permit approval|restart(?:ed)?|supply increase)\b/;
  const tight = tightening.test(value);
  const loose = loosening.test(value);
  if (tight === loose) return "neutral";
  return tight ? "tightening" : "loosening";
}

function shortenedTitle(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 132 ? normalized : `${normalized.slice(0, 129).trimEnd()}…`;
}

function addDays(value: string, days: number) {
  return new Date(Date.parse(value) + days * 86_400_000).toISOString();
}

export function evidenceFromRecord(record: DetectorRecord): OnlineMetalEvidence[] {
  const matched = matchMetalTerms(`${record.title}\n${record.summary ?? ""}`);
  const explicitMetalIds = record.metalIds ?? [];
  const metalIds = [...new Set([...explicitMetalIds, ...matched.map((match) => match.metalId)])]
    .filter((metalId) => Boolean(METAL_MARKET_NAMESPACE_BY_ID[metalId]))
    .sort();
  if (metalIds.length === 0) return [];
  const matchedTerms = [...new Set(matched.map((match) => match.term))].sort();
  const direction = inferSignalDirection(`${record.title}\n${record.summary ?? ""}`);
  const coreId = stableHash({
    schemaVersion: "1.0.0",
    sourceId: record.sourceId,
    url: record.url,
    title: shortenedTitle(record.title),
    publishedAt: record.publishedAt,
    artifactHash: record.artifactHash,
  });
  return [{
    id: coreId,
    sourceId: record.sourceId,
    sourceKind: record.sourceKind,
    publisher: record.publisher,
    title: shortenedTitle(record.title),
    summary: (record.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 1_200),
    url: record.url,
    category: record.category ?? "science",
    metalIds,
    matchedTerms,
    publishedAt: new Date(record.publishedAt).toISOString(),
    retrievedAt: new Date(record.retrievedAt).toISOString(),
    artifactHash: record.artifactHash,
    artifactPath: record.artifactPath,
    authority: record.authority,
    recordType: record.recordType?.trim() || null,
    direction,
    status: "quarantined",
    review: null,
  }];
}

export function signalsFromEvidence(evidence: OnlineMetalEvidence): OnlineMetalSignal[] {
  return evidence.metalIds.flatMap((metalId) => {
    const metal = SCARCITY_METALS.find((candidate) => candidate.id === metalId);
    if (!metal) return [];
    return [{
      id: stableHash({ schemaVersion: "1.0.0", evidenceId: evidence.id, metalId }),
      evidenceId: evidence.id,
      metalId,
      metalSymbol: metal.symbol,
      metalName: metal.name,
      category: evidence.category,
      label: evidence.title,
      description: evidence.summary || `${evidence.publisher} published a new source record associated with ${metal.name}.`,
      direction: evidence.direction,
      severity: evidence.authority === "primary" && evidence.direction !== "neutral" ? "material" as const : evidence.authority === "registry" ? "info" as const : "watch" as const,
      detectedAt: evidence.retrievedAt,
      source: { publisher: evidence.publisher, url: evidence.url, authority: evidence.authority },
      publication: evidence.status === "approved" ? "reviewed" as const : "quarantined" as const,
    }];
  });
}

export function candidateFromEvidence(evidence: OnlineMetalEvidence, recordType?: string): OnlineMarketCandidate[] {
  const proposal = /proposed rule|notice of proposed|request for comment/i.test(`${recordType ?? ""} ${evidence.title} ${evidence.summary}`);
  if (evidence.category !== "policy" || !proposal) return [];
  return evidence.metalIds.flatMap((metalId) => {
    const metal = SCARCITY_METALS.find((candidate) => candidate.id === metalId);
    if (!metal) return [];
    const observationDeadline = addDays(evidence.publishedAt, 365);
    const question = `Will ${evidence.publisher} publish a final action explicitly addressing ${metal.name} under “${shortenedTitle(evidence.title)}” by ${observationDeadline.slice(0, 10)}?`;
    const specificationHash = stableHash({
      schemaVersion: "1.0.0",
      evidenceId: evidence.id,
      metalId,
      question,
      resolverUrl: evidence.url,
      observationDeadline,
    });
    return [{
      id: stableHash({ schemaVersion: "1.0.0", specificationHash }),
      evidenceId: evidence.id,
      metalId,
      metalSymbol: metal.symbol,
      category: evidence.category,
      question,
      resolverUrl: evidence.url,
      observationDeadline,
      specificationHash,
      readiness: evidence.status === "approved" ? "review-ready" as const : evidence.status === "rejected" ? "rejected" as const : "quarantined" as const,
      blockers: evidence.status === "approved" ? ["Operator must freeze source precedence and invalid conditions before opening."] : ["Evidence is quarantined until an operator verifies the named outcome, deadline, and primary resolver."],
    }];
  });
}

export function mergeDetectorEvidence(
  current: OnlineMetalEvidence[],
  incoming: OnlineMetalEvidence[],
) {
  const byId = new Map(current.map((item) => [item.id, item]));
  let deduplicated = 0;
  for (const item of incoming) {
    if (byId.has(item.id)) {
      deduplicated += 1;
      continue;
    }
    byId.set(item.id, item);
  }
  return {
    evidence: [...byId.values()]
      .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) || left.id.localeCompare(right.id))
      .slice(0, 2_000),
    deduplicated,
  };
}

export function rebuildOnlineOutputs(evidence: OnlineMetalEvidence[], candidateRecordTypes: ReadonlyMap<string, string> = new Map()) {
  const signals = evidence.flatMap(signalsFromEvidence)
    .sort((left, right) => Date.parse(right.detectedAt) - Date.parse(left.detectedAt) || left.id.localeCompare(right.id))
    .slice(0, 5_000);
  const candidates = evidence.flatMap((item) => candidateFromEvidence(item, item.recordType ?? candidateRecordTypes.get(item.id)))
    .sort((left, right) => Date.parse(right.observationDeadline) - Date.parse(left.observationDeadline) || left.id.localeCompare(right.id))
    .slice(0, 1_000);
  return { signals, candidates };
}

export function createSourceHealth(source: OnlineDetectorSource): OnlineSourceHealth {
  return {
    sourceId: source.id,
    name: source.name,
    url: source.url,
    kind: source.kind,
    metalIds: [...source.metalIds],
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastChangedAt: null,
    etag: null,
    lastModified: null,
    contentHash: null,
    status: "pending",
    consecutiveFailures: 0,
    lastError: null,
  };
}

export function onlineDetectorSummary(state: OnlineDetectorState) {
  const latestRun = state.runs[0] ?? null;
  const sourcesHealthy = state.sources.filter((source) => source.status === "healthy").length;
  const approvedEvidence = state.evidence.filter((item) => item.status === "approved").length;
  const quarantinedEvidence = state.evidence.filter((item) => item.status === "quarantined").length;
  const reviewedSignals = state.signals.filter((signal) => signal.publication === "reviewed").length;
  return {
    configured: true,
    schedule: "daily",
    scheduledMetalCount: ONLINE_DETECTOR_COVERAGE.scheduledMetalCount,
    sourceCount: state.sources.length || ONLINE_DETECTOR_COVERAGE.sourceCount,
    sourcesHealthy,
    sourcesFailing: state.sources.filter((source) => source.status === "failing").length,
    lastRunAt: state.lastRunAt,
    lastSuccessfulRunAt: state.lastSuccessfulRunAt,
    latestRunStatus: latestRun?.status ?? "pending",
    evidenceCount: state.evidence.length,
    approvedEvidence,
    quarantinedEvidence,
    signalCount: state.signals.length,
    reviewedSignals,
    candidateCount: state.candidates.length,
    reviewReadyCandidates: state.candidates.filter((candidate) => candidate.readiness === "review-ready").length,
    activeAlerts: state.alerts.length,
  };
}
