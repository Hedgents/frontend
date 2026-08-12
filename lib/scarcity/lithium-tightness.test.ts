import assert from "node:assert/strict";
import test from "node:test";
import {
  annualisedCurveSlope,
  computeLithiumTightness,
  normalizeCurveSlope,
  type CurveQuote,
} from "./lithium-tightness";

function quote(deliveryMonth: string, settlement: number, openInterest = 50_000, volume = 10_000): CurveQuote {
  return { deliveryMonth, settlement, openInterest, volume };
}

test("a flat curve is the neutral midpoint and the anchors are symmetric around it", () => {
  assert.equal(normalizeCurveSlope(0), 50);
  assert.equal(normalizeCurveSlope(0.15), 75);
  assert.equal(normalizeCurveSlope(-0.15), 25);
  // Symmetric: equal and opposite slopes sit equal distances from the midpoint.
  for (const value of [0.02, 0.09, 0.21, 0.29]) {
    assert.ok(Math.abs((normalizeCurveSlope(value) - 50) + (normalizeCurveSlope(-value) - 50)) < 1e-9);
  }
});

test("the score is bounded and rails only outside the observed 2.7-year range", () => {
  assert.equal(normalizeCurveSlope(5), 100);
  assert.equal(normalizeCurveSlope(-5), 0);
  // The sample ran -0.345 to +0.332, so the extremes are reachable but rarely touched.
  assert.ok(normalizeCurveSlope(0.332) === 100);
  assert.ok(normalizeCurveSlope(0.29) < 100 && normalizeCurveSlope(0.29) > 95);
});

test("backwardation reads tight and contango reads loose", () => {
  const backwardated = annualisedCurveSlope(
    [quote("2609", 150_000), quote("2610", 148_000), quote("2611", 146_000)], null,
  );
  const contango = annualisedCurveSlope(
    [quote("2609", 146_000), quote("2610", 148_000), quote("2611", 150_000)], null,
  );
  assert.ok(backwardated.slope !== null && backwardated.slope > 0);
  assert.ok(contango.slope !== null && contango.slope < 0);
  assert.ok(normalizeCurveSlope(backwardated.slope!) > 50);
  assert.ok(normalizeCurveSlope(contango.slope!) < 50);
});

test("an illiquid nearer contract is skipped rather than used as the front", () => {
  // The real 2026-08-11 shape: the listed front had zero volume and 3,265 open interest while the
  // actually-traded front was the next month. Using the stale print would misstate the slope.
  const resolved = annualisedCurveSlope([
    quote("2608", 144_720, 3_265, 0),
    quote("2609", 145_380, 254_682, 118_649),
    quote("2610", 144_900, 21_184, 2_944),
    quote("2611", 144_620, 88_921, 15_160),
  ], null);
  assert.equal(resolved.front, "2609");
  assert.equal(resolved.third, "2611");
});

test("hysteresis stops the front contract flipping backward when a threshold is grazed", () => {
  const curve = [
    // 2609 is held as front and sits between the exit and entry gates, so it keeps the designation.
    quote("2609", 145_000, 3_000, 800),
    quote("2610", 144_000, 90_000, 20_000),
    quote("2611", 143_000, 80_000, 18_000),
    quote("2612", 142_000, 70_000, 16_000),
  ];
  assert.equal(annualisedCurveSlope(curve, "2609").front, "2609");
  // With no incumbent it would fail the entry gate and 2610 becomes front instead.
  assert.equal(annualisedCurveSlope(curve, null).front, "2610");
  // And once the series has rolled forward it never returns to an earlier delivery month.
  assert.equal(annualisedCurveSlope(curve, "2610").front, "2610");
});

test("an unscoreable day reports why instead of inventing a value", () => {
  const thin = [quote("2609", 145_000, 100, 10), quote("2610", 144_000, 100, 10)];
  const points = computeLithiumTightness([
    { date: "20260803", curve: thin },
    { date: "20260804", curve: thin },
    { date: "20260805", curve: thin },
    { date: "20260806", curve: thin },
    { date: "20260807", curve: thin },
  ]);
  for (const point of points) {
    assert.equal(point.score, null);
    assert.equal(point.rawSlope, null);
    assert.match(point.unavailableReason ?? "", /liquid contracts|insufficient history/);
  }
});

test("the trailing median blunts a single-day spike", () => {
  const steady = [quote("2609", 145_000), quote("2610", 145_000), quote("2611", 145_000)];
  const spike = [quote("2609", 175_000), quote("2610", 145_000), quote("2611", 145_000)];
  const points = computeLithiumTightness([
    { date: "20260803", curve: steady },
    { date: "20260804", curve: steady },
    { date: "20260805", curve: steady },
    { date: "20260806", curve: steady },
    { date: "20260807", curve: spike },
  ]);
  const final = points[points.length - 1];
  // The raw slope jumps hard on the spike day; the median the score uses does not follow it.
  assert.ok(final.rawSlope !== null && final.rawSlope > 1);
  assert.equal(final.medianSlope, 0);
  assert.equal(final.score, 50);
});
