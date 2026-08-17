import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyLithiumSeries,
  readingFromLithiumSeries,
  validateLithiumSeries,
  type LithiumSeries,
  type LithiumSeriesDay,
} from "./lithium-series";
import { LITHIUM_TIGHTNESS_VERSION, type CurveQuote } from "./lithium-tightness";

const LIQUID = { openInterest: 200_000, volume: 100_000 };

function curve(frontSettlement: number, thirdSettlement: number): CurveQuote[] {
  return [
    { deliveryMonth: "2609", settlement: frontSettlement, ...LIQUID },
    { deliveryMonth: "2610", settlement: (frontSettlement + thirdSettlement) / 2, ...LIQUID },
    { deliveryMonth: "2611", settlement: thirdSettlement, ...LIQUID },
  ];
}

function day(date: string, overrides: Partial<LithiumSeriesDay> = {}): LithiumSeriesDay {
  return {
    date,
    tradingDay: true,
    curve: curve(150_000, 150_000),
    warrants: null,
    digests: { warrants: "w", quotes: "q" },
    ingestedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

function seriesOf(days: LithiumSeriesDay[]): LithiumSeries {
  return { version: 1, methodologyVersion: LITHIUM_TIGHTNESS_VERSION, days };
}

test("an empty series reports nothing rather than a neutral score", () => {
  const reading = readingFromLithiumSeries(emptyLithiumSeries(), { now: new Date("2026-08-17T00:00:00Z") });
  assert.equal(reading.score, null);
  assert.equal(reading.observedRange, null);
  assert.equal(reading.coverage.tradingDays, 0);
  assert.equal(reading.coverage.stalenessDays, null);
  assert.deepEqual(reading.change, { over20TradingDays: null, over60TradingDays: null });
});

test("non-trading days and empty curves never enter the calculation", () => {
  const days = [
    day("20260803"),
    day("20260804", { tradingDay: false, curve: [] }),
    day("20260805", { curve: [] }),
    day("20260806"),
  ];
  const reading = readingFromLithiumSeries(seriesOf(days), { now: new Date("2026-08-06T00:00:00Z") });
  assert.equal(reading.coverage.tradingDays, 2, "only the two days with a real curve are scored");
});

test("a flat curve scores the neutral 50, and backwardation scores above it", () => {
  const flat = Array.from({ length: 6 }, (_, index) => day(`2026080${index + 3}`));
  const flatReading = readingFromLithiumSeries(seriesOf(flat), { now: new Date("2026-08-10T00:00:00Z") });
  assert.equal(flatReading.score, 50);

  const backwardated = flat.map((entry) => ({ ...entry, curve: curve(153_000, 150_000) }));
  const tightReading = readingFromLithiumSeries(seriesOf(backwardated), { now: new Date("2026-08-10T00:00:00Z") });
  assert.ok(tightReading.score !== null && tightReading.score > 50, "front above deferred is tighter");
});

test("the reading reports change over the trailing windows, not just the level", () => {
  // A hundred days: flat for the first twenty, then steadily backwardating, so both trailing
  // windows sit inside the move. The first two days score null on the trailing-median warmup, which
  // is why the series has to be comfortably longer than the widest window it is asked about.
  const days: LithiumSeriesDay[] = [];
  for (let index = 0; index < 100; index += 1) {
    const date = new Date(Date.UTC(2026, 0, 1) + index * 86_400_000 * 3);
    const front = index < 20 ? 150_000 : 150_000 + (index - 20) * 20;
    days.push(day(date.toISOString().slice(0, 10).replace(/-/g, ""), { curve: curve(front, 150_000) }));
  }
  const reading = readingFromLithiumSeries(seriesOf(days), { now: new Date("2026-08-17T00:00:00Z") });
  assert.ok(reading.change.over20TradingDays !== null && reading.change.over20TradingDays > 0);
  assert.ok(reading.change.over60TradingDays !== null && reading.change.over60TradingDays > 0);
  assert.ok(
    reading.change.over60TradingDays >= reading.change.over20TradingDays,
    "the longer window spans more of the move",
  );
});

test("staleness is reported in trading days so a stopped feed is visible", () => {
  const reading = readingFromLithiumSeries(
    seriesOf([day("20260810"), day("20260811"), day("20260812")]),
    { now: new Date("2026-08-17T00:00:00Z") },
  );
  // 13th, 14th and 17th are candidate weekdays after the newest stored day; the weekend is not.
  assert.equal(reading.coverage.stalenessDays, 3);
});

test("an unscorable newest day surfaces its reason instead of a filled number", () => {
  const reading = readingFromLithiumSeries(
    seriesOf([day("20260810"), day("20260811")]),
    { now: new Date("2026-08-11T00:00:00Z") },
  );
  assert.equal(reading.score, null);
  assert.equal(reading.unavailableReason, "insufficient history for the trailing median");
  assert.equal(reading.coverage.unscoredDays, 2);
});

test("validation drops malformed days without discarding the series", () => {
  const series = validateLithiumSeries({
    version: 1,
    methodologyVersion: LITHIUM_TIGHTNESS_VERSION,
    days: [day("20260812"), { date: "nope", tradingDay: true, curve: [] }, null],
  });
  assert.equal(series.days.length, 1);
  assert.equal(series.days[0].date, "20260812");
});

test("a series of the wrong version is refused entirely rather than half-read", () => {
  const series = validateLithiumSeries({ version: 99, days: [day("20260812")] });
  assert.equal(series.days.length, 0);
});

test("days are ordered by date regardless of stored order", () => {
  const series = validateLithiumSeries({
    version: 1,
    methodologyVersion: LITHIUM_TIGHTNESS_VERSION,
    days: [day("20260812"), day("20260810"), day("20260811")],
  });
  assert.deepEqual(series.days.map((entry) => entry.date), ["20260810", "20260811", "20260812"]);
});
