import assert from "node:assert/strict";
import test from "node:test";
import { SCARCITY_MARKET_CATALOG } from "@/lib/scarcity-markets";
import { compileCurveMarket } from "@/lib/scarcity-curves";
import {
  curveBucketToNormalized,
  curveWeight,
  curveScenarioPayout,
  displayValueToNormalized,
  normalizedToCurveBucket,
  normalizedToDisplayValue,
} from "@/lib/scarcity-curve-math";

test("compiles deterministic independent scalar specs for data and event market records", () => {
  const dataMarket = SCARCITY_MARKET_CATALOG.find((market) => market.question.kind !== "event");
  const eventMarket = SCARCITY_MARKET_CATALOG.find((market) => market.question.kind === "event");
  assert(dataMarket && eventMarket);
  const first = compileCurveMarket(dataMarket);
  const second = compileCurveMarket(dataMarket);
  assert(first);
  assert.deepEqual(first, second);
  assert.match(first.marketId, /^[a-f0-9]{64}$/);
  assert.equal(first.rules.engine.bucketCount, 41);
  assert.equal(first.rules.engine.jackpotLeverageCap, 10);
  const eventCurve = compileCurveMarket(eventMarket);
  assert(eventCurve);
  assert.equal(eventCurve.metric.metric.id, "market-tightness");
  assert.equal(eventCurve.metric.metric.unit, "score-0-100");
  assert.notEqual(eventCurve.marketId, eventMarket.marketId);
  assert.notEqual(eventCurve.metricHash, eventMarket.questionHash);
  assert.match(eventCurve.rules.resolution.sourceConflictPolicy, /Metal State Oracle/);
  assert.equal(SCARCITY_MARKET_CATALOG.every((market) => Boolean(compileCurveMarket(market))), true);
});

test("maps display values and canonical buckets without floating settlement ambiguity", () => {
  assert.equal(displayValueToNormalized(0, 0, 100), -1_000_000);
  assert.equal(displayValueToNormalized(50, 0, 100), 0);
  assert.equal(displayValueToNormalized(100, 0, 100), 1_000_000);
  assert.equal(normalizedToCurveBucket(-1_000_000), 0);
  assert.equal(normalizedToCurveBucket(0), 20);
  assert.equal(normalizedToCurveBucket(1_000_000), 40);
  assert.equal(curveBucketToNormalized(20), 0);
  assert.equal(normalizedToDisplayValue(500_000, 0, 100), 75);
  assert.equal(curveWeight(20, 20), 41);
  assert.equal(curveWeight(0, 40), 1);
});

test("scenario payout mirrors the program's floored jackpot and accuracy shares", () => {
  const bucketStakes = Array.from({ length: 41 }, () => 0n);
  bucketStakes[20] = 2_000_000n;
  bucketStakes[19] = 1_000_000n;
  const exact = curveScenarioPayout({
    bucketStakes,
    positionBucket: 20,
    positionStake: 2_000_000n,
    winningBucket: 20,
    feeBps: 25,
    jackpotBps: 2_000,
    jackpotLeverageCap: 10,
  });
  assert.equal(exact.payout, 2_207_581n);
  assert.equal(exact.jackpotPool, 598_500n);
  const near = curveScenarioPayout({
    bucketStakes,
    positionBucket: 19,
    positionStake: 1_000_000n,
    winningBucket: 20,
    feeBps: 25,
    jackpotBps: 2_000,
    jackpotLeverageCap: 10,
  });
  assert.equal(near.payout, 784_918n);
});
