import assert from "node:assert/strict";
import test from "node:test";
import {
  loadProductionScarcityDataset,
  publishScarcityObservationBatch,
  readScarcityArtifact,
  resetScarcityDataForTests,
} from "./scarcity-data-store";
import { USGS_BASELINE_COVERAGE, type ScarcityObservationBatch } from "./scarcity";

function batch(value = 42): ScarcityObservationBatch {
  const now = Date.now();
  const observedAt = new Date(now - 3_600_000).toISOString();
  const publishedAt = new Date(now - 1_800_000).toISOString();
  const retrievedAt = new Date(now - 900_000).toISOString();
  return {
    schemaVersion: "1.0.0",
    batchId: "usgs:copper:inventory:2026-08",
    datasetId: "production-v1",
    source: {
      id: "usgs-copper-test",
      name: "USGS copper test publication",
      kind: "official-statistics",
      url: "https://www.usgs.gov/",
    },
    observations: [{
      id: "usgs-copper-test:inventory-days:2026-08",
      datasetId: "production-v1",
      metalId: "copper",
      metricId: "inventory-days",
      value,
      unit: "days",
      observedAt,
      publishedAt,
      sourceId: "usgs-copper-test",
      status: "final",
      coverageRatio: 0.8,
      independentSourceCount: 1,
    }],
    artifact: {
      contentType: "application/json",
      content: JSON.stringify({ value, observedAt }),
      retrievedAt,
      sourceUrl: "https://www.usgs.gov/",
    },
    review: {
      reviewer: "test-admin",
      reviewedAt: new Date(now - 600_000).toISOString(),
    },
  };
}

test.beforeEach(() => resetScarcityDataForTests());

test("publishes reviewed observations with content-addressed evidence", async () => {
  const candidate = batch();
  const published = await publishScarcityObservationBatch(candidate);
  assert.equal(published.published, true);
  assert.match(published.artifactHash, /^[a-f0-9]{64}$/);
  const dataset = await loadProductionScarcityDataset();
  assert.equal(dataset.kind, "production");
  assert.equal(dataset.observations.length, USGS_BASELINE_COVERAGE.observationCount + 1);
  assert.equal(dataset.stateSnapshots?.length, 1);
  assert.equal(dataset.stateSnapshots?.[0].metalId, "copper");
  assert.equal(
    dataset.observations.find((observation) => observation.id === candidate.observations[0].id)?.artifactHash,
    published.artifactHash,
  );
  const artifact = await readScarcityArtifact(published.artifactHash);
  assert.equal(artifact?.contentType, "application/json");
  assert.match(artifact?.content ?? "", /"value":42/);
  const retried = await publishScarcityObservationBatch(candidate);
  assert.equal(retried.datasetHash, published.datasetHash);
  assert.equal(
    (await loadProductionScarcityDataset()).observations.length,
    USGS_BASELINE_COVERAGE.observationCount + 1,
  );
});

test("observation identities are immutable and require explicit revisions", async () => {
  await publishScarcityObservationBatch(batch());
  await assert.rejects(() => publishScarcityObservationBatch(batch(43)), /immutable/);
});

test("production publication rejects missing source artifacts", async () => {
  const candidate = batch();
  candidate.artifact.content = "";
  await assert.rejects(() => publishScarcityObservationBatch(candidate), /Artifact content/);
});
