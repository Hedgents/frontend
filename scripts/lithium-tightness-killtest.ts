/**
 * The kill test from SCARCITY_INDEX_SPEC.md §10, run before any market code exists.
 *
 *   npx tsx scripts/lithium-tightness-killtest.ts
 *
 * Two questions, and a "no" to either one ends the curve product for this metal:
 *
 *   1. DISPERSION. Does the tightness score spread across the 41-bucket grid, or does it sit in a
 *      handful of adjacent buckets? A parimutuel on a near-constant subject pays out degenerately
 *      no matter how good the data is, and there is nothing to trade.
 *   2. LEAD. Does the score move BEFORE the price, or with it? A coincident score is a slower perp
 *      wearing a scarcity costume. We are not looking for a high R-squared; we are looking for a
 *      stable sign at a positive lead, and for that lead to beat the contemporaneous relationship.
 *
 * Computes A1/A2/A3 exactly as specified, so a divergence between this and production is a bug in
 * one of them rather than a difference of definition.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { curveBucketToNormalized, displayValueToNormalized, normalizedToCurveBucket } from "../lib/scarcity-curve-math";

const ROOT = process.env.SCARCITY_CACHE_DIR?.trim() || join(process.cwd(), ".scarcity-cache", "gfex-lc");
const BUCKET_COUNT = 41;
const MEDIAN_WINDOW = 5;
const MOMENTUM_WINDOW = 20;
const LIQUIDITY_MIN_OPEN_INTEREST = 5_000;
const LIQUIDITY_MIN_VOLUME = 1_000;
const WEIGHTS = { slope: 0.45, momentum: 0.35, cancellation: 0.20 };

/** Anchor tables from the spec, in raw units. Piecewise linear between breakpoints. */
const ANCHORS = {
  slope: [[-0.15, 0], [-0.05, 25], [0, 50], [0.10, 80], [0.25, 100]],
  momentum: [[-0.40, 0], [-0.10, 30], [0, 50], [0.15, 80], [0.40, 100]],
  cancellation: [[0, 40], [0.02, 60], [0.08, 85], [0.20, 100]],
} as const;

interface DayRecord {
  date: string;
  tradingDay: boolean;
  warrants: { previousTotal: number; registered: number; cancelled: number; closingTotal: number; netChange: number } | null;
  curve: Array<{ deliveryMonth: string; settlement: number; openInterest: number; volume: number }>;
}

function normalize(value: number, anchors: readonly (readonly [number, number])[]) {
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let index = 1; index < anchors.length; index += 1) {
    const [rightValue, rightScore] = anchors[index];
    const [leftValue, leftScore] = anchors[index - 1];
    if (value <= rightValue) {
      const position = (value - leftValue) / (rightValue - leftValue);
      return leftScore + position * (rightScore - leftScore);
    }
  }
  return last[1];
}

function monthsBetween(left: string, right: string) {
  const toIndex = (value: string) => (2000 + Number(value.slice(0, 2))) * 12 + Number(value.slice(2, 4)) - 1;
  return toIndex(right) - toIndex(left);
}

/** A1: annualised front-to-third slope over contracts that clear the published liquidity floor. */
function curveSlope(record: DayRecord) {
  const liquid = record.curve
    .filter((row) => row.openInterest >= LIQUIDITY_MIN_OPEN_INTEREST && row.volume >= LIQUIDITY_MIN_VOLUME)
    .sort((left, right) => left.deliveryMonth.localeCompare(right.deliveryMonth));
  if (liquid.length < 3) return null;
  const front = liquid[0];
  const third = liquid[2];
  const months = monthsBetween(front.deliveryMonth, third.deliveryMonth);
  if (months <= 0 || front.settlement <= 0 || third.settlement <= 0) return null;
  return (front.settlement / third.settlement - 1) * (365 / (months * 30.4375));
}

function trailingMedian(series: (number | null)[], index: number, window: number) {
  const slice: number[] = [];
  for (let offset = 0; offset < window && index - offset >= 0; offset += 1) {
    const value = series[index - offset];
    if (value !== null && Number.isFinite(value)) slice.push(value);
  }
  if (!slice.length) return null;
  slice.sort((left, right) => left - right);
  const middle = Math.floor(slice.length / 2);
  return slice.length % 2 ? slice[middle] : (slice[middle - 1] + slice[middle]) / 2;
}

function pearson(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 8) return null;
  const meanX = xs.reduce((total, value) => total + value, 0) / n;
  const meanY = ys.reduce((total, value) => total + value, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX === 0 || varianceY === 0) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

