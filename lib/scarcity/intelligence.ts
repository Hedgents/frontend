import { createHash } from "node:crypto";
import { calculateScarcitySnapshot } from "./engine";
import { SCARCITY_METRIC_BY_ID, SCARCITY_METHODOLOGY_VERSION } from "./methodology";
import { getScarcityMetal, SCARCITY_METALS } from "./registry";
import type {
  CoverageStatus,
  MaterializedMetalState,
  MetricResult,
  ScarcityDataset,
  ScarcityMetricId,
  ScarcitySnapshot,
} from "./types";

export type MetalSignalType =
  | "inventory-cover-low"
  | "supply-deficit"
  | "demand-acceleration"
  | "supply-contraction"
  | "regional-premium-spike"
  | "reserve-life-low"
  | "supply-concentration-high"
  | "byproduct-dependency-high"
  | "recycling-buffer-low"
  | "substitution-difficulty-high"
  | "state-momentum"
  | "confidence-deterioration";

export type SignalSeverity = "info" | "watch" | "material" | "critical";

export interface MetalSignal {
  id: string;
  metalId: string;
  metalSymbol: string;
  metalName: string;
  type: MetalSignalType;
  label: string;
  description: string;
  direction: "tightening" | "loosening" | "neutral";
  severity: SignalSeverity;
  detectedAt: string;
  effectiveAt: string;
  expiresAt: string | null;
  snapshotId: string;
  priorSnapshotId: string | null;
  evidenceIds: string[];
  methodologyVersion: string;
  publication: "reviewed" | "illustrative";
  trigger: {
    metricId: ScarcityMetricId | "market-tightness" | "data-confidence";
    metric: string;
    comparator: "less-than-or-equal" | "greater-than-or-equal" | "change-at-least" | "change-at-most";
    threshold: number;
    observed: number;
    unit: string;
  };
  status: "active" | "expired";
}

export interface ScarcityMarketCandidate {
  id: string;
  signalId: string;
  metalId: string;
  metalSymbol: string;
  question: string;
  observationAt: string;
  metricId: string;
  comparator: "less-than-or-equal" | "greater-than-or-equal";
  threshold: number;
  unit: string;
  primarySourceIds: string[];
  invalidConditions: string[];
  methodologyVersion: string;
  specificationHash: string;
  readiness: "blocked" | "paper-ready" | "review-ready";
  blockers: string[];
}

export interface MetalIntelligence {
  snapshot: ScarcitySnapshot;
  state: MaterializedMetalState;
  history: MaterializedMetalState[];
  signals: MetalSignal[];
  candidates: ScarcityMarketCandidate[];
}

interface ThresholdRule {
  type: MetalSignalType;
  metricId: ScarcityMetricId;
  label: string;
  comparator: "less-than-or-equal" | "greater-than-or-equal";
  threshold: number;
  direction: "tightening" | "loosening";
  severity: SignalSeverity;
}

