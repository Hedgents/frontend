import type {
  ConfidenceGrade,
  MetricDefinition,
  ScarcityDimension,
  ScarcityMetricId,
  SourceKind,
} from "./types";

export const SCARCITY_METHODOLOGY_VERSION = "2026-08-08.v1";

export const MINIMUM_DIMENSION_COVERAGE: Record<ScarcityDimension, number> = {
  "market-tightness": 0.5,
  "structural-scarcity": 0.4,
};

export const SOURCE_RELIABILITY: Record<SourceKind, number> = {
  "official-statistics": 0.95,
  "regulated-benchmark": 0.98,
  exchange: 0.94,
  "industry-assessment": 0.84,
  "dealer-quote": 0.74,
  issuer: 0.68,
  derived: 0.58,
  sample: 0.2,
};

export const STATUS_CONFIDENCE = {
  final: 1,
  provisional: 0.85,
  estimated: 0.65,
} as const;

const metrics: MetricDefinition[] = [
  {
    id: "inventory-days",
    dimension: "market-tightness",
    label: "Inventory days of cover",
    description: "Deliverable inventory divided by annualized consumption, expressed as days.",
    unit: "days",
    weight: 0.3,
    maximumAgeDays: 30,
    anchors: [
      { value: 0, score: 100 },
      { value: 30, score: 85 },
      { value: 90, score: 55 },
      { value: 180, score: 25 },
      { value: 365, score: 0 },
    ],
  },
  {
    id: "supply-balance-pct",
    dimension: "market-tightness",
    label: "Supply deficit",
    description: "Demand less available primary and secondary supply, divided by demand. Positive is a deficit.",
    unit: "percent",
    weight: 0.3,
    maximumAgeDays: 90,
    anchors: [
      { value: -20, score: 0 },
      { value: -5, score: 30 },
      { value: 0, score: 50 },
      { value: 5, score: 70 },
      { value: 15, score: 100 },
    ],
  },
  {
    id: "demand-growth-yoy-pct",
    dimension: "market-tightness",
    label: "Demand growth",
    description: "Year-over-year change in measured or estimated physical consumption.",
    unit: "percent",
    weight: 0.15,
    maximumAgeDays: 180,
    anchors: [
      { value: -15, score: 0 },
      { value: 0, score: 40 },
      { value: 5, score: 60 },
      { value: 15, score: 100 },
    ],
  },
  {
    id: "supply-growth-yoy-pct",
    dimension: "market-tightness",
    label: "Supply growth",
    description: "Year-over-year change in available primary and secondary supply. Lower growth is tighter.",
    unit: "percent",
    weight: 0.15,
    maximumAgeDays: 180,
    anchors: [
      { value: -10, score: 100 },
      { value: 0, score: 60 },
      { value: 5, score: 35 },
      { value: 15, score: 0 },
    ],
  },
  {
    id: "regional-premium-pct",
    dimension: "market-tightness",
    label: "Regional physical premium",
    description: "Observed premium for the defined grade and region over its named reference.",
    unit: "percent",
    weight: 0.1,
    maximumAgeDays: 30,
    anchors: [
      { value: -10, score: 0 },
      { value: 0, score: 40 },
      { value: 10, score: 70 },
      { value: 30, score: 100 },
    ],
  },
  {
    id: "reserve-life-years",
    dimension: "structural-scarcity",
    label: "Reserve life",
    description: "Economically identified reserves divided by current annual production. Lower is scarcer.",
    unit: "years",
    weight: 0.2,
    maximumAgeDays: 365,
    anchors: [
      { value: 0, score: 100 },
      { value: 10, score: 90 },
      { value: 25, score: 70 },
      { value: 50, score: 40 },
      { value: 100, score: 15 },
      { value: 200, score: 0 },
    ],
  },
  {
    id: "development-lead-time-years",
    dimension: "structural-scarcity",
    label: "Development lead time",
    description: "Estimated time needed to add meaningful mine and refining capacity.",
    unit: "years",
    weight: 0.2,
    maximumAgeDays: 365,
    anchors: [
      { value: 0, score: 0 },
      { value: 3, score: 30 },
      { value: 7, score: 65 },
      { value: 15, score: 100 },
    ],
  },
  {
    id: "top-three-supply-share-pct",
    dimension: "structural-scarcity",
    label: "Top-three supply concentration",
    description: "Share of refined or mine supply controlled by the three largest producing jurisdictions.",
    unit: "percent",
    weight: 0.2,
    maximumAgeDays: 365,
    anchors: [
      { value: 0, score: 0 },
      { value: 30, score: 25 },
      { value: 60, score: 60 },
      { value: 90, score: 100 },
    ],
  },
  {
    id: "byproduct-dependency-pct",
    dimension: "structural-scarcity",
    label: "By-product dependency",
    description: "Share of production obtained as a by-product of mining or refining another material.",
    unit: "percent",
    weight: 0.15,
    maximumAgeDays: 365,
    anchors: [
      { value: 0, score: 0 },
      { value: 30, score: 30 },
      { value: 70, score: 75 },
      { value: 100, score: 100 },
    ],
  },
  {
    id: "recycling-share-pct",
    dimension: "structural-scarcity",
    label: "Recycling supply share",
    description: "Share of supply available from recycling. Lower recycling availability increases scarcity.",
    unit: "percent",
    weight: 0.15,
    maximumAgeDays: 365,
    anchors: [
      { value: 0, score: 100 },
      { value: 20, score: 75 },
      { value: 50, score: 40 },
      { value: 80, score: 10 },
      { value: 100, score: 0 },
    ],
  },
  {
    id: "substitution-ease-score",
    dimension: "structural-scarcity",
    label: "Substitution ease",
    description: "Transparent 0–100 assessment of how easily end users can replace the metal. Lower is scarcer.",
    unit: "score",
    weight: 0.1,
    maximumAgeDays: 365,
    anchors: [
      { value: 0, score: 100 },
      { value: 25, score: 75 },
      { value: 50, score: 45 },
      { value: 75, score: 20 },
      { value: 100, score: 0 },
    ],
  },
];

export const SCARCITY_METRICS = Object.freeze(metrics);

export const SCARCITY_METRIC_BY_ID = Object.freeze(
  Object.fromEntries(metrics.map((metric) => [metric.id, metric])) as Record<
    ScarcityMetricId,
    MetricDefinition
  >,
);

export function confidenceGrade(score: number): ConfidenceGrade {
  if (score >= 85) return "very-high";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  if (score >= 30) return "low";
  return "insufficient";
}