function main() {
  const files = readdirSync(ROOT).filter((name) => name.endsWith(".json")).sort();
  const days = files
    .map((name) => JSON.parse(readFileSync(join(ROOT, name), "utf8")) as DayRecord)
    .filter((record) => record.tradingDay && record.warrants !== null);
  if (days.length < MOMENTUM_WINDOW + MEDIAN_WINDOW + 30) {
    throw new Error(`Only ${days.length} trading days cached. Run scripts/ingest-gfex-lithium.ts first.`);
  }

  // --- raw parameter series -------------------------------------------------
  const rawSlope = days.map((record) => curveSlope(record));
  // A 20-trading-day window is indexed by array position, which is only equivalent to 20 real
  // trading days when no day is missing from the cache. A gap silently shortens the window and
  // produces a momentum reading that never happened, so require the window to span a plausible
  // number of calendar days. 20 trading days is ~28 calendar days; Chinese New Year and the
  // National Day break stretch it, so allow generous slack and reject only genuine holes.
  const MAX_WINDOW_CALENDAR_DAYS = 45;
  const asDate = (value: string) => Date.parse(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  let windowsRejected = 0;
  const rawMomentum = days.map((record, index) => {
    if (index < MOMENTUM_WINDOW) return null;
    const spanDays = (asDate(days[index].date) - asDate(days[index - MOMENTUM_WINDOW].date)) / 86_400_000;
    if (spanDays > MAX_WINDOW_CALENDAR_DAYS) {
      windowsRejected += 1;
      return null;
    }
    const now = days[index].warrants!.closingTotal;
    const then = days[index - MOMENTUM_WINDOW].warrants!.closingTotal;
    if (now <= 0 || then <= 0) return null;
    return -Math.log(now / then);
  });
  const rawCancellation = days.map((record, index) => {
    if (index < MOMENTUM_WINDOW) return null;
    let total = 0;
    let counted = 0;
    for (let offset = 0; offset < MOMENTUM_WINDOW; offset += 1) {
      const day = days[index - offset].warrants!;
      if (day.previousTotal > 0) {
        total += day.cancelled / day.previousTotal;
        counted += 1;
      }
    }
    return counted ? total / counted : null;
  });

  // --- 5-day trailing median, then normalise, then weight -------------------
  const scores: Array<{ date: string; score: number; bucket: number; slope: number; momentum: number; cancellation: number }> = [];
  for (let index = 0; index < days.length; index += 1) {
    const slope = trailingMedian(rawSlope, index, MEDIAN_WINDOW);
    const momentum = trailingMedian(rawMomentum, index, MEDIAN_WINDOW);
    const cancellation = trailingMedian(rawCancellation, index, MEDIAN_WINDOW);
    if (slope === null || momentum === null || cancellation === null) continue;
    const normalized = {
      slope: normalize(slope, ANCHORS.slope),
      momentum: normalize(momentum, ANCHORS.momentum),
      cancellation: normalize(cancellation, ANCHORS.cancellation),
    };
    const score = normalized.slope * WEIGHTS.slope
      + normalized.momentum * WEIGHTS.momentum
      + normalized.cancellation * WEIGHTS.cancellation;
    scores.push({
      date: days[index].date,
      score,
      bucket: normalizedToCurveBucket(displayValueToNormalized(score, 0, 100), BUCKET_COUNT),
      ...normalized,
    });
  }

  // --- test 1: dispersion ---------------------------------------------------
  const histogram = new Array<number>(BUCKET_COUNT).fill(0);
  for (const entry of scores) histogram[entry.bucket] += 1;
  const occupied = histogram.filter((count) => count > 0).length;
  const ranked = histogram.map((count, bucket) => ({ bucket, count })).sort((left, right) => right.count - left.count);
  const topThreeShare = (ranked[0].count + (ranked[1]?.count ?? 0) + (ranked[2]?.count ?? 0)) / scores.length;
  // Widest run of three ADJACENT buckets, which is the failure mode the spec names.
  let widestAdjacentTriple = 0;
  for (let bucket = 0; bucket + 2 < BUCKET_COUNT; bucket += 1) {
    widestAdjacentTriple = Math.max(widestAdjacentTriple, histogram[bucket] + histogram[bucket + 1] + histogram[bucket + 2]);
  }
  const adjacentTripleShare = widestAdjacentTriple / scores.length;

  // --- test 2: lead ---------------------------------------------------------
  const priceByDate = new Map<string, number>();
  for (const record of days) {
    const liquid = record.curve
      .filter((row) => row.openInterest >= LIQUIDITY_MIN_OPEN_INTEREST && row.volume >= LIQUIDITY_MIN_VOLUME)
      .sort((left, right) => left.deliveryMonth.localeCompare(right.deliveryMonth));
    if (liquid.length) priceByDate.set(record.date, liquid[0].settlement);
  }
  const dated = scores.filter((entry) => priceByDate.has(entry.date));
  interface LeadRow {
    horizon: number;
    correlation: number | null;
    sampleSize: number;
    nonOverlapping: number | null;
    independentSamples: number;
    twoStandardErrors: number | null;
  }

  // A1 is derived from prices, and backwardation predicting positive forward returns is the
  // long-documented commodity carry effect. The composite leading price therefore proves nothing
  // about the warrant data on its own. Run the identical test on each component: if the lead lives
  // entirely in `slope`, this is a known factor rather than a Hedgents edge, and the differentiated
  // inputs are unproven.
  const COMPONENTS = ["score", "slope", "momentum", "cancellation"] as const;
  const leadsByComponent: Record<string, LeadRow[]> = {};
  for (const component of COMPONENTS) {
  const leads: LeadRow[] = [];
  // Horizon -20 is the contemporaneous control: the price change over the SAME window the score
  // change was measured on. If that dominates the forward horizons, the score is a slower perp.
  for (const horizon of [-20, -10, -5, 5, 10, 20]) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let index = MOMENTUM_WINDOW; index < dated.length; index += 1) {
      const target = index + horizon;
      if (target < 0 || target >= dated.length) continue;
      const scoreChange = dated[index][component] - dated[index - MOMENTUM_WINDOW][component];
      const from = priceByDate.get(dated[horizon >= 0 ? index : target].date)!;
      const to = priceByDate.get(dated[horizon >= 0 ? target : index].date)!;
      if (!(from > 0)) continue;
      xs.push(scoreChange);
      ys.push(Math.log(to / from));
    }
    // Overlapping 20-day windows are nowhere near independent, so a correlation over ~600 of them
    // carries roughly n/20 independent observations and its apparent significance is inflated.
    // Resample every MOMENTUM_WINDOW-th point and report both, plus the phase-averaged
    // non-overlapping figure so the answer does not depend on which offset we happened to start at.
    const strideCorrelations: number[] = [];
    for (let phase = 0; phase < MOMENTUM_WINDOW; phase += 1) {
      const sx: number[] = [];
      const sy: number[] = [];
      for (let index = phase; index < xs.length; index += MOMENTUM_WINDOW) {
        sx.push(xs[index]);
        sy.push(ys[index]);
      }
      const correlation = pearson(sx, sy);
      if (correlation !== null) strideCorrelations.push(correlation);
    }
    const independentSamples = Math.floor(xs.length / MOMENTUM_WINDOW);
    const nonOverlapping = strideCorrelations.length
      ? strideCorrelations.reduce((total, value) => total + value, 0) / strideCorrelations.length
      : null;
    leads.push({
      horizon,
      correlation: pearson(xs, ys),
      sampleSize: xs.length,
      nonOverlapping,
      independentSamples,
      // Two standard errors on a correlation with `independentSamples` points. A |r| below this is
      // not distinguishable from zero, whatever the overlapping figure suggests.
      twoStandardErrors: independentSamples > 3 ? Number((2 / Math.sqrt(independentSamples - 3)).toFixed(3)) : null,
    });
  }
  leadsByComponent[component] = leads;
  }

  const peak = Math.max(...histogram);
  const bars = histogram.map((count, bucket) => {
    const width = Math.round((count / peak) * 40);
    const centre = (curveBucketToNormalized(bucket, BUCKET_COUNT) / 1_000_000 + 1) * 50;
    return `  b${String(bucket).padStart(2, "0")} ${centre.toFixed(1).padStart(5)}  `
      + `${"█".repeat(width)}${width === 0 && count ? "▏" : ""} ${count || ""}`;
  }).join("\n");

  console.log(JSON.stringify({
    metal: "lithium-carbonate",
    dimension: "market-tightness",
    source: "GFEX warrants + GFEX lithium carbonate curve",
    observations: scores.length,
    period: { first: scores[0].date, last: scores[scores.length - 1].date },
    cachedTradingDays: days.length,
    windowsRejectedForGaps: windowsRejected,
    dispersion: {
      bucketsOccupied: occupied,
      bucketCount: BUCKET_COUNT,
      topThreeBucketShare: Number(topThreeShare.toFixed(4)),
      widestAdjacentTripleShare: Number(adjacentTripleShare.toFixed(4)),
      // The spec's kill threshold: 90% of days inside three adjacent buckets means dead on arrival.
      verdict: adjacentTripleShare >= 0.90 ? "FAIL — degenerate, do not build" : "PASS",
      scoreRange: {
        minimum: Number(Math.min(...scores.map((entry) => entry.score)).toFixed(2)),
        maximum: Number(Math.max(...scores.map((entry) => entry.score)).toFixed(2)),
      },
    },
    lead: {
      note: "Correlation of the 20-day change in each component with the log price change over each "
        + "horizon. Negative horizons are backward-looking controls: if those dominate, the score "
        + "lags. `slope` is price-derived, so a lead there is the known commodity carry effect; the "
        + "differentiated claim rests on `momentum` and `cancellation`.",
      byComponent: leadsByComponent,
    },
  }, null, 2));
  console.error(`\nBucket histogram (score on 0-100, ${scores.length} trading days)\n${bars}\n`);
}

main();
