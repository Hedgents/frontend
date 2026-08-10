import assert from "node:assert/strict";
import test from "node:test";
import { GET as getMetalDetail } from "../app/api/scarcity/metals/[symbol]/route";
import { GET as getMetalHistory } from "../app/api/scarcity/metals/[symbol]/history/route";
import { GET as listMetals } from "../app/api/scarcity/metals/route";
import { GET as listCandidates } from "../app/api/scarcity/markets/candidates/route";
import { GET as listMarkets } from "../app/api/scarcity/markets/route";
import { GET as listSignals } from "../app/api/scarcity/signals/route";
import {
  ACCESS_ATTESTATION_HEADER,
  createAccessAttestation,
  createAccessSession,
  readAccessSession,
} from "./access-auth";
import { resetRateLimitsForTests } from "./api-security";
import { SCARCITY_METALS, USGS_BASELINE_COVERAGE } from "./scarcity";

function authorizedRequest(path: string) {
  const session = createAccessSession("beta", 60);
  const claims = readAccessSession(session, "beta");
  assert.ok(claims);
  const pathname = new URL(`http://localhost${path}`).pathname;
  return new Request(`http://localhost${path}`, {
    headers: {
      cookie: `hedgents_beta=${encodeURIComponent(session)}`,
      [ACCESS_ATTESTATION_HEADER]: createAccessAttestation(claims, "GET", pathname),
    },
  });
}

test.beforeEach(() => resetRateLimitsForTests());

test("scarcity API requires beta access", async () => {
  const response = await listMetals(new Request("http://localhost/api/scarcity/metals"));
  assert.equal(response.status, 401);
});

test("scarcity API lists the explicitly requested sample dataset", async () => {
  const response = await listMetals(authorizedRequest(
    "/api/scarcity/metals?dataset=sample&asOf=2026-08-08T00%3A00%3A00.000Z",
  ));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.dataset.kind, "sample");
  assert.equal(payload.count, SCARCITY_METALS.length);
  assert.equal(payload.coverage.partial, 8);
  assert.equal(payload.coverage.uncovered, SCARCITY_METALS.length - 8);
  assert.equal(payload.metals.some((entry: { metal: { symbol: string } }) => entry.metal.symbol === "Cu"), true);
});

test("scarcity API serves the bundled USGS production baseline by default", async () => {
  const response = await listMetals(authorizedRequest(
    "/api/scarcity/metals?asOf=2026-08-08T00%3A00%3A00.000Z",
  ));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.dataset.kind, "production");
  assert.equal(payload.sourceCoverage.observationCount, USGS_BASELINE_COVERAGE.observationCount);
  assert.equal(payload.sourceCoverage.observedMetalCount, USGS_BASELINE_COVERAGE.coveredMetalCount);
  assert.equal(payload.sourceCoverage.direct, 36);
  assert.equal(payload.sourceCoverage.group, 14);
  assert.equal(payload.frequencyCoverage.realtimeMetalCount, 4);
  assert.equal(payload.frequencyCoverage.weeklyMetalCount, 7);
  assert.equal(payload.frequencyCoverage.activeMetalCount, 7);
  assert.equal(payload.referenceCoverage.mapped, SCARCITY_METALS.length);
  assert.equal(payload.referenceCoverage.unmapped, 0);
  assert.equal(payload.referenceCoverage.observed, 50);
  assert.equal(payload.referenceCoverage.proxy, 18);
  assert.equal(payload.referenceCoverage.scientific, 31);
  assert.equal(payload.pipelineCoverage.periodicElementCount, 118);
  assert.equal(payload.pipelineCoverage.trackedElementCount, 99);
  assert.equal(payload.pipelineCoverage.bundledAnnualCount, 50);
  assert.equal(payload.pipelineCoverage.referenceOnlyCount, 18);
  assert.equal(payload.pipelineCoverage.scientificOnlyCount, 31);
  assert.equal(payload.pipelineCoverage.structuralFailureCount, 0);
  assert.equal(payload.marketNamespaceCoverage.mapped, 99);
  assert.equal(payload.marketNamespaceCoverage.eventEligible, 99);
  assert.equal(payload.coverage.partial, 50);
  assert.equal(payload.metals.find((entry: { metal: { symbol: string } }) => entry.metal.symbol === "La").metal.dataMode, "group");
  assert.equal(payload.metals.find((entry: { metal: { symbol: string } }) => entry.metal.symbol === "Cu").frequency.highestActiveCadence, "weekly");
  assert.equal(payload.metals.find((entry: { metal: { symbol: string } }) => entry.metal.symbol === "Tc").metal.marketStatus, "non-commercial");
  assert.equal(payload.metals.find((entry: { metal: { symbol: string } }) => entry.metal.symbol === "Ca").reference.relationship, "application");
  assert.equal(payload.metals.find((entry: { metal: { symbol: string } }) => entry.metal.symbol === "Ge").pipeline.pipelineReadiness, "reference-only");
  assert.equal(payload.metals.find((entry: { metal: { symbol: string } }) => entry.metal.symbol === "Tc").marketNamespace.primaryPath, "event");
});

test("scarcity API returns detailed metric provenance for one metal", async () => {
  const response = await getMetalDetail(
    authorizedRequest(
      "/api/scarcity/metals/Cu?dataset=sample&asOf=2026-08-08T00%3A00%3A00.000Z",
    ),
    { params: Promise.resolve({ symbol: "Cu" }) },
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.metal.id, "copper");
  assert.equal(payload.marketTightness.metrics.length, 5);
  assert.equal(payload.structuralScarcity.metrics.length, 6);
  assert.equal(payload.marketTightness.metrics[0].sources[0].kind, "sample");
  assert.equal(payload.state.coverageStatus, "partial");
  assert.equal(payload.reference.coverageStage, "observed");
  assert.ok(payload.signals.length > 0);
  assert.equal(payload.candidates.every((candidate: { readiness: string }) => candidate.readiness === "paper-ready"), true);
});

test("scarcity API exposes immutable history, objective signals, and gated candidates", async () => {
  const [historyResponse, signalResponse, candidateResponse] = await Promise.all([
    getMetalHistory(
      authorizedRequest("/api/scarcity/metals/Cu/history?dataset=sample&asOf=2026-08-08T00%3A00%3A00.000Z"),
      { params: Promise.resolve({ symbol: "Cu" }) },
    ),
    listSignals(authorizedRequest("/api/scarcity/signals?dataset=sample&metal=Cu&status=active&asOf=2026-08-08T00%3A00%3A00.000Z")),
    listCandidates(authorizedRequest("/api/scarcity/markets/candidates?dataset=sample&metal=Cu")),
  ]);
  assert.equal(historyResponse.status, 200);
  assert.equal(signalResponse.status, 200);
  assert.equal(candidateResponse.status, 200);
  const history = await historyResponse.json();
  const signals = await signalResponse.json();
  const candidates = await candidateResponse.json();
  assert.equal(history.count, 1);
  assert.ok(signals.count > 0);
  assert.ok(candidates.count > 0);
  assert.equal(candidates.candidates.every((candidate: { readiness: string }) => candidate.readiness === "paper-ready"), true);
});

test("scarcity market API exposes research specs without pretending they are live", async () => {
  const response = await listMarkets(authorizedRequest("/api/scarcity/markets"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.count, 99);
  assert.equal(payload.markets.every((market: { lifecycle: string }) => market.lifecycle === "research"), true);
  assert.equal(payload.markets.every((market: { onchain: unknown }) => market.onchain === null), true);
});
