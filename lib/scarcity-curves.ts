import { canonicalJson, sha256Hex, type ScarcityMarketRecord } from "@/lib/scarcity-markets";
import { SCARCITY_METHODOLOGY_VERSION } from "@/lib/scarcity/methodology";

export interface CurveMetricDocument {
  schemaVersion: "1.0.0";
  kind: "scalar-curve";
  slug: string;
  title: string;
  metal: { id: string; symbol: string; name: string };
  metric: {
    id: string;
    label: string;
    methodologyVersion: string;
    unit: string;
    observedAt: string;
    precision: number;
  };
  displayRange: { minimum: number; midpoint: number; maximum: number };
  normalization: {
    minimum: -1_000_000;
    maximum: 1_000_000;
    formula: string;
    outOfRangePolicy: "invalid";
  };
  sources: ScarcityMarketRecord["question"]["sources"];
  invalidConditions: string[];
}

export interface CurveRulesDocument {
  schemaVersion: "1.0.0";
  network: "solana";
  schedule: ScarcityMarketRecord["rules"]["schedule"];
  collateral: ScarcityMarketRecord["rules"]["collateral"];
  engine: {
    bucketCount: 41;
    midpointTieBreak: "higher";
    kernelVersion: 1;
    kernel: "full-support-linear";
    targetJackpotBps: 2_000;
    jackpotLeverageCap: 10;
    invalidPayout: "one-for-one-refund";
  };
  resolution: ScarcityMarketRecord["rules"]["resolution"];
}

export interface CompiledCurveMarket {
  slug: string;
  marketId: string;
  metricHash: string;
  rulesHash: string;
  canonicalMetric: string;
  canonicalRules: string;
  metric: CurveMetricDocument;
  rules: CurveRulesDocument;
}

const SUPPORTED_CURVE_RANGES: Record<string, { minimum: number; midpoint: number; maximum: number }> = {
  "score-0-100": { minimum: 0, midpoint: 50, maximum: 100 },
};

const CURVE_ORACLE_SOURCE = {
  id: "hedgents-scarcity-index",
  publisher: "Hedgents",
  title: "Hedgents market-tightness calculation and source manifest",
  url: "https://hedgents.com/methodology/scarcity",
  cadence: "Published whenever all committed underlying observations pass validation",
  precedence: 1,
};

export function compileCurveMarket(market: ScarcityMarketRecord): CompiledCurveMarket | null {
  const observation = market.question.kind === "event" ? {
    metricId: "market-tightness",
    metricLabel: "Hedgents Market Tightness Score",
    methodologyVersion: SCARCITY_METHODOLOGY_VERSION,
    unit: "score-0-100",
    observedAt: market.question.event.resolvesAt,
    precision: 2,
  } : market.question.observation;
  const displayRange = SUPPORTED_CURVE_RANGES[observation.unit];
  if (!displayRange) return null;

  const slug = `${market.question.slug}-curve-v1`;
  const metric: CurveMetricDocument = {
    schemaVersion: "1.0.0",
    kind: "scalar-curve",
    slug,
    title: `${market.question.metal.name} ${observation.metricLabel} curve`,
    metal: market.question.metal,
    metric: {
      id: observation.metricId,
      label: observation.metricLabel,
      methodologyVersion: observation.methodologyVersion,
      unit: observation.unit,
      observedAt: observation.observedAt,
      precision: observation.precision,
    },
    displayRange,
    normalization: {
      minimum: -1_000_000,
      maximum: 1_000_000,
      formula: "round((((value - minimum) / (maximum - minimum)) * 2 - 1) * 1000000)",
      outOfRangePolicy: "invalid",
    },
    sources: market.question.kind === "event" ? [CURVE_ORACLE_SOURCE] : market.question.sources,
    invalidConditions: [
      ...(market.question.kind === "event" ? [
        "The committed methodology cannot produce a score because its minimum coverage gate is not met by the resolution deadline.",
        "A required underlying source artifact is unavailable or cannot be independently verified.",
        "The calculation or evidence commitment is inconsistent with the published canonical documents.",
      ] : market.question.invalidConditions),
      "The final metric is outside the committed display range.",
      "The canonical source packet cannot reproduce the normalized integer outcome.",
    ],
  };
  const rules: CurveRulesDocument = {
    schemaVersion: "1.0.0",
    network: "solana",
    schedule: market.rules.schedule,
    collateral: market.rules.collateral,
    engine: {
      bucketCount: 41,
      midpointTieBreak: "higher",
      kernelVersion: 1,
      kernel: "full-support-linear",
      targetJackpotBps: 2_000,
      jackpotLeverageCap: 10,
      invalidPayout: "one-for-one-refund",
    },
    resolution: market.question.kind === "event" ? {
      observationDelayHours: market.rules.resolution.observationDelayHours,
      sourceConflictPolicy: "Use the committed Hedgents Metal State Oracle source manifest and methodology. If the evidence coverage gate remains unmet after the observation delay, resolve invalid.",
      reportSchemaVersion: market.rules.resolution.reportSchemaVersion,
    } : market.rules.resolution,
  };
  const canonicalMetric = canonicalJson(metric);
  const canonicalRules = canonicalJson(rules);
  const metricHash = sha256Hex(canonicalMetric);
  const rulesHash = sha256Hex(canonicalRules);
  const marketId = sha256Hex(canonicalJson({ schemaVersion: "1.0.0", slug, metricHash, rulesHash }));
  return { slug, marketId, metricHash, rulesHash, canonicalMetric, canonicalRules, metric, rules };
}
