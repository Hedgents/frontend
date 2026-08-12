import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  compileLithiumRound,
  isLithiumRoundSlug,
  LITHIUM_ROUNDS,
  lithiumRoundWindow,
} from "./lithium-market";
import { LITHIUM_TIGHTNESS_VERSION } from "./lithium-tightness";

test("a round's commitments match what was created on chain", () => {
  // The devnet market is immutable, so a change to any committed field breaks this and should:
  // the deployed market can never be repaired, only superseded.
  const deployment = JSON.parse(readFileSync(
    join(process.cwd(), ".scarcity-cache", "devnet-deployment.json"), "utf8",
  )) as { curveMarkets: Record<string, { marketId: string; metricHash: string; rulesHash: string }> };
  for (const [slug, onChain] of Object.entries(deployment.curveMarkets)) {
    const window = lithiumRoundWindow(slug);
    assert.ok(window, `no declared round for ${slug}`);
    const compiled = compileLithiumRound(window);
    assert.equal(compiled.slug, slug);
    assert.equal(compiled.marketId, onChain.marketId, `${slug} marketId drifted`);
    assert.equal(compiled.metricHash, onChain.metricHash, `${slug} metricHash drifted`);
    assert.equal(compiled.rulesHash, onChain.rulesHash, `${slug} rulesHash drifted`);
  }
});

test("the round commits to the lithium methodology, not the general scarcity one", () => {
  const compiled = compileLithiumRound(LITHIUM_ROUNDS["2026-09"]);
  assert.equal(compiled.metric.metric.methodologyVersion, LITHIUM_TIGHTNESS_VERSION);
  // The catalog's hardcoded "0.1.0" is the defect this exists to avoid repeating.
  assert.notEqual(compiled.metric.metric.methodologyVersion, "0.1.0");
});

test("the metric document carries the whole calculation, so a stranger can recompute the settling value", () => {
  const { metric } = compileLithiumRound(LITHIUM_ROUNDS["2026-09"]);
  assert.match(metric.calculation.formula, /S_front \/ S_third/);
  assert.ok(metric.calculation.trailingMedianTradingDays > 0);
  assert.ok(metric.calculation.anchors.length >= 3);
  assert.ok(metric.calculation.contractSelection.entry.openInterest
    > metric.calculation.contractSelection.exit.openInterest, "hysteresis must widen, not narrow");
  // Anchors must be monotonic or the score inverts somewhere in the middle of the range.
  for (let index = 1; index < metric.calculation.anchors.length; index += 1) {
    assert.ok(metric.calculation.anchors[index].value > metric.calculation.anchors[index - 1].value);
    assert.ok(metric.calculation.anchors[index].score > metric.calculation.anchors[index - 1].score);
  }
  assert.equal(metric.sources.length, 1);
  assert.match(metric.sources[0].url, /gfex\.com\.cn/);
});

test("the rules state the two promises a parimutuel cannot make after the fact", () => {
  const { rules } = compileLithiumRound(LITHIUM_ROUNDS["2026-09"]);
  assert.equal(rules.schedule.stakeLocksBeforeObservationWindow, true);
  assert.ok(rules.resolution.correctionWindowHours > 0);
  assert.match(rules.resolution.restatementPolicy, /never restated/);
  assert.ok(rules.schedule.minimumTenorTradingDays >= 20, "below 20 trading days the outcome is forecastable");
});

test("every declared round locks stake strictly before its observation date", () => {
  for (const [round, window] of Object.entries(LITHIUM_ROUNDS)) {
    assert.equal(window.round, round);
    const opens = Date.parse(window.opensAt);
    const closes = Date.parse(window.closesAt);
    const observed = Date.parse(window.observedAt);
    const resolve = Date.parse(window.resolveAfter);
    assert.ok(opens < closes, `${round}: opens before it closes`);
    // No part of the trailing median window may be visible at close, or the last days of trading
    // are arithmetic rather than forecasting.
    assert.ok(closes < observed, `${round}: stake must lock before the observation date`);
    assert.ok(observed <= resolve, `${round}: cannot resolve before the observation`);
    assert.ok((closes - opens) / 86_400_000 >= 26, `${round}: tenor is under twenty trading days`);
  }
});

test("only well-formed lithium round slugs resolve", () => {
  assert.ok(isLithiumRoundSlug("lithium-tightness-2026-09-curve-v1"));
  assert.ok(!isLithiumRoundSlug("lithium-tightness-2026-09"));
  assert.ok(!isLithiumRoundSlug("gold-tightness-2026-09-curve-v1"));
  assert.ok(!isLithiumRoundSlug("lithium-tightness-2026-9-curve-v1"));
  // A well-formed slug for an undeclared round must not fabricate a window.
  assert.equal(lithiumRoundWindow("lithium-tightness-2099-01-curve-v1"), null);
});
