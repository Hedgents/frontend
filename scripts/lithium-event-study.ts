/**
 * Event study: does the lithium tightness score move the right way when physical supply changes?
 *
 *   npx tsx scripts/lithium-event-study.ts path/to/events.json
 *
 * This is the validation the price-lead test cannot provide, because most metals in the target
 * universe have no price at all. It asks a causal, legible question instead of a statistical one:
 * when a mine suspended or a restart landed, did the number move the way physics says it should?
 *
 * The event list must be assembled BLIND, with each direction committed before anyone looked at the
 * score, or this measures nothing. See SCARCITY_INDEX_SPEC.md.
 *
 * The null is a randomisation test, not a coin flip. The score drifts and is autocorrelated, so a
 * trending series would "confirm" a list of mostly-tightening events by accident. Placebo draws keep
 * each event's committed direction and shuffle only the dates, so the test isolates alignment.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { displayValueToNormalized, normalizedToCurveBucket } from "../lib/scarcity-curve-math";

const ROOT = process.env.SCARCITY_CACHE_DIR?.trim() || join(process.cwd(), ".scarcity-cache", "gfex-lc");
const BUCKET_COUNT = 41;
const MEDIAN_WINDOW = 5;
const MOMENTUM_WINDOW = 20;
const LIQUIDITY_MIN_OPEN_INTEREST = 5_000;
const LIQUIDITY_MIN_VOLUME = 1_000;
const WEIGHTS = { slope: 0.45, momentum: 0.35, cancellation: 0.20 };
const HORIZONS = [5, 10, 20] as const;
const PLACEBO_DRAWS = 5_000;

const ANCHORS = {
  slope: [[-0.15, 0], [-0.05, 25], [0, 50], [0.10, 80], [0.25, 100]],
  momentum: [[-0.40, 0], [-0.10, 30], [0, 50], [0.15, 80], [0.40, 100]],
  cancellation: [[0, 40], [0.02, 60], [0.08, 85], [0.20, 100]],
} as const;

interface FrozenEvent {
  date: string;
  headline: string;
  expectedDirection: "tighter" | "looser";
  tier: number;
  kind: "physical" | "exchange-mechanics";
  dateUncertaintyDays: number;
  sizeLce?: string;
  sourceUrl?: string;
}

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
      return leftScore + ((value - leftValue) / (rightValue - leftValue)) * (rightScore - leftScore);
    }
  }
  return last[1];
}

function monthsBetween(left: string, right: string) {
  const toIndex = (value: string) => (2000 + Number(value.slice(0, 2))) * 12 + Number(value.slice(2, 4)) - 1;
  return toIndex(right) - toIndex(left);
}

function curveSlope(record: DayRecord) {
  const liquid = record.curve
    .filter((row) => row.openInterest >= LIQUIDITY_MIN_OPEN_INTEREST && row.volume >= LIQUIDITY_MIN_VOLUME)
    .sort((left, right) => left.deliveryMonth.localeCompare(right.deliveryMonth));
  if (liquid.length < 3) return null;
  const months = monthsBetween(liquid[0].deliveryMonth, liquid[2].deliveryMonth);
  if (months <= 0 || liquid[0].settlement <= 0 || liquid[2].settlement <= 0) return null;
  return (liquid[0].settlement / liquid[2].settlement - 1) * (365 / (months * 30.4375));
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

/** Deterministic PRNG so a published result is reproducible from the seed alone. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildScores() {
  const days = readdirSync(ROOT)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(ROOT, name), "utf8")) as DayRecord)
    .filter((record) => record.tradingDay && record.warrants !== null);

  const rawSlope = days.map((record) => curveSlope(record));
  const rawMomentum = days.map((_, index) => {
    if (index < MOMENTUM_WINDOW) return null;
    const now = days[index].warrants!.closingTotal;
    const then = days[index - MOMENTUM_WINDOW].warrants!.closingTotal;
    return now > 0 && then > 0 ? -Math.log(now / then) : null;
  });
  const rawCancellation = days.map((_, index) => {
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

  const scores: Array<{ date: string; score: number; bucket: number }> = [];
  for (let index = 0; index < days.length; index += 1) {
    const slope = trailingMedian(rawSlope, index, MEDIAN_WINDOW);
    const momentum = trailingMedian(rawMomentum, index, MEDIAN_WINDOW);
    const cancellation = trailingMedian(rawCancellation, index, MEDIAN_WINDOW);
    if (slope === null || momentum === null || cancellation === null) continue;
    const score = normalize(slope, ANCHORS.slope) * WEIGHTS.slope
      + normalize(momentum, ANCHORS.momentum) * WEIGHTS.momentum
      + normalize(cancellation, ANCHORS.cancellation) * WEIGHTS.cancellation;
    scores.push({
      date: days[index].date,
      score,
      bucket: normalizedToCurveBucket(displayValueToNormalized(score, 0, 100), BUCKET_COUNT),
    });
  }
  return scores;
}

function main() {
  const listPath = process.argv[2];
  if (!listPath) throw new Error("Pass the frozen event list JSON path.");
  const frozen = JSON.parse(readFileSync(listPath, "utf8")) as { events: FrozenEvent[] };
  const scores = buildScores();
  const indexByDate = new Map(scores.map((entry, index) => [entry.date, index]));
  const sortedDates = scores.map((entry) => entry.date);

  /** Events land on weekends and holidays; anchor to the first trading day at or after the date. */
  function anchorIndex(isoDate: string) {
    const compact = isoDate.replace(/-/g, "");
    for (const date of sortedDates) {
      if (date >= compact) return indexByDate.get(date)!;
    }
    return null;
  }

  const usable = frozen.events
    .map((event) => ({ event, index: anchorIndex(event.date) }))
    .filter((entry): entry is { event: FrozenEvent; index: number } => entry.index !== null);

  const sign = (event: FrozenEvent) => (event.expectedDirection === "tighter" ? 1 : -1);

  function measure(entries: Array<{ event: FrozenEvent; index: number }>, horizon: number) {
    const rows = entries
      .map(({ event, index }) => {
        const target = index + horizon;
        if (target >= scores.length) return null;
        const change = scores[target].score - scores[index].score;
        const bucketChange = scores[target].bucket - scores[index].bucket;
        const priorChange = index >= 5 ? scores[index].score - scores[index - 5].score : null;
        return {
          date: event.date,
          headline: event.headline,
          expected: event.expectedDirection,
          scoreChange: Number(change.toFixed(2)),
          bucketChange,
          alignedChange: Number((sign(event) * change).toFixed(2)),
          hit: sign(event) * change > 0,
          // A move that already happened before the announcement is leakage or a mis-dated event,
          // not the index responding.
          priorFiveDayAligned: priorChange === null ? null : Number((sign(event) * priorChange).toFixed(2)),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
    if (!rows.length) return null;
    const hits = rows.filter((row) => row.hit).length;
    const meanAligned = rows.reduce((total, row) => total + row.alignedChange, 0) / rows.length;

    // Placebo: keep every committed direction, shuffle only the dates. Anything the score does on
    // its own — drift, autocorrelation, a one-sided event list — shows up identically here.
    const random = mulberry32(20260812);
    const eligible = scores.length - horizon;
    let atLeastAsExtreme = 0;
    const placeboMeans: number[] = [];
    for (let draw = 0; draw < PLACEBO_DRAWS; draw += 1) {
      let total = 0;
      for (const { event } of entries) {
        const index = Math.floor(random() * eligible);
        total += sign(event) * (scores[index + horizon].score - scores[index].score);
      }
      const mean = total / entries.length;
      placeboMeans.push(mean);
      if (mean >= meanAligned) atLeastAsExtreme += 1;
    }
    placeboMeans.sort((left, right) => left - right);

    return {
      horizonTradingDays: horizon,
      events: rows.length,
      hits,
      hitRate: Number((hits / rows.length).toFixed(3)),
      meanAlignedScoreChange: Number(meanAligned.toFixed(3)),
      placebo: {
        mean: Number((placeboMeans.reduce((total, value) => total + value, 0) / PLACEBO_DRAWS).toFixed(3)),
        p95: Number(placeboMeans[Math.floor(PLACEBO_DRAWS * 0.95)].toFixed(3)),
        oneSidedP: Number((atLeastAsExtreme / PLACEBO_DRAWS).toFixed(4)),
      },
      rows,
    };
  }

  const physical = usable.filter((entry) => entry.event.kind === "physical");
  const tierOne = physical.filter((entry) => entry.event.tier === 1);
  const mechanics = usable.filter((entry) => entry.event.kind === "exchange-mechanics");

  console.log(JSON.stringify({
    metal: "lithium-carbonate",
    scoreObservations: scores.length,
    scorePeriod: { first: scores[0]?.date, last: scores[scores.length - 1]?.date },
    eventsSupplied: frozen.events.length,
    eventsInWindow: usable.length,
    directionBalance: {
      tighter: physical.filter((entry) => entry.event.expectedDirection === "tighter").length,
      looser: physical.filter((entry) => entry.event.expectedDirection === "looser").length,
    },
    tierOnePhysical: HORIZONS.map((horizon) => measure(tierOne, horizon)).filter(Boolean),
    allPhysical: HORIZONS.map((horizon) => measure(physical, horizon)).filter(Boolean),
    // The index SHOULD move on these. That is a known weakness, not a success, so they are reported
    // separately and never counted as hits.
    exchangeMechanicsControl: mechanics.length
      ? HORIZONS.map((horizon) => measure(mechanics, horizon)).filter(Boolean)
      : "none supplied",
  }, null, 2));
}

main();
