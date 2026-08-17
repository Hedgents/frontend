/**
 * Seed the stored lithium series from the local backfill cache.
 *
 *   BLOB_READ_WRITE_TOKEN=... npx tsx scripts/seed-lithium-series.ts [--dry-run]
 *
 * The 2.7 years of history in `.scarcity-cache/gfex-lc/` were fetched one day at a time against an
 * exchange that publishes no archive, so re-fetching them is neither cheap nor guaranteed to
 * return the same bytes. This lifts them into storage in a single write.
 *
 * Raw response bodies are deliberately NOT uploaded here. They stay in the local cache as the
 * provenance copy for the backfilled span; the scheduled ingest writes its own raw object per day
 * from the moment it takes over.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeLithiumTightness } from "@/lib/scarcity/lithium-tightness";
import { replaceLithiumSeries } from "@/lib/scarcity/lithium-store";
import { readingFromLithiumSeries, type LithiumSeriesDay } from "@/lib/scarcity/lithium-series";
import { LITHIUM_TIGHTNESS_VERSION } from "@/lib/scarcity/lithium-tightness";

const dryRun = process.argv.includes("--dry-run");
const root = process.env.SCARCITY_CACHE_DIR?.trim() || join(process.cwd(), ".scarcity-cache", "gfex-lc");

const files = readdirSync(root).filter((name) => /^\d{8}\.json$/.test(name)).sort();
if (files.length === 0) throw new Error(`No cached GFEX days under ${root}.`);

const now = new Date();
const days: LithiumSeriesDay[] = files.map((name) => {
  const record = JSON.parse(readFileSync(join(root, name), "utf8"));
  return {
    date: record.date,
    tradingDay: Boolean(record.tradingDay),
    curve: Array.isArray(record.curve) ? record.curve : [],
    warrants: record.warrants ?? null,
    digests: record.sourceDigests ?? { warrants: "", quotes: "" },
    ingestedAt: now.toISOString(),
  };
});

const trading = days.filter((day) => day.tradingDay && day.curve.length > 0);
const points = computeLithiumTightness(trading.map((day) => ({
  date: `${day.date.slice(0, 4)}-${day.date.slice(4, 6)}-${day.date.slice(6, 8)}`,
  curve: day.curve,
})));
const scored = points.filter((point) => point.score !== null);

process.stderr.write(
  `${days.length} cached days, ${trading.length} trading days, ${scored.length} scored, `
  + `${points.length - scored.length} unscored\n`
  + `range ${points[0]?.date} -> ${points[points.length - 1]?.date}\n`
  + `methodology ${LITHIUM_TIGHTNESS_VERSION}\n`,
);

const preview = readingFromLithiumSeries(
  { version: 1, methodologyVersion: LITHIUM_TIGHTNESS_VERSION, days },
  { now },
);
process.stderr.write(
  `latest ${preview.date} score ${preview.score?.toFixed(1) ?? "null"} `
  + `(20d ${preview.change.over20TradingDays ?? "n/a"}, 60d ${preview.change.over60TradingDays ?? "n/a"}) `
  + `front ${preview.frontMonth} third ${preview.thirdMonth} staleness ${preview.coverage.stalenessDays} trading days\n`,
);

async function main() {
  if (dryRun) {
    process.stderr.write("dry run, nothing written\n");
    return;
  }
  const written = await replaceLithiumSeries(days);
  process.stderr.write(`wrote ${written} days to the stored series\n`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
