import { createHash } from "node:crypto";
import {
  MINIMUM_DIMENSION_COVERAGE,
  SCARCITY_METHODOLOGY_VERSION,
  SCARCITY_METRICS,
  SOURCE_RELIABILITY,
  STATUS_CONFIDENCE,
  confidenceGrade,
} from "./methodology";
import type {
  DataStatus,
  DimensionResult,
  MetalDefinition,
  MetricDefinition,
  MetricResult,
  ScarcityDataset,
  ScarcityDimension,
  ScarcityObservation,
  ScarcitySnapshot,
  ScarcitySource,
} from "./types";
import { validateScarcityObservation, validateScarcitySource } from "./validation";

const MILLISECONDS_PER_DAY = 86_400_000;

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeMetricValue(metric: MetricDefinition, value: number) {
  const anchors = [...metric.anchors].sort((left, right) => left.value - right.value);
  if (value <= anchors[0].value) return clamp(anchors[0].score);
  if (value >= anchors[anchors.length - 1].value) return clamp(anchors[anchors.length - 1].score);

  for (let index = 1; index < anchors.length; index += 1) {
    const right = anchors[index];
    const left = anchors[index - 1];
    if (value <= right.value) {
      const position = (value - left.value) / (right.value - left.value);
      return clamp(left.score + position * (right.score - left.score));
    }
  }

  return clamp(anchors[anchors.length - 1].score);
}

export function observationFreshness(
  observation: ScarcityObservation,
  metric: MetricDefinition,
  asOf: string,
) {
  const ageDays = Math.max(
    0,
    (Date.parse(asOf) - Date.parse(observation.observedAt)) / MILLISECONDS_PER_DAY,
  );
  const multiple = ageDays / metric.maximumAgeDays;
  if (multiple <= 1) return { ageDays, score: 1 };
  if (multiple <= 2) return { ageDays, score: 1 - (multiple - 1) * 0.65 };
  if (multiple <= 3) return { ageDays, score: 0.35 * (3 - multiple) };
  return { ageDays, score: 0 };
}

function dataStatus(freshness: number, available: boolean): DataStatus {
  if (!available) return "unavailable";
  if (freshness >= 0.7) return "fresh";
  if (freshness >= 0.35) return "aging";
  return "stale";
}

function latestPerSource(observations: ScarcityObservation[]) {
  const latest = new Map<string, ScarcityObservation>();
  for (const observation of observations) {
    const current = latest.get(observation.sourceId);
    if (!current || Date.parse(observation.publishedAt) > Date.parse(current.publishedAt)) {
      latest.set(observation.sourceId, observation);
    }
  }
  return [...latest.values()];
}

