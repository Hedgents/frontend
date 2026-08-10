import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  compileMarketDocuments,
  compileVerifiedResolutionReport,
  SCARCITY_MARKET_CATALOG,
  type ResolutionReport,
} from "./scarcity-markets";

test("canonical JSON is independent of object insertion order", () => {
  assert.equal(
    canonicalJson({ z: 1, nested: { b: true, a: "x" } }),
    canonicalJson({ nested: { a: "x", b: true }, z: 1 }),
  );
});

test("the research catalog compiles one immutable market for every scarcity metal", () => {
  assert.equal(SCARCITY_MARKET_CATALOG.length, 99);
  assert.equal(new Set(SCARCITY_MARKET_CATALOG.map((market) => market.marketId)).size, 99);
  assert.equal(SCARCITY_MARKET_CATALOG.filter((market) => market.question.kind === "event").length, 91);
  for (const market of SCARCITY_MARKET_CATALOG) {
    assert.match(market.marketId, /^[a-f0-9]{64}$/);
    assert.equal(market.lifecycle, "research");
    assert.equal(market.onchain, null);
  }
});

test("compiler rejects schedules that close before they open", () => {
  const source = SCARCITY_MARKET_CATALOG[0];
  assert.throws(() => compileMarketDocuments(source.question, {
    ...source.rules,
    schedule: {
      ...source.rules.schedule,
      closesAt: "2026-09-01T00:00:00.000Z",
    },
  }), /schedule/i);
});

test("resolution compiler binds evidence to the market and calculated outcome", () => {
  const market = SCARCITY_MARKET_CATALOG[0];
  assert.notEqual(market.question.kind, "event");
  if (market.question.kind === "event") throw new Error("Expected the first catalog market to be data-based.");
  const report: ResolutionReport = {
    schemaVersion: "1.0.0",
    marketId: market.marketId,
    questionHash: market.questionHash,
    rulesHash: market.rulesHash,
    outcome: "yes",
    evaluatedValue: market.question.observation.threshold,
    evaluation: "The frozen methodology produced a value equal to the committed threshold.",
    observations: [{
      sourceId: market.question.sources[0].id,
      value: market.question.observation.threshold,
      unit: market.question.observation.unit,
      observedAt: market.question.observation.observedAt,
      publishedAt: "2027-01-01T12:00:00.000Z",
      retrievedAt: "2027-01-01T12:05:00.000Z",
      artifactHash: "ab".repeat(32),
      artifactUrl: "https://hedgents.com/evidence/example.json",
    }],
    generatedAt: "2027-01-03T00:00:00.000Z",
  };
  const compiled = compileVerifiedResolutionReport(report);
  assert.match(compiled.resolutionReportHash, /^[a-f0-9]{64}$/);
  assert.throws(() => compileVerifiedResolutionReport({ ...report, outcome: "no" }), /implies YES/);
  assert.throws(() => compileVerifiedResolutionReport({ ...report, questionHash: "00".repeat(32) }), /commitments/);
});

test("event-market resolution requires a matching qualitative outcome", () => {
  const market = SCARCITY_MARKET_CATALOG.find((entry) => entry.question.kind === "event");
  assert.ok(market);
  const report: ResolutionReport = {
    schemaVersion: "1.0.0",
    marketId: market.marketId,
    questionHash: market.questionHash,
    rulesHash: market.rulesHash,
    outcome: "yes",
    evaluatedValue: null,
    eventOutcome: "occurred",
    evaluation: "The committed primary source conclusively recorded the qualifying event.",
    observations: [{
      sourceId: market.question.sources[0].id,
      value: null,
      unit: "event",
      observedAt: market.question.kind === "event" ? market.question.event.resolvesAt : "2027-03-31T23:59:59.000Z",
      publishedAt: "2027-03-31T23:59:59.000Z",
      retrievedAt: "2027-04-01T12:05:00.000Z",
      artifactHash: "cd".repeat(32),
      artifactUrl: "https://hedgents.com/evidence/event.json",
    }],
    generatedAt: "2027-04-08T00:00:00.000Z",
  };
  assert.match(compileVerifiedResolutionReport(report).resolutionReportHash, /^[a-f0-9]{64}$/);
  assert.throws(
    () => compileVerifiedResolutionReport({ ...report, eventOutcome: "not-occurred" }),
    /implies occurred/,
  );
});

test("resolution compiler rejects uncommitted, late, or non-reproducible evidence", () => {
  const market = SCARCITY_MARKET_CATALOG[0];
  if (market.question.kind === "event") throw new Error("Expected a data market.");
  const report: ResolutionReport = {
    schemaVersion: "1.0.0",
    marketId: market.marketId,
    questionHash: market.questionHash,
    rulesHash: market.rulesHash,
    outcome: "yes",
    evaluatedValue: market.question.observation.threshold,
    evaluation: "The exact committed observation reproduces the evaluated threshold value.",
    observations: [{
      sourceId: market.question.sources[0].id,
      value: market.question.observation.threshold,
      unit: market.question.observation.unit,
      observedAt: market.question.observation.observedAt,
      publishedAt: "2027-01-01T12:00:00.000Z",
      retrievedAt: "2027-01-01T12:05:00.000Z",
      artifactHash: "ef".repeat(32),
      artifactUrl: "https://hedgents.com/api/scarcity/artifacts/" + "ef".repeat(32),
    }],
    generatedAt: "2027-01-03T00:00:00.000Z",
  };
  assert.throws(() => compileVerifiedResolutionReport({
    ...report,
    observations: [{ ...report.observations[0], sourceId: "attacker-source" }],
  }), /uncommitted source/);
  assert.throws(() => compileVerifiedResolutionReport({
    ...report,
    observations: [{ ...report.observations[0], retrievedAt: "2027-01-04T00:00:00.000Z" }],
  }), /after the report/);
  assert.throws(() => compileVerifiedResolutionReport({ ...report, evaluatedValue: report.evaluatedValue! + 1 }), /not reproduced/);
});
