import assert from "node:assert/strict";
import test from "node:test";
import {
  PERIODIC_PIPELINE_AUDIT,
  PERIODIC_PIPELINE_AUDIT_BY_SYMBOL,
  PERIODIC_PIPELINE_AUDIT_SUMMARY,
} from "./scarcity";

test("audits every periodic-table cell and makes the material scope explicit", () => {
  assert.equal(PERIODIC_PIPELINE_AUDIT.length, 118);
  assert.equal(PERIODIC_PIPELINE_AUDIT_SUMMARY.periodicElementCount, 118);
  assert.equal(PERIODIC_PIPELINE_AUDIT_SUMMARY.trackedElementCount, 99);
  assert.equal(PERIODIC_PIPELINE_AUDIT_SUMMARY.outOfScopeCount, 19);
  assert.equal(PERIODIC_PIPELINE_AUDIT_SUMMARY.bundledAnnualCount, 50);
  assert.equal(PERIODIC_PIPELINE_AUDIT_SUMMARY.referenceOnlyCount, 18);
  assert.equal(PERIODIC_PIPELINE_AUDIT_SUMMARY.scientificOnlyCount, 31);
  assert.equal(PERIODIC_PIPELINE_AUDIT_SUMMARY.activeMarketPulseCount, 7);
  assert.equal(PERIODIC_PIPELINE_AUDIT_SUMMARY.scheduledRefreshCount, 99);
  assert.equal(PERIODIC_PIPELINE_AUDIT_SUMMARY.structuralFailureCount, 0);
  assert.equal(new Set(PERIODIC_PIPELINE_AUDIT.map((entry) => entry.atomicNumber)).size, 118);
});

test("never labels an unobserved cell as an observed pipeline", () => {
  for (const entry of PERIODIC_PIPELINE_AUDIT) {
    assert.equal(entry.structuralStatus, "pass", `${entry.symbol}: ${entry.issues.join("; ")}`);
    if (entry.referenceStage === "observed") {
      assert.ok(entry.observationCount > 0, `${entry.symbol} has an observed label without data`);
      assert.equal(entry.pipelineReadiness, "bundled-annual");
    }
    if (entry.pipelineReadiness === "bundled-annual") {
      assert.equal(entry.referenceStage, "observed");
      assert.ok(entry.observationMetricIds.length > 0);
    }
    if (entry.tracked) assert.equal(entry.scheduledRefresh, true, `${entry.symbol} has no scheduled detector source`);
  }
});

test("germanium and boron are tracked while genuine nonmetal cells remain explicitly out of scope", () => {
  assert.equal(PERIODIC_PIPELINE_AUDIT_BY_SYMBOL.ge.pipelineReadiness, "reference-only");
  assert.equal(PERIODIC_PIPELINE_AUDIT_BY_SYMBOL.b.pipelineReadiness, "reference-only");
  assert.match(PERIODIC_PIPELINE_AUDIT_BY_SYMBOL.ge.sourceUrl ?? "", /usgs\.gov/);
  assert.equal(PERIODIC_PIPELINE_AUDIT_BY_SYMBOL.h.pipelineReadiness, "out-of-scope");
  assert.equal(PERIODIC_PIPELINE_AUDIT_BY_SYMBOL.he.pipelineReadiness, "out-of-scope");
});
