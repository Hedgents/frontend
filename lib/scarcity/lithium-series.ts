/**
 * Pure operations on the stored lithium series, split out of the store the same way index-ops is
 * split from the XP store: the part that turns exchange days into a settlement-relevant reading is
 * the part worth testing, and it should not require blob storage or a server runtime to exercise.
 */
import { gfexTradingDayCandidates, isGfexDate, type GfexWarrantTotals } from "./gfex-lithium";
import {
  computeLithiumTightness,
  LITHIUM_TIGHTNESS_VERSION,
  type CurveQuote,
  type TightnessObservation,
  type TightnessPoint,
} from "./lithium-tightness";

export const LITHIUM_SERIES_VERSION = 1;

export interface LithiumSeriesDay {
  /** YYYYMMDD, the exchange's own trade date. */
  date: string;
  tradingDay: boolean;
  curve: CurveQuote[];
  warrants: GfexWarrantTotals | null;
  digests: { warrants: string; quotes: string };
  ingestedAt: string;
}

export interface LithiumSeries {
  version: typeof LITHIUM_SERIES_VERSION;
  methodologyVersion: string;
  days: LithiumSeriesDay[];
}

export function emptyLithiumSeries(): LithiumSeries {
  return { version: LITHIUM_SERIES_VERSION, methodologyVersion: LITHIUM_TIGHTNESS_VERSION, days: [] };
}

export function validateLithiumSeries(value: unknown): LithiumSeries {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyLithiumSeries();
  const candidate = value as Partial<LithiumSeries>;
  if (candidate.version !== LITHIUM_SERIES_VERSION || !Array.isArray(candidate.days)) {
    return emptyLithiumSeries();
  }
  const days = candidate.days.filter((day): day is LithiumSeriesDay => Boolean(
    day && isGfexDate(day.date) && typeof day.tradingDay === "boolean" && Array.isArray(day.curve),
  ));
  return {
    version: LITHIUM_SERIES_VERSION,
    methodologyVersion: typeof candidate.methodologyVersion === "string"
      ? candidate.methodologyVersion
      : LITHIUM_TIGHTNESS_VERSION,
    days: [...days].sort((left, right) => left.date.localeCompare(right.date)),
  };
}

export interface LithiumTightnessReading {
  methodologyVersion: string;
  /** Null when the newest trading day could not be scored. Never filled. */
  score: number | null;
  date: string | null;
  medianSlope: number | null;
  rawSlope: number | null;
  frontMonth: string | null;
  thirdMonth: string | null;
  unavailableReason: string | null;
  /** Front and third settlements on the newest scored day, for showing the curve itself. */
  frontSettlement: number | null;
  thirdSettlement: number | null;
  warrants: GfexWarrantTotals | null;
  change: { over20TradingDays: number | null; over60TradingDays: number | null };
  observedRange: { minimum: number; maximum: number } | null;
  coverage: {
    tradingDays: number;
    scoredDays: number;
    unscoredDays: number;
    firstDate: string | null;
    latestDate: string | null;
    /** Trading days between the newest stored day and now. Non-zero means the feed is behind. */
    stalenessDays: number | null;
  };
  history: Array<{ date: string; score: number | null }>;
}

function isoDate(date: string) {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function compactDate(value: Date) {
  return value.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * The trader-facing reading.
 *
 * Leads with change rather than level, because the level alone is not actionable and the entire
 * reason to run a daily index instead of an annual one is that it moves. Staleness is reported in
 * trading days rather than hidden, since a reading computed from a feed that stopped updating is
 * the failure mode that matters most before a settlement.
 */
export function readingFromLithiumSeries(
  series: LithiumSeries,
  options: { now?: Date } = {},
): LithiumTightnessReading {
  const now = options.now ?? new Date();
  const trading = series.days.filter((day) => day.tradingDay && day.curve.length > 0);
  const observations: TightnessObservation[] = trading.map((day) => ({
    date: isoDate(day.date),
    curve: day.curve,
  }));
  const points: TightnessPoint[] = computeLithiumTightness(observations);
  const scored = points.filter((point) => point.score !== null);
  const latest = points[points.length - 1] ?? null;
  const latestScoredIndex = scored.length - 1;
  const current = scored[latestScoredIndex]?.score ?? null;
  const delta = (back: number) => {
    const past = scored[latestScoredIndex - back]?.score ?? null;
    return current !== null && past !== null && past !== undefined
      ? Number((current - past).toFixed(1))
      : null;
  };
  const latestDay = trading[trading.length - 1] ?? null;
  const latestScoredPoint = scored[latestScoredIndex] ?? null;
  const settlementOf = (month: string | null) => month === null
    ? null
    : latestDay?.curve.find((quote) => quote.deliveryMonth === month)?.settlement ?? null;
  const values = scored.map((point) => point.score as number);
  // Candidate weekdays from the newest stored day to today, minus the stored day itself. Chinese
  // public holidays inflate this slightly, which is the safe direction for a staleness warning.
  const stalenessDays = latestDay
    ? Math.max(0, gfexTradingDayCandidates(latestDay.date, compactDate(now)).length - 1)
    : null;

  return {
    methodologyVersion: series.methodologyVersion,
    score: latest?.score ?? null,
    date: latest?.date ?? null,
    medianSlope: latest?.medianSlope ?? null,
    rawSlope: latest?.rawSlope ?? null,
    frontMonth: latest?.frontMonth ?? null,
    thirdMonth: latest?.thirdMonth ?? null,
    unavailableReason: latest?.unavailableReason ?? null,
    frontSettlement: settlementOf(latestScoredPoint?.frontMonth ?? null),
    thirdSettlement: settlementOf(latestScoredPoint?.thirdMonth ?? null),
    warrants: latestDay?.warrants ?? null,
    change: { over20TradingDays: delta(20), over60TradingDays: delta(60) },
    observedRange: values.length > 0
      ? { minimum: Number(Math.min(...values).toFixed(1)), maximum: Number(Math.max(...values).toFixed(1)) }
      : null,
    coverage: {
      tradingDays: points.length,
      scoredDays: scored.length,
      unscoredDays: points.length - scored.length,
      firstDate: points[0]?.date ?? null,
      latestDate: latest?.date ?? null,
      stalenessDays,
    },
    history: points.map((point) => ({
      date: point.date,
      score: point.score === null ? null : Number(point.score.toFixed(1)),
    })),
  };
}
