import assert from "node:assert/strict";
import test from "node:test";
import {
  ONLINE_DETECTOR_COVERAGE,
  candidateFromEvidence,
  evidenceFromRecord,
  inferSignalDirection,
  matchMetalTerms,
  mergeDetectorEvidence,
  signalsFromEvidence,
} from "./scarcity/online-detector";

function record(overrides: Partial<Parameters<typeof evidenceFromRecord>[0]> = {}) {
  return {
    sourceId: "official:test",
    sourceKind: "official-feed" as const,
    publisher: "Test authority",
    title: "Proposed rule on germanium export controls",
    summary: "The authority is requesting comment on a possible restriction.",
    url: "https://authority.example.test/document/1",
    category: "policy" as const,
    publishedAt: "2026-08-09T00:00:00.000Z",
    retrievedAt: "2026-08-09T01:00:00.000Z",
    authority: "official-index" as const,
    artifactHash: "a".repeat(64),
    artifactPath: `/api/scarcity/detector/artifacts/${"a".repeat(64)}`,
    recordType: "Proposed Rule",
    ...overrides,
  };
}

test("registers scheduled online coverage for every tracked material cell", () => {
  assert.equal(ONLINE_DETECTOR_COVERAGE.scheduledMetalCount, 99);
  assert.ok(ONLINE_DETECTOR_COVERAGE.referenceSourceCount >= 10);
  assert.equal(ONLINE_DETECTOR_COVERAGE.discoverySourceCount, 3);
});

test("matches named metals without treating short chemical symbols as prose matches", () => {
  const matches = matchMetalTerms("A new germanium metal project and aluminium refinery were announced.");
  assert.ok(matches.some((match) => match.metalId === "germanium"));
  assert.ok(matches.some((match) => match.metalId === "aluminium"));
  assert.equal(matchMetalTerms("In the report, we lead with a result.").some((match) => match.metalId === "indium"), false);
});

test("quarantines online evidence and compiles proposed-rule research candidates", () => {
  const evidence = evidenceFromRecord(record());
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].status, "quarantined");
  assert.deepEqual(evidence[0].metalIds, ["germanium"]);
  assert.equal(evidence[0].direction, "tightening");
  const signals = signalsFromEvidence(evidence[0]);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].publication, "quarantined");
  const candidates = candidateFromEvidence(evidence[0], evidence[0].recordType ?? undefined);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].readiness, "quarantined");
  assert.match(candidates[0].question, /final action explicitly addressing Germanium/);
});

test("deduplicates identical immutable evidence and classifies directional language", () => {
  const evidence = evidenceFromRecord(record())[0];
  const merged = mergeDetectorEvidence([evidence], [evidence]);
  assert.equal(merged.evidence.length, 1);
  assert.equal(merged.deduplicated, 1);
  assert.equal(inferSignalDirection("A mine shutdown caused a supply shortage"), "tightening");
  assert.equal(inferSignalDirection("New capacity was commissioned after permit approval"), "loosening");
  assert.equal(inferSignalDirection("The report discussed market conditions"), "neutral");
});
