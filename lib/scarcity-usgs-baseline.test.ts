import assert from "node:assert/strict";
import test from "node:test";
import {
  BUNDLED_USGS_SCARCITY_DATASET,
  SCARCITY_METALS,
  USGS_BASELINE_COVERAGE,
  calculateScarcitySnapshot,
  getScarcityMetal,
} from "./scarcity";

test("bundles the checksummed USGS annual baseline across direct and group-reported metals", () => {
  assert.equal(USGS_BASELINE_COVERAGE.coveredMetalCount, 50);
  assert.equal(USGS_BASELINE_COVERAGE.observationCount, 111);
  assert.equal(USGS_BASELINE_COVERAGE.directMetalCount, 36);
  assert.equal(USGS_BASELINE_COVERAGE.groupMetalCount, 14);
  assert.equal(BUNDLED_USGS_SCARCITY_DATASET.sources[0].kind, "official-statistics");
  assert.match(BUNDLED_USGS_SCARCITY_DATASET.sources[0].notes ?? "", /SHA-256 [a-f0-9]{64}/);
  assert.match(BUNDLED_USGS_SCARCITY_DATASET.sources[0].notes ?? "", /582a0aa231aea53d8a97dc8d1cd3dfa5f885cf3760353e3d029d7f0ae4fbaaf5/);
});

test("derives copper annual metrics from explicit USGS world totals", () => {
  const copper = getScarcityMetal("Cu");
  assert.ok(copper);
  const snapshot = calculateScarcitySnapshot(copper, BUNDLED_USGS_SCARCITY_DATASET, "2026-08-08T00:00:00.000Z");
  const metrics = [...snapshot.marketTightness.metrics, ...snapshot.structuralScarcity.metrics];
  assert.equal(metrics.find((metric) => metric.metricId === "supply-growth-yoy-pct")?.value, 0);
  assert.equal(metrics.find((metric) => metric.metricId === "top-three-supply-share-pct")?.value, 48.6957);
  assert.equal(metrics.find((metric) => metric.metricId === "reserve-life-years")?.value, 42.6087);
  assert.notEqual(snapshot.structuralScarcity.score, null);
  assert.equal(snapshot.marketTightness.score, null);
});

test("labels rare-earth observations as group context instead of element-specific claims", () => {
  const lanthanum = getScarcityMetal("La");
  assert.ok(lanthanum);
  assert.equal(lanthanum.dataMode, "group");
  const observations = BUNDLED_USGS_SCARCITY_DATASET.observations.filter((observation) => observation.metalId === "lanthanum");
  assert.equal(observations.length, 2);
  assert.ok(observations.every((observation) => observation.notes?.includes("Group-reported observation")));
  assert.ok(observations.every((observation) => observation.coverageRatio <= 0.55));
});

test("keeps non-commercial elements in the scientific registry without inventing observations", () => {
  const technetium = getScarcityMetal("Tc");
  assert.ok(technetium);
  assert.equal(technetium.marketStatus, "non-commercial");
  assert.equal(technetium.dataMode, "none");
  assert.equal(BUNDLED_USGS_SCARCITY_DATASET.observations.some((observation) => observation.metalId === technetium.id), false);
  assert.ok(SCARCITY_METALS.some((metal) => metal.id === "selenium"));
});
