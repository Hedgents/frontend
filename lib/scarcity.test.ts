import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_SCARCITY_DATASET,
  InMemoryObservationRepository,
  SAMPLE_SCARCITY_DATASET,
  SCARCITY_METALS,
  SCARCITY_METRIC_BY_ID,
  calculateScarcitySnapshot,
  getScarcityMetal,
  listScarcitySnapshots,
  normalizeMetricValue,
  observationFreshness,
  validateScarcityObservation,
  type ScarcityDataset,
  type ScarcityObservation,
} from "./scarcity";

const AS_OF = "2026-08-08T00:00:00.000Z";

function copper() {
  const metal = getScarcityMetal("Cu");
  assert.ok(metal);
  return metal;
}

function observation(overrides: Partial<ScarcityObservation> = {}): ScarcityObservation {
  return {
    id: "test:copper:inventory-days:1",
    datasetId: "test-v1",
    metalId: "copper",
    metricId: "inventory-days",
    value: 60,
    unit: "days",
    observedAt: "2026-08-01T00:00:00.000Z",
    publishedAt: "2026-08-02T00:00:00.000Z",
    sourceId: "test-official",
    status: "final",
    coverageRatio: 1,
    independentSourceCount: 2,
    ...overrides,
  };
}

function dataset(observations: ScarcityObservation[]): ScarcityDataset {
  return {
    id: "test-v1",
    label: "Test dataset",
    kind: "production",
    description: "Deterministic test observations.",
    sources: [{
      id: "test-official",
      name: "Test official source",
      kind: "official-statistics",
    }],
    observations,
  };
}

test("normalizes metric values with transparent piecewise interpolation", () => {
  const metric = SCARCITY_METRIC_BY_ID["inventory-days"];
  assert.equal(normalizeMetricValue(metric, 0), 100);
  assert.equal(normalizeMetricValue(metric, 30), 85);
  assert.equal(normalizeMetricValue(metric, 60), 70);
  assert.equal(normalizeMetricValue(metric, 365), 0);
  assert.equal(normalizeMetricValue(metric, 900), 0);
});

test("decays stale observations without changing their underlying value", () => {
  const metric = SCARCITY_METRIC_BY_ID["inventory-days"];
  const fresh = observationFreshness(observation(), metric, AS_OF);
  const stale = observationFreshness(observation(), metric, "2026-11-08T00:00:00.000Z");
  assert.equal(fresh.score, 1);
  assert.equal(stale.score, 0);
  assert.ok(stale.ageDays > fresh.ageDays);
});

test("fails closed when no verified observations exist", () => {
  const snapshot = calculateScarcitySnapshot(copper(), EMPTY_SCARCITY_DATASET, AS_OF);
  assert.equal(snapshot.marketTightness.score, null);
  assert.equal(snapshot.structuralScarcity.score, null);
  assert.equal(snapshot.marketTightness.dataStatus, "unavailable");
  assert.equal(snapshot.dataConfidence.sourceCount, 0);
  assert.equal(snapshot.dataConfidence.grade, "insufficient");
});

test("calculates all illustrative metals while preserving the sample warning", () => {
  const snapshots = listScarcitySnapshots({ dataset: SAMPLE_SCARCITY_DATASET, asOf: AS_OF });
  assert.equal(snapshots.length, SCARCITY_METALS.length);
  const copperSnapshot = snapshots.find((snapshot) => snapshot.metal.id === "copper");
  assert.ok(copperSnapshot);
  assert.equal(copperSnapshot.dataset.kind, "sample");
  assert.ok((copperSnapshot.marketTightness.score ?? 0) > 50);
  assert.ok((copperSnapshot.structuralScarcity.score ?? 0) > 50);
  assert.equal(copperSnapshot.dataConfidence.grade, "insufficient");
});

test("produces the same calculation id for the same point-in-time inputs", () => {
  const first = calculateScarcitySnapshot(copper(), SAMPLE_SCARCITY_DATASET, AS_OF);
  const second = calculateScarcitySnapshot(copper(), SAMPLE_SCARCITY_DATASET, AS_OF);
  assert.equal(first.calculationId, second.calculationId);
});

test("does not publish a dimension score below its coverage gate", () => {
  const snapshot = calculateScarcitySnapshot(copper(), dataset([observation()]), AS_OF);
  assert.equal(snapshot.marketTightness.coverageRatio, 0.3);
  assert.equal(snapshot.marketTightness.score, null);
  assert.equal(snapshot.structuralScarcity.score, null);
});

test("rejects unit mismatches instead of silently coercing observations", () => {
  assert.throws(
    () => validateScarcityObservation(observation({ unit: "percent" })),
    /must use days/,
  );
});

test("repository upserts by id and honors point-in-time publication", () => {
  const repository = new InMemoryObservationRepository();
  repository.upsert([observation()]);
  repository.upsert([observation({ value: 42 })]);
  repository.upsert([observation({
    id: "test:copper:inventory-days:future",
    value: 20,
    observedAt: "2026-09-01T00:00:00.000Z",
    publishedAt: "2026-09-02T00:00:00.000Z",
  })]);

  assert.equal(repository.list({ datasetId: "test-v1" }).length, 2);
  assert.equal(repository.list({ datasetId: "test-v1", asOf: AS_OF }).length, 1);
  assert.equal(repository.list({ datasetId: "test-v1", asOf: AS_OF })[0].value, 42);
});
