import assert from "node:assert/strict";
import test from "node:test";
import {
  resetOnlineDetectorForTests,
  reviewOnlineDetectorEvidence,
  saveOnlineDetectorState,
} from "./scarcity-detector-store";
import {
  loadReviewedMarketSpecifications,
  loadScarcityMarketCatalog,
  publishReviewedDetectorCandidate,
  resetReviewedMarketsForTests,
} from "./scarcity-market-store";
import {
  EMPTY_ONLINE_DETECTOR_STATE,
  evidenceFromRecord,
  rebuildOnlineOutputs,
} from "./scarcity/online-detector";

test("approved detector evidence becomes one immutable reviewed market specification", async () => {
  resetOnlineDetectorForTests();
  resetReviewedMarketsForTests();
  const [evidence] = evidenceFromRecord({
    sourceId: "official:test-germanium-rule",
    sourceKind: "official-feed",
    publisher: "Test Minerals Authority",
    title: "Proposed rule on germanium export controls",
    summary: "The authority requests comment on a proposed germanium export control.",
    url: "https://example.gov/germanium-rule",
    category: "policy",
    publishedAt: "2026-08-01T00:00:00.000Z",
    retrievedAt: "2026-08-02T00:00:00.000Z",
    authority: "primary",
    artifactHash: "ab".repeat(32),
    artifactPath: "/api/scarcity/detector/artifacts/example",
    recordType: "Proposed Rule",
  });
  const initialOutputs = rebuildOnlineOutputs([evidence]);
  await saveOnlineDetectorState({
    ...structuredClone(EMPTY_ONLINE_DETECTOR_STATE),
    evidence: [evidence],
    signals: initialOutputs.signals,
    candidates: initialOutputs.candidates,
  });
  const reviewed = await reviewOnlineDetectorEvidence({
    evidenceId: evidence.id,
    decision: "approved",
    reviewer: "test-operator",
    reviewedAt: "2026-08-03T00:00:00.000Z",
  });
  assert.equal(reviewed.candidates[0]?.readiness, "review-ready");
  const published = await publishReviewedDetectorCandidate({
    candidateId: reviewed.candidates[0].id,
    reviewer: "test-operator",
    publishedAt: "2026-08-04T00:00:00.000Z",
  });
  assert.equal(published.created, true);
  assert.equal(published.specification.market.question.kind, "event");
  assert.equal(published.specification.market.onchain, null);
  assert.equal((await loadReviewedMarketSpecifications()).length, 1);
  assert.equal((await loadScarcityMarketCatalog()).length, 100);
  assert.equal((await publishReviewedDetectorCandidate({
    candidateId: reviewed.candidates[0].id,
    reviewer: "test-operator",
    publishedAt: "2026-08-05T00:00:00.000Z",
  })).created, false);
  resetOnlineDetectorForTests();
  resetReviewedMarketsForTests();
});