const thresholdRules: ThresholdRule[] = [
  { type: "inventory-cover-low", metricId: "inventory-days", label: "Inventory cover is low", comparator: "less-than-or-equal", threshold: 60, direction: "tightening", severity: "material" },
  { type: "supply-deficit", metricId: "supply-balance-pct", label: "Measured supply deficit", comparator: "greater-than-or-equal", threshold: 5, direction: "tightening", severity: "material" },
  { type: "demand-acceleration", metricId: "demand-growth-yoy-pct", label: "Demand is accelerating", comparator: "greater-than-or-equal", threshold: 5, direction: "tightening", severity: "watch" },
  { type: "supply-contraction", metricId: "supply-growth-yoy-pct", label: "Available supply is contracting", comparator: "less-than-or-equal", threshold: 0, direction: "tightening", severity: "material" },
  { type: "regional-premium-spike", metricId: "regional-premium-pct", label: "Regional premium is elevated", comparator: "greater-than-or-equal", threshold: 10, direction: "tightening", severity: "material" },
  { type: "reserve-life-low", metricId: "reserve-life-years", label: "Reserve life is constrained", comparator: "less-than-or-equal", threshold: 25, direction: "tightening", severity: "watch" },
  { type: "supply-concentration-high", metricId: "top-three-supply-share-pct", label: "Supply concentration is high", comparator: "greater-than-or-equal", threshold: 70, direction: "tightening", severity: "watch" },
  { type: "byproduct-dependency-high", metricId: "byproduct-dependency-pct", label: "By-product dependency is high", comparator: "greater-than-or-equal", threshold: 65, direction: "tightening", severity: "watch" },
  { type: "recycling-buffer-low", metricId: "recycling-share-pct", label: "Recycling buffer is low", comparator: "less-than-or-equal", threshold: 15, direction: "tightening", severity: "watch" },
  { type: "substitution-difficulty-high", metricId: "substitution-ease-score", label: "Substitution is difficult", comparator: "less-than-or-equal", threshold: 25, direction: "tightening", severity: "watch" },
];

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function stableHash(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function observationIds(snapshot: ScarcitySnapshot) {
  return [...new Set([
    ...snapshot.marketTightness.metrics.flatMap((metric) => metric.observationIds),
    ...snapshot.structuralScarcity.metrics.flatMap((metric) => metric.observationIds),
  ])].sort();
}

function coverageStatus(snapshot: ScarcitySnapshot): CoverageStatus {
  if (snapshot.dataConfidence.sourceCount === 0) return "uncovered";
  const bothDimensions = snapshot.marketTightness.score !== null
    && snapshot.structuralScarcity.score !== null;
  const confidencePasses = snapshot.dataConfidence.grade !== "insufficient";
  return bothDimensions && confidencePasses && snapshot.dataset.kind === "production"
    ? "verified"
    : "partial";
}

function momentum(
  snapshot: ScarcitySnapshot,
  previous?: MaterializedMetalState | null,
): MaterializedMetalState["momentum"] {
  const current = snapshot.marketTightness.score;
  const prior = previous?.marketTightness ?? null;
  if (current === null || prior === null) {
    return { direction: "unknown", change: null, windowStart: previous?.asOf ?? null };
  }
  const change = current - prior;
  return {
    direction: change >= 2 ? "tightening" : change <= -2 ? "loosening" : "stable",
    change,
    windowStart: previous?.asOf ?? null,
  };
}

export function materializeMetalState(
  snapshot: ScarcitySnapshot,
  previous?: MaterializedMetalState | null,
  createdAt = snapshot.asOf,
): MaterializedMetalState {
  const ids = observationIds(snapshot);
  const evidenceRoot = stableHash({
    methodologyVersion: snapshot.methodologyVersion,
    calculationId: snapshot.calculationId,
    observationIds: ids,
  });
  const id = stableHash({
    schemaVersion: "1.0.0",
    datasetId: snapshot.dataset.id,
    metalId: snapshot.metal.id,
    asOf: snapshot.asOf,
    calculationId: snapshot.calculationId,
    evidenceRoot,
  });
  return {
    id,
    metalId: snapshot.metal.id,
    datasetId: snapshot.dataset.id,
    asOf: snapshot.asOf,
    createdAt,
    methodologyVersion: snapshot.methodologyVersion,
    calculationId: snapshot.calculationId,
    evidenceRoot,
    marketTightness: snapshot.marketTightness.score,
    structuralScarcity: snapshot.structuralScarcity.score,
    confidence: snapshot.dataConfidence.score,
    coverageStatus: coverageStatus(snapshot),
    momentum: momentum(snapshot, previous),
    observationIds: ids,
  };
}

function deriveHistory(dataset: ScarcityDataset, metalId: string, asOf: string) {
  const metal = getScarcityMetal(metalId);
  if (!metal) return [];
  const publicationTimes = [...new Set(dataset.observations
    .filter((observation) => observation.metalId === metal.id && Date.parse(observation.publishedAt) <= Date.parse(asOf))
    .map((observation) => new Date(observation.publishedAt).toISOString()))]
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const states: MaterializedMetalState[] = [];
  for (const timestamp of publicationTimes) {
    const snapshot = calculateScarcitySnapshot(metal, dataset, timestamp);
    states.push(materializeMetalState(snapshot, states.at(-1), timestamp));
  }
  return states;
}

export function listMetalStateHistory(options: {
  dataset: ScarcityDataset;
  metalId: string;
  asOf?: string;
  limit?: number;
}) {
  const asOf = options.asOf ?? new Date().toISOString();
  const stored = (options.dataset.stateSnapshots ?? [])
    .filter((state) => state.metalId === options.metalId && Date.parse(state.asOf) <= Date.parse(asOf))
    .sort((left, right) => Date.parse(left.asOf) - Date.parse(right.asOf));
  const states = stored.length > 0 ? stored : deriveHistory(options.dataset, options.metalId, asOf);
  const limit = Math.min(500, Math.max(1, options.limit ?? 120));
  return states.slice(-limit);
}

function metric(snapshot: ScarcitySnapshot, metricId: ScarcityMetricId) {
  return [...snapshot.marketTightness.metrics, ...snapshot.structuralScarcity.metrics]
    .find((candidate) => candidate.metricId === metricId) ?? null;
}

function signalDescription(rule: ThresholdRule, result: MetricResult) {
  const operator = rule.comparator === "less-than-or-equal" ? "at or below" : "at or above";
  return `${result.label} is ${operator} the ${rule.threshold} ${result.unit} signal threshold.`;
}

function signalExpiry(result: MetricResult) {
  if (!result.observedAt) return null;
  const definition = SCARCITY_METRIC_BY_ID[result.metricId];
  return new Date(Date.parse(result.observedAt) + definition.maximumAgeDays * 86_400_000).toISOString();
}

function signalStatus(expiresAt: string | null, asOf: string) {
  return expiresAt && Date.parse(expiresAt) < Date.parse(asOf) ? "expired" as const : "active" as const;
}

export function detectMetalSignals(options: {
  snapshot: ScarcitySnapshot;
  state: MaterializedMetalState;
  previous?: MaterializedMetalState | null;
}): MetalSignal[] {
  const { snapshot, state, previous } = options;
  if (snapshot.dataset.kind === "empty") return [];
  const publication = snapshot.dataset.kind === "sample" ? "illustrative" as const : "reviewed" as const;
  const signals: MetalSignal[] = [];

  for (const rule of thresholdRules) {
    const result = metric(snapshot, rule.metricId);
    if (!result || result.value === null || result.dataStatus === "unavailable") continue;
    const triggered = rule.comparator === "less-than-or-equal"
      ? result.value <= rule.threshold
      : result.value >= rule.threshold;
    if (!triggered) continue;
    const expiresAt = signalExpiry(result);
    const effectiveAt = result.observedAt ?? snapshot.asOf;
    const core = {
      metalId: snapshot.metal.id,
      type: rule.type,
      snapshotId: state.id,
      metricId: rule.metricId,
      observed: result.value,
      threshold: rule.threshold,
    };
    signals.push({
      id: stableHash(core),
      metalId: snapshot.metal.id,
      metalSymbol: snapshot.metal.symbol,
      metalName: snapshot.metal.name,
      type: rule.type,
      label: rule.label,
      description: signalDescription(rule, result),
      direction: rule.direction,
      severity: rule.severity,
      detectedAt: snapshot.asOf,
      effectiveAt,
      expiresAt,
      snapshotId: state.id,
      priorSnapshotId: previous?.id ?? null,
      evidenceIds: result.observationIds,
      methodologyVersion: snapshot.methodologyVersion,
      publication,
      trigger: {
        metricId: rule.metricId,
        metric: result.label,
        comparator: rule.comparator,
        threshold: rule.threshold,
        observed: result.value,
        unit: result.unit,
      },
      status: signalStatus(expiresAt, snapshot.asOf),
    });
  }

  if (state.momentum.change !== null && Math.abs(state.momentum.change) >= 5) {
    const change = state.momentum.change;
    const core = { metalId: state.metalId, type: "state-momentum", snapshotId: state.id, change };
    signals.push({
      id: stableHash(core),
      metalId: snapshot.metal.id,
      metalSymbol: snapshot.metal.symbol,
      metalName: snapshot.metal.name,
      type: "state-momentum",
      label: change > 0 ? "Tightness accelerated" : "Tightness eased",
      description: `Market Tightness changed ${change > 0 ? "+" : ""}${change.toFixed(1)} points from the prior reviewed state.`,
      direction: change > 0 ? "tightening" : "loosening",
      severity: Math.abs(change) >= 12 ? "critical" : "material",
      detectedAt: snapshot.asOf,
      effectiveAt: snapshot.asOf,
      expiresAt: null,
      snapshotId: state.id,
      priorSnapshotId: previous?.id ?? null,
      evidenceIds: state.observationIds,
      methodologyVersion: snapshot.methodologyVersion,
      publication,
      trigger: {
        metricId: "market-tightness",
        metric: "Market Tightness change",
        comparator: change > 0 ? "change-at-least" : "change-at-most",
        threshold: change > 0 ? 5 : -5,
        observed: change,
        unit: "score points",
      },
      status: "active",
    });
  }

  if (previous && previous.confidence - state.confidence >= 15) {
    const change = state.confidence - previous.confidence;
    const core = { metalId: state.metalId, type: "confidence-deterioration", snapshotId: state.id, change };
    signals.push({
      id: stableHash(core),
      metalId: snapshot.metal.id,
      metalSymbol: snapshot.metal.symbol,
      metalName: snapshot.metal.name,
      type: "confidence-deterioration",
      label: "Data confidence deteriorated",
      description: `Data confidence fell ${Math.abs(change).toFixed(1)} points from the prior reviewed state.`,
      direction: "neutral",
      severity: Math.abs(change) >= 30 ? "critical" : "material",
      detectedAt: snapshot.asOf,
      effectiveAt: snapshot.asOf,
      expiresAt: null,
      snapshotId: state.id,
      priorSnapshotId: previous.id,
      evidenceIds: state.observationIds,
      methodologyVersion: snapshot.methodologyVersion,
      publication,
      trigger: {
        metricId: "data-confidence",
        metric: "Data Confidence change",
        comparator: "change-at-most",
        threshold: -15,
        observed: change,
        unit: "score points",
      },
      status: "active",
    });
  }

  const severityRank: Record<SignalSeverity, number> = { critical: 4, material: 3, watch: 2, info: 1 };
  return signals.sort((left, right) => severityRank[right.severity] - severityRank[left.severity] || left.id.localeCompare(right.id));
}

function addDays(value: string, days: number) {
  return new Date(Date.parse(value) + days * 86_400_000).toISOString();
}

export function compileSignalMarketCandidates(options: {
  dataset: ScarcityDataset;
  snapshot: ScarcitySnapshot;
  state: MaterializedMetalState;
  signals: MetalSignal[];
}): ScarcityMarketCandidate[] {
  const observationById = new Map(options.dataset.observations.map((observation) => [observation.id, observation]));
  const sourceById = new Map(options.dataset.sources.map((source) => [source.id, source]));
  return options.signals
    .filter((signal) => signal.trigger.metricId !== "market-tightness" && signal.trigger.metricId !== "data-confidence")
    .map((signal) => {
      const definition = SCARCITY_METRIC_BY_ID[signal.trigger.metricId as ScarcityMetricId];
      const evidence = signal.evidenceIds.flatMap((id) => {
        const observation = observationById.get(id);
        return observation ? [observation] : [];
      });
      const sources = [...new Set(evidence.map((observation) => observation.sourceId))]
        .map((id) => sourceById.get(id))
        .filter((source) => source !== undefined);
      const scheduled = sources
        .flatMap((source) => source.nextExpectedAt ? [source.nextExpectedAt] : [])
        .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
      const cadenceDays = sources
        .flatMap((source) => source.updateCadenceDays ? [source.updateCadenceDays] : [])
        .sort((left, right) => left - right)[0];
      const observationAt = scheduled ?? addDays(signal.effectiveAt, cadenceDays ?? definition.maximumAgeDays);
      const blockers: string[] = [];
      if (options.dataset.kind === "sample") blockers.push("Illustrative data can produce paper candidates only.");
      if (options.state.coverageStatus !== "verified") blockers.push("Current Metal State has not reached verified coverage.");
      if (options.state.confidence < 50) blockers.push("Data confidence is below the market-readiness minimum.");
      if (evidence.length === 0 || evidence.some((item) => !item.artifactHash)) blockers.push("Committed evidence artifacts are incomplete.");
      if (sources.length === 0 || sources.some((source) => source.settlementUse !== "permitted")) blockers.push("Settlement-use rights are not approved for every source.");
      if (sources.length === 0 || sources.some((source) => source.redistribution !== "permitted" || !source.rightsReviewedAt)) blockers.push("Source redistribution rights have not been reviewed and approved.");
      if (!scheduled && !cadenceDays) blockers.push("The source has no registered publication time or update cadence.");
      if (signal.status !== "active") blockers.push("The triggering signal has expired.");
      const readiness = options.dataset.kind === "sample"
        ? "paper-ready" as const
        : blockers.length === 0 ? "review-ready" as const : "blocked" as const;
      const operator = signal.trigger.comparator === "less-than-or-equal" ? "at or below" : "at or above";
      const question = `Will ${options.snapshot.metal.name} ${signal.trigger.metric.toLowerCase()} be ${operator} ${signal.trigger.threshold} ${signal.trigger.unit} on ${observationAt}?`;
      const specification = {
        schemaVersion: "1.0.0",
        signalId: signal.id,
        metalId: signal.metalId,
        question,
        observationAt,
        metricId: signal.trigger.metricId,
        comparator: signal.trigger.comparator,
        threshold: signal.trigger.threshold,
        unit: signal.trigger.unit,
        primarySourceIds: sources.map((source) => source.id).sort(),
        methodologyVersion: SCARCITY_METHODOLOGY_VERSION,
      };
      const specificationHash = stableHash(specification);
      return {
        id: stableHash({ schemaVersion: "1.0.0", specificationHash }),
        signalId: signal.id,
        metalId: signal.metalId,
        metalSymbol: signal.metalSymbol,
        question,
        observationAt,
        metricId: signal.trigger.metricId,
        comparator: signal.trigger.comparator as "less-than-or-equal" | "greater-than-or-equal",
        threshold: signal.trigger.threshold,
        unit: signal.trigger.unit,
        primarySourceIds: specification.primarySourceIds,
        invalidConditions: [
          "The named future observation is not published by the resolution deadline.",
          "The committed source is withdrawn or cannot be independently verified.",
          "The methodology or units differ from the frozen candidate specification.",
        ],
        methodologyVersion: SCARCITY_METHODOLOGY_VERSION,
        specificationHash,
        readiness,
        blockers,
      };
    });
}

export function getMetalIntelligence(options: {
  identifier: string;
  dataset: ScarcityDataset;
  asOf?: string;
}): MetalIntelligence | null {
  const metal = getScarcityMetal(options.identifier);
  if (!metal) return null;
  const asOf = options.asOf ?? new Date().toISOString();
  const snapshot = calculateScarcitySnapshot(metal, options.dataset, asOf);
  const history = listMetalStateHistory({ dataset: options.dataset, metalId: metal.id, asOf });
  const latest = history.at(-1);
  const currentObservationIds = observationIds(snapshot);
  const latestMatchesCurrentInputs = Boolean(latest)
    && latest!.observationIds.length === currentObservationIds.length
    && latest!.observationIds.every((id, index) => id === currentObservationIds[index]);
  const previous = latestMatchesCurrentInputs ? history.at(-2) : latest;
  const state = latestMatchesCurrentInputs
    ? latest!
    : materializeMetalState(snapshot, previous, asOf);
  const signals = detectMetalSignals({ snapshot, state, previous });
  return {
    snapshot,
    state,
    history,
    signals,
    candidates: compileSignalMarketCandidates({ dataset: options.dataset, snapshot, state, signals }),
  };
}

export function listMetalIntelligence(options: {
  dataset: ScarcityDataset;
  asOf?: string;
}) {
  return SCARCITY_METALS.map((metal) => getMetalIntelligence({
    identifier: metal.id,
    dataset: options.dataset,
    asOf: options.asOf,
  })!).filter(Boolean);
}
