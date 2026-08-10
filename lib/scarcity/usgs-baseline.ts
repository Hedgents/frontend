import baseline from "./usgs-mcs-2026-baseline.json";
import type {
  ScarcityDataset,
  ScarcityMetricId,
  ScarcityObservation,
  ScarcitySource,
} from "./types";

interface BaselineMetric {
  metricId: ScarcityMetricId;
  value: number;
  unit: string;
  coverageRatio: number;
  derivation: string;
  inputs: Record<string, unknown>;
}

interface BaselineRecord {
  metalId: string;
  chapter: string;
  commodity: string;
  commercialForm: string;
  reportingMode: "direct" | "group";
  notes?: string;
  metrics: BaselineMetric[];
}

export const USGS_MCS_BASELINE_SOURCE_METADATA = Object.freeze(baseline.source);
const sourceMetadata = USGS_MCS_BASELINE_SOURCE_METADATA;

export const USGS_MCS_2026_SOURCE: ScarcitySource = Object.freeze({
  id: sourceMetadata.id,
  name: sourceMetadata.title,
  kind: "official-statistics",
  operator: "U.S. Geological Survey, National Minerals Information Center",
  url: sourceMetadata.doi,
  updateCadenceDays: 365,
  nextExpectedAt: "2027-02-06T00:00:00.000Z",
  redistribution: "permitted",
  settlementUse: "unknown",
  rightsReviewedAt: "2026-08-08T00:00:00.000Z",
  notes: `Bundled public-domain annual baseline. Source CSV MD5 ${sourceMetadata.sourceCsvMd5}; SHA-256 ${sourceMetadata.sourceCsvSha256}. Settlement use remains unapproved until an operator review is recorded.`,
});

const observations: ScarcityObservation[] = (baseline.records as BaselineRecord[]).flatMap((record) =>
  record.metrics.map((metric) => ({
    id: `${sourceMetadata.id}:${record.metalId}:${metric.metricId}:2025`,
    datasetId: "production-v1",
    metalId: record.metalId,
    metricId: metric.metricId,
    value: metric.value,
    unit: metric.unit,
    observedAt: sourceMetadata.observedAt,
    publishedAt: sourceMetadata.publishedAt,
    sourceId: sourceMetadata.id,
    status: "estimated" as const,
    coverageRatio: metric.coverageRatio,
    independentSourceCount: 1,
    retrievedAt: sourceMetadata.publishedAt,
    notes: [
      `${record.commodity} — ${record.commercialForm}.`,
      record.reportingMode === "group" ? "Group-reported observation; not an element-specific production claim." : "Directly reported commodity observation.",
      metric.derivation,
      `Inputs: ${JSON.stringify(metric.inputs)}.`,
      record.notes,
    ].filter(Boolean).join(" "),
  })),
);

const coveredMetalCount = new Set(observations.map((observation) => observation.metalId)).size;

export const BUNDLED_USGS_SCARCITY_DATASET: ScarcityDataset = Object.freeze({
  id: "production-v1",
  label: "USGS 2026 annual physical baseline",
  kind: "production",
  description: `${observations.length} reproducibly derived annual observations across ${coveredMetalCount} element cells. Direct and group-reported commodities are explicitly distinguished; absent values remain absent.`,
  sources: [USGS_MCS_2026_SOURCE],
  observations,
  stateSnapshots: [],
});

export const USGS_BASELINE_COVERAGE = Object.freeze({
  recordCount: baseline.recordCount,
  observationCount: observations.length,
  coveredMetalCount,
  directMetalCount: baseline.records.filter((record) => record.reportingMode === "direct").length,
  groupMetalCount: baseline.records.filter((record) => record.reportingMode === "group").length,
  observedAt: sourceMetadata.observedAt,
  publishedAt: sourceMetadata.publishedAt,
});