function calculateMetric(
  metric: MetricDefinition,
  observations: ScarcityObservation[],
  sourceById: Map<string, ScarcitySource>,
  asOf: string,
): MetricResult {
  const candidates = latestPerSource(
    observations.filter(
      (observation) =>
        observation.metricId === metric.id && Date.parse(observation.publishedAt) <= Date.parse(asOf),
    ),
  ).map((observation) => {
    const source = sourceById.get(observation.sourceId);
    const freshness = observationFreshness(observation, metric, asOf);
    const independentSourceFactor = clamp(
      0.75 + (observation.independentSourceCount - 1) * 0.125,
      0,
      1,
    );
    const confidence = source
      ? SOURCE_RELIABILITY[source.kind]
        * observation.coverageRatio
        * freshness.score
        * STATUS_CONFIDENCE[observation.status]
        * independentSourceFactor
      : 0;
    return { observation, source, freshness, confidence };
  });

  const usable = candidates.filter((candidate) => candidate.confidence > 0);
  const totalConfidence = usable.reduce((sum, candidate) => sum + candidate.confidence, 0);
  if (totalConfidence === 0) {
    return {
      metricId: metric.id,
      label: metric.label,
      unit: metric.unit,
      methodologyWeight: metric.weight,
      value: null,
      normalizedScore: null,
      confidenceScore: 0,
      dataStatus: "unavailable",
      observedAt: null,
      publishedAt: null,
      ageDays: null,
      observationIds: [],
      sources: [],
    };
  }

  const value = usable.reduce(
    (sum, candidate) => sum + candidate.observation.value * candidate.confidence,
    0,
  ) / totalConfidence;
  const weightedFreshness = usable.reduce(
    (sum, candidate) => sum + candidate.freshness.score * candidate.confidence,
    0,
  ) / totalConfidence;
  const weightedAge = usable.reduce(
    (sum, candidate) => sum + candidate.freshness.ageDays * candidate.confidence,
    0,
  ) / totalConfidence;
  const averageConfidence = totalConfidence / usable.length;
  const latestObservedAt = usable
    .map((candidate) => candidate.observation.observedAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const latestPublishedAt = usable
    .map((candidate) => candidate.observation.publishedAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];

  return {
    metricId: metric.id,
    label: metric.label,
    unit: metric.unit,
    methodologyWeight: metric.weight,
    value,
    normalizedScore: normalizeMetricValue(metric, value),
    confidenceScore: clamp(averageConfidence * 100),
    dataStatus: dataStatus(weightedFreshness, true),
    observedAt: latestObservedAt,
    publishedAt: latestPublishedAt,
    ageDays: weightedAge,
    observationIds: usable.map((candidate) => candidate.observation.id).sort(),
    sources: usable
      .flatMap((candidate) => candidate.source ? [candidate.source] : [])
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function calculateDimension(
  dimension: ScarcityDimension,
  observations: ScarcityObservation[],
  sourceById: Map<string, ScarcitySource>,
  asOf: string,
): DimensionResult {
  const definitions = SCARCITY_METRICS.filter((metric) => metric.dimension === dimension);
  const metrics = definitions.map((metric) =>
    calculateMetric(metric, observations, sourceById, asOf),
  );
  const totalWeight = definitions.reduce((sum, metric) => sum + metric.weight, 0);
  const available = metrics.filter((metric) => metric.normalizedScore !== null);
  const availableWeight = available.reduce((sum, metric) => sum + metric.methodologyWeight, 0);
  const coverageRatio = totalWeight > 0 ? availableWeight / totalWeight : 0;
  const hasCoverage = coverageRatio + 1e-9 >= MINIMUM_DIMENSION_COVERAGE[dimension];
  const score = hasCoverage && availableWeight > 0
    ? available.reduce(
      (sum, metric) => sum + (metric.normalizedScore ?? 0) * metric.methodologyWeight,
      0,
    ) / availableWeight
    : null;
  const confidenceScore = totalWeight > 0
    ? metrics.reduce(
      (sum, metric) => sum + metric.confidenceScore * metric.methodologyWeight,
      0,
    ) / totalWeight
    : 0;
  const freshnessScore = availableWeight > 0
    ? available.reduce((sum, metric) => {
      const statusScore = metric.dataStatus === "fresh"
        ? 1
        : metric.dataStatus === "aging"
          ? 0.55
          : metric.dataStatus === "stale"
            ? 0.2
            : 0;
      return sum + statusScore * metric.methodologyWeight;
    }, 0) / availableWeight
    : 0;

  return {
    dimension,
    score,
    confidenceScore,
    confidenceGrade: confidenceGrade(confidenceScore),
    coverageRatio,
    freshnessScore,
    dataStatus: dataStatus(freshnessScore, score !== null),
    metrics,
  };
}

function calculationId(
  metal: MetalDefinition,
  dataset: ScarcityDataset,
  asOf: string,
  dimensions: DimensionResult[],
) {
  const inputs = dimensions
    .flatMap((dimension) => dimension.metrics)
    .flatMap((metric) => metric.observationIds)
    .sort()
    .map((observationId) => {
      const observation = dataset.observations.find((candidate) => candidate.id === observationId);
      return observation
        ? {
          id: observation.id,
          value: observation.value,
          unit: observation.unit,
          observedAt: observation.observedAt,
          publishedAt: observation.publishedAt,
          sourceId: observation.sourceId,
          status: observation.status,
        }
        : { id: observationId, missing: true };
    });
  return createHash("sha256")
    .update(JSON.stringify({
      methodologyVersion: SCARCITY_METHODOLOGY_VERSION,
      metalId: metal.id,
      datasetId: dataset.id,
      asOf,
      inputs,
    }))
    .digest("hex");
}

export function calculateScarcitySnapshot(
  metal: MetalDefinition,
  dataset: ScarcityDataset,
  asOf = new Date().toISOString(),
): ScarcitySnapshot {
  if (!Number.isFinite(Date.parse(asOf))) throw new Error("A valid as-of timestamp is required.");
  const sourceById = new Map<string, ScarcitySource>();
  for (const source of dataset.sources) {
    validateScarcitySource(source);
    sourceById.set(source.id, source);
  }
  const observations = dataset.observations
    .filter((observation) => observation.metalId === metal.id)
    .map((observation) => validateScarcityObservation(observation));
  for (const observation of observations) {
    if (observation.datasetId !== dataset.id) {
      throw new Error(`Observation ${observation.id} does not belong to dataset ${dataset.id}.`);
    }
    if (!sourceById.has(observation.sourceId)) {
      throw new Error(`Observation ${observation.id} references an unknown source.`);
    }
  }

  const marketTightness = calculateDimension(
    "market-tightness",
    observations,
    sourceById,
    asOf,
  );
  const structuralScarcity = calculateDimension(
    "structural-scarcity",
    observations,
    sourceById,
    asOf,
  );
  const dimensions = [marketTightness, structuralScarcity];
  const allMetrics = dimensions.flatMap((dimension) => dimension.metrics);
  const sourceIds = new Set(
    allMetrics.flatMap((metric) => metric.sources.map((source) => source.id)),
  );
  const latestObservationAt = allMetrics
    .flatMap((metric) => metric.observedAt ? [metric.observedAt] : [])
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  const coverageRatio = dimensions.reduce((sum, dimension) => sum + dimension.coverageRatio, 0)
    / dimensions.length;
  const confidenceScore = dimensions.reduce(
    (sum, dimension) => sum + dimension.confidenceScore,
    0,
  ) / dimensions.length;
  const available = dimensions.some((dimension) => dimension.score !== null);
  const worstStatus = dimensions.some((dimension) => dimension.dataStatus === "stale")
    ? "stale"
    : dimensions.some((dimension) => dimension.dataStatus === "aging")
      ? "aging"
      : dimensions.every((dimension) => dimension.dataStatus === "fresh")
        ? "fresh"
        : "unavailable";

  return {
    metal,
    dataset: {
      id: dataset.id,
      label: dataset.label,
      kind: dataset.kind,
      description: dataset.description,
    },
    methodologyVersion: SCARCITY_METHODOLOGY_VERSION,
    generatedAt: new Date().toISOString(),
    asOf,
    calculationId: calculationId(metal, dataset, asOf, dimensions),
    marketTightness,
    structuralScarcity,
    dataConfidence: {
      score: confidenceScore,
      grade: confidenceGrade(confidenceScore),
      status: available ? worstStatus : "unavailable",
      coverageRatio,
      sourceCount: sourceIds.size,
      latestObservationAt,
    },
  };
}
