import "server-only";
import { get, put } from "@vercel/blob";
import { ApiSecurityError } from "@/lib/api-security";
import {
  fetchGfexDay,
  gfexTradingDayCandidates,
  type GfexDayRecord,
} from "./gfex-lithium";
import { LITHIUM_TIGHTNESS_VERSION, TRAILING_MEDIAN_DAYS } from "./lithium-tightness";
import {
  emptyLithiumSeries,
  LITHIUM_SERIES_VERSION,
  readingFromLithiumSeries,
  validateLithiumSeries,
  type LithiumSeries,
  type LithiumSeriesDay,
} from "./lithium-series";

/**
 * Durable storage for the GFEX lithium series.
 *
 * Two shapes, deliberately. Each exchange day is written once to its own object WITH the raw
 * response bodies, because GFEX keeps no archive and those bodies are the only later proof of what
 * the source said on a settlement date. The compact series carries everything the index needs and
 * none of the raw text, so serving a reading is one read rather than seven hundred.
 *
 * A day is never refetched once stored. The exchange restating a day it already published would be
 * a correction, which is an operator decision under the round's stated correction policy, not
 * something an unattended cron should silently absorb.
 */
const SERIES_PATH = "scarcity/gfex-lc/series.json";
const rawPath = (date: string) => `scarcity/gfex-lc/raw/${date}.json`;

/** Self-healing window. A cron that only ever fetched yesterday would leave a permanent hole after
 * any single failed run, and holes in the median window turn into null scores at settlement. */
export const INGEST_LOOKBACK_DAYS = 12;
const globalLithiumState = globalThis as typeof globalThis & { __hedgentsLithiumSeries?: LithiumSeries };

export function lithiumStorageConfigured() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

async function readSeries(): Promise<{ series: LithiumSeries; etag: string | null }> {
  if (!lithiumStorageConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new ApiSecurityError("Lithium series storage is not configured.", 503);
    }
    globalLithiumState.__hedgentsLithiumSeries ??= emptyLithiumSeries();
    return { series: structuredClone(globalLithiumState.__hedgentsLithiumSeries), etag: null };
  }
  try {
    const result = await get(SERIES_PATH, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return { series: emptyLithiumSeries(), etag: null };
    const value = await new Response(result.stream).json().catch(() => null);
    const series = validateLithiumSeries(value);
    // Unlike the XP index, an unreadable series is recoverable: every day is reconstructible from
    // its own raw object, and worst case from the exchange. So this refuses the WRITE rather than
    // the read, by returning no etag, which makes the next put fail its overwrite check instead of
    // replacing a populated series with an empty one.
    if (series.days.length === 0 && value !== null) {
      throw new ApiSecurityError(
        "The stored lithium series could not be read. Refusing to overwrite it; rebuild from the raw day objects.",
        503,
      );
    }
    return { series, etag: result.blob.etag };
  } catch (error) {
    if (error instanceof ApiSecurityError) throw error;
    throw new ApiSecurityError("Lithium series storage is temporarily unavailable.", 503);
  }
}

async function writeSeries(series: LithiumSeries, etag: string | null) {
  if (!lithiumStorageConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new ApiSecurityError("Lithium series storage is not configured.", 503);
    }
    globalLithiumState.__hedgentsLithiumSeries = structuredClone(series);
    return;
  }
  await put(SERIES_PATH, JSON.stringify(series), {
    access: "private",
    contentType: "application/json",
    cacheControlMaxAge: 0,
    addRandomSuffix: false,
    allowOverwrite: Boolean(etag),
    ...(etag ? { ifMatch: etag } : {}),
  });
}

async function writeRawDay(record: GfexDayRecord) {
  if (!lithiumStorageConfigured()) return;
  try {
    await put(rawPath(record.date), JSON.stringify(record), {
      access: "private",
      contentType: "application/json",
      cacheControlMaxAge: 0,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  } catch {
    // Already stored. A day is written once and never restated, so this is the expected outcome on
    // any re-run and must not fail the ingest.
  }
}

function toSeriesDay(record: GfexDayRecord, now: Date): LithiumSeriesDay {
  return {
    date: record.date,
    tradingDay: record.tradingDay,
    curve: record.curve,
    warrants: record.warrants,
    digests: record.sourceDigests,
    ingestedAt: now.toISOString(),
  };
}

export interface LithiumIngestReport {
  checked: string[];
  fetched: string[];
  skippedAlreadyStored: string[];
  nonTradingDays: string[];
  failed: Array<{ date: string; reason: string }>;
  latestTradingDay: string | null;
  totalTradingDays: number;
}

/**
 * Fetch every candidate day in the trailing window that is not already stored.
 *
 * A single day failing does not fail the run. The exchange is reachable only over plain HTTP from a
 * network that may be far away, and one refused request should not stop the other eleven days from
 * closing their holes.
 */
export async function ingestLithiumDays(options: { now?: Date; lookbackDays?: number } = {}) {
  const now = options.now ?? new Date();
  const lookback = options.lookbackDays ?? INGEST_LOOKBACK_DAYS;
  const end = now.toISOString().slice(0, 10).replace(/-/g, "");
  const startDate = new Date(now.getTime() - lookback * 86_400_000);
  const start = startDate.toISOString().slice(0, 10).replace(/-/g, "");

  const { series, etag } = await readSeries();
  const stored = new Set(series.days.map((day) => day.date));
  const candidates = gfexTradingDayCandidates(start, end);

  const report: LithiumIngestReport = {
    checked: candidates,
    fetched: [],
    skippedAlreadyStored: [],
    nonTradingDays: [],
    failed: [],
    latestTradingDay: null,
    totalTradingDays: 0,
  };

  const added: LithiumSeriesDay[] = [];
  for (const date of candidates) {
    if (stored.has(date)) {
      report.skippedAlreadyStored.push(date);
      continue;
    }
    try {
      const record = await fetchGfexDay(date);
      await writeRawDay(record);
      added.push(toSeriesDay(record, now));
      report.fetched.push(date);
      if (!record.tradingDay) report.nonTradingDays.push(date);
    } catch (error) {
      report.failed.push({ date, reason: error instanceof Error ? error.message : "unknown error" });
    }
  }

  if (added.length > 0) {
    series.days = [...series.days, ...added].sort((left, right) => left.date.localeCompare(right.date));
    series.methodologyVersion = LITHIUM_TIGHTNESS_VERSION;
    await writeSeries(series, etag);
  }

  const trading = series.days.filter((day) => day.tradingDay);
  report.totalTradingDays = trading.length;
  report.latestTradingDay = trading.length > 0 ? trading[trading.length - 1].date : null;
  return report;
}

/** Replace the whole series in one write. Used by the backfill to seed storage from local cache. */
export async function replaceLithiumSeries(days: LithiumSeriesDay[]) {
  const { etag } = await readSeries().catch(() => ({ etag: null }));
  const series: LithiumSeries = {
    version: LITHIUM_SERIES_VERSION,
    methodologyVersion: LITHIUM_TIGHTNESS_VERSION,
    days: [...days].sort((left, right) => left.date.localeCompare(right.date)),
  };
  await writeSeries(series, etag);
  return series.days.length;
}

export async function readLithiumTightness(options: { now?: Date } = {}) {
  const { series } = await readSeries();
  return readingFromLithiumSeries(series, options);
}

export { TRAILING_MEDIAN_DAYS };
