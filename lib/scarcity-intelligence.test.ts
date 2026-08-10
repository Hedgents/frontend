import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_SCARCITY_METALS,
  PERIODIC_ELEMENTS,
  SAMPLE_SCARCITY_DATASET,
  SCARCITY_METALS,
  getMetalIntelligence,
  listMetalStateHistory,
  type ScarcityDataset,
  type ScarcityObservation,
} from "./scarcity";

function productionHistory(): ScarcityDataset {
  const sourceId = "verified-metal-source";
  const source = {
    id: sourceId,
    name: "Verified metal source",
    kind: "official-statistics" as const,
    url: "https://www.usgs.gov/",
    nextExpectedAt: "2026-09-20T00:00:00.000Z",
    redistribution: "permitted" as const,
    settlementUse: "permitted" as const,
    rightsReviewedAt: "2026-08-01T00:00:00.000Z",
  };
  const copper = SAMPLE_SCARCITY_DATASET.observations.filter((item) => item.metalId === "copper");
  const cycle = (suffix: string, observedAt: string, publishedAt: string, changes: Partial<Record<string, number>> = {}) => copper.map((item) => ({
    ...item,
    id: `verified:${item.metalId}:${item.metricId}:${suffix}`,
    datasetId: "verified-history",
    sourceId,
    status: "final" as const,
    independentSourceCount: 2,
    value: changes[item.metricId] ?? item.value,
    observedAt,
    publishedAt,
    retrievedAt: publishedAt,
    artifactHash: "ab".repeat(32),
    artifactPath: `/api/scarcity/artifacts/${"ab".repeat(32)}`,
    artifactContentType: "application/json",
  } satisfies ScarcityObservation));
  return {
    id: "verified-history",
    label: "Verified history",
    kind: "production",
    description: "Two reviewed observation cycles.",
    sources: [source],
    observations: [
      ...cycle("2026-07", "2026-07-01T00:00:00.000Z", "2026-07-02T00:00:00.000Z"),
      ...cycle("2026-08", "2026-08-19T00:00:00.000Z", "2026-08-20T00:00:00.000Z", {
        "inventory-days": 20,
        "supply-balance-pct": 9,
        "regional-premium-pct": 15,
      }),
    ],
  };
}

test("registers the complete periodic table while keeping an explicit initial coverage set", () => {
  assert.equal(PERIODIC_ELEMENTS.length, 118);
  assert.equal(SCARCITY_METALS.length, 99);
  assert.equal(INITIAL_SCARCITY_METALS.length, 8);
  assert.equal(SCARCITY_METALS.some((metal) => metal.symbol === "Fe"), true);
  assert.deepEqual(
    SCARCITY_METALS.filter((metal) => ["B", "Si", "Ge", "As", "Sb", "Te"].includes(metal.symbol)).map((metal) => metal.symbol),
    ["B", "Si", "Ge", "As", "Sb", "Te"],
  );
});

test("materializes deterministic state history from reviewed publication cycles", () => {
  const dataset = productionHistory();
  const first = listMetalStateHistory({ dataset, metalId: "copper", asOf: "2026-08-21T00:00:00.000Z" });
  const second = listMetalStateHistory({ dataset, metalId: "copper", asOf: "2026-08-21T00:00:00.000Z" });
  assert.equal(first.length, 2);
  assert.deepEqual(first, second);
  assert.equal(first[1].coverageStatus, "verified");
  assert.equal(first[1].momentum.direction, "tightening");
  assert.match(first[1].evidenceRoot, /^[a-f0-9]{64}$/);
});

test("detects objective signals and compiles readiness-gated binary candidates", () => {
  const intelligence = getMetalIntelligence({
    identifier: "Cu",
    dataset: productionHistory(),
    asOf: "2026-08-21T00:00:00.000Z",
  });
  assert.ok(intelligence);
  assert.equal(intelligence.state.coverageStatus, "verified");
  assert.equal(intelligence.signals.some((signal) => signal.type === "inventory-cover-low"), true);
  assert.equal(intelligence.signals.some((signal) => signal.type === "supply-deficit"), true);
  assert.equal(intelligence.signals.some((signal) => signal.type === "state-momentum"), true);
  assert.ok(intelligence.candidates.length > 0);
  assert.equal(intelligence.candidates.every((candidate) => candidate.readiness === "review-ready"), true);
  assert.equal(intelligence.candidates.every((candidate) => candidate.blockers.length === 0), true);
  assert.match(intelligence.candidates[0].specificationHash, /^[a-f0-9]{64}$/);
});

test("sample signals stay visibly illustrative and can only become paper candidates", () => {
  const intelligence = getMetalIntelligence({
    identifier: "uranium",
    dataset: SAMPLE_SCARCITY_DATASET,
    asOf: "2026-08-08T00:00:00.000Z",
  });
  assert.ok(intelligence);
  assert.ok(intelligence.signals.length > 0);
  assert.equal(intelligence.signals.every((signal) => signal.publication === "illustrative"), true);
  assert.equal(intelligence.candidates.every((candidate) => candidate.readiness === "paper-ready"), true);
});
