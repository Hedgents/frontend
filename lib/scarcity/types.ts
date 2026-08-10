export type MetalFamily =
  | "precious"
  | "base"
  | "battery"
  | "nuclear"
  | "strategic";

export type ScarcityDimension = "market-tightness" | "structural-scarcity";

export type ScarcityMetricId =
  | "inventory-days"
  | "supply-balance-pct"
  | "demand-growth-yoy-pct"
  | "supply-growth-yoy-pct"
  | "regional-premium-pct"
  | "reserve-life-years"
  | "development-lead-time-years"
  | "top-three-supply-share-pct"
  | "byproduct-dependency-pct"
  | "recycling-share-pct"
  | "substitution-ease-score";

export type ObservationStatus = "final" | "provisional" | "estimated";

export type SourceKind =
  | "official-statistics"
  | "regulated-benchmark"
  | "exchange"
  | "industry-assessment"
  | "dealer-quote"
  | "issuer"
  | "derived"
  | "sample";

export type DataStatus = "fresh" | "aging" | "stale" | "unavailable";

export type CoverageStatus = "verified" | "partial" | "uncovered";

export type CommodityMarketStatus = "commercial" | "specialized" | "non-commercial";

export type CommodityDataMode = "direct" | "group" | "none";

export type MomentumDirection = "tightening" | "loosening" | "stable" | "unknown";

export type ConfidenceGrade =
  | "very-high"
  | "high"
  | "medium"
  | "low"
  | "insufficient";

export interface MetalDefinition {
  id: string;
  symbol: string;
  name: string;
  atomicNumber: number;
  families: MetalFamily[];
  commercialUnit: string;
  description: string;
  marketStatus: CommodityMarketStatus;
  dataMode: CommodityDataMode;
  sourceCommodity: null | {
    sourceId: string;
    chapter: string;
    commodity: string;
    commercialForm: string;
  };
}

export interface ScoreAnchor {
  value: number;
  score: number;
}

export interface MetricDefinition {
  id: ScarcityMetricId;
  dimension: ScarcityDimension;
  label: string;
  description: string;
  unit: string;
  weight: number;
  maximumAgeDays: number;
  anchors: ScoreAnchor[];
}

export interface ScarcitySource {
  id: string;
  name: string;
  kind: SourceKind;
  operator?: string;
  url?: string;
  updateCadenceDays?: number;
  nextExpectedAt?: string;
  redistribution?: "unknown" | "permitted" | "restricted";
  settlementUse?: "unknown" | "permitted" | "prohibited";
  rightsReviewedAt?: string;
  notes?: string;
}

export interface ScarcityObservation {
  id: string;
  datasetId: string;
  metalId: string;
  metricId: ScarcityMetricId;
  value: number;
  unit: string;
  observedAt: string;
  publishedAt: string;
  sourceId: string;
  status: ObservationStatus;
  coverageRatio: number;
  independentSourceCount: number;
  retrievedAt?: string;
  artifactHash?: string;
  artifactPath?: string;
  artifactContentType?: string;
  revisionOf?: string;
  notes?: string;
}

export interface ScarcityObservationBatch {
  schemaVersion: "1.0.0";
  batchId: string;
  datasetId: "production-v1";
  source: ScarcitySource;
  observations: ScarcityObservation[];
  artifact: {
    contentType: string;
    content: string;
    retrievedAt: string;
    sourceUrl: string;
  };
  review: {
    reviewer: string;
    reviewedAt: string;
    notes?: string;
  };
}

export interface ScarcityDataset {
  id: string;
  label: string;
  kind: "production" | "sample" | "empty";
  description: string;
  observations: ScarcityObservation[];
  sources: ScarcitySource[];
  stateSnapshots?: MaterializedMetalState[];
}

export interface MaterializedMetalState {
  id: string;
  metalId: string;
  datasetId: string;
  asOf: string;
  createdAt: string;
  methodologyVersion: string;
  calculationId: string;
  evidenceRoot: string;
  marketTightness: number | null;
  structuralScarcity: number | null;
  confidence: number;
  coverageStatus: CoverageStatus;
  momentum: {
    direction: MomentumDirection;
    change: number | null;
    windowStart: string | null;
  };
  observationIds: string[];
}

export interface MetricResult {
  metricId: ScarcityMetricId;
  label: string;
  unit: string;
  methodologyWeight: number;
  value: number | null;
  normalizedScore: number | null;
  confidenceScore: number;
  dataStatus: DataStatus;
  observedAt: string | null;
  publishedAt: string | null;
  ageDays: number | null;
  observationIds: string[];
  sources: ScarcitySource[];
}

export interface DimensionResult {
  dimension: ScarcityDimension;
  score: number | null;
  confidenceScore: number;
  confidenceGrade: ConfidenceGrade;
  coverageRatio: number;
  freshnessScore: number;
  dataStatus: DataStatus;
  metrics: MetricResult[];
}

export interface ScarcitySnapshot {
  metal: MetalDefinition;
  dataset: Pick<ScarcityDataset, "id" | "label" | "kind" | "description">;
  methodologyVersion: string;
  generatedAt: string;
  asOf: string;
  calculationId: string;
  marketTightness: DimensionResult;
  structuralScarcity: DimensionResult;
  dataConfidence: {
    score: number;
    grade: ConfidenceGrade;
    status: DataStatus;
    coverageRatio: number;
    sourceCount: number;
    latestObservationAt: string | null;
  };
}

export interface ObservationRepository {
  list(options?: {
    datasetId?: string;
    metalId?: string;
    metricId?: ScarcityMetricId;
    asOf?: string;
  }): ScarcityObservation[];
  upsert(observations: ScarcityObservation[]): void;
}
