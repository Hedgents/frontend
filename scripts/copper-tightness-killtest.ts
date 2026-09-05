/**
 * Copper curve-tightness kill test (SCARCITY_INDEX_SPEC.md §10), run BEFORE building
 * anything else (build order step 3: "kill test before building").
 *
 * Data: Sina public futures kline per SHFE copper delivery month (cuYYMM). Each row
 * carries {d, o, h, l, c, v(lots), p(open interest), s(settlement)}. This is a
 * RESEARCH-GRADE MIRROR of the official SHFE settlements, used only to calibrate and
 * to answer the dispersion/lead question. It is NOT a settlement source: shfe.com.cn
 * is currently behind a SafeLine bot challenge (spiked 2026-08-20), which separately
 * blocks the SHFE leg as a settlement path until resolved.
 *
 * Method: identical shape to the shipped lithium A1 index — front-to-third annualised
 * settlement slope, liquidity-gated hysteresis roll (no going backward), 5-day trailing
 * median, symmetric anchor table calibrated to copper's own observed slope range.
 *
 * Verdicts:
 *   dispersion — widest adjacent triple of the 41 buckets holds >= 90% of days → FAIL
 *                (parimutuel dead on arrival regardless of data quality).
 *   lead       — forward 5/10/20-day front-price change vs 20-day score change,
 *                non-overlapping strides, ±2 SE. Lithium failed this; a pass is a
 *                bonus, a fail is a warning label, never marketing copy.
 *
 *   npx tsx scripts/copper-tightness-killtest.ts            (fetch if needed, then test)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Metal prefix (SHFE variety), enumeration window, and analysis window are parameterized so the
// same script runs the full-history and pooled cross-metal variants:
//   METAL=cu FROM_YM=2001 WINDOW_FROM=2020-01-01 EMIT_SAMPLES=1 npx tsx scripts/copper-tightness-killtest.ts
// The Sina mirror serves contracts LISTED from 2019-01 onward; earlier contract months return
// null. Because the true front months of 2019 are therefore missing, the honest analysis window
// starts 2020-01 (when served contracts cover the real front).
const METAL = process.env.METAL ?? "cu";
const CACHE_DIR = join(process.cwd(), ".scarcity-cache", `sina-${METAL}`);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const FROM_YM = process.env.FROM_YM ?? "2109";
const TO_YM = process.env.TO_YM ?? "2612";
const WINDOW_FROM = process.env.WINDOW_FROM ?? "2022-01-01";
const WINDOW_TO = process.env.WINDOW_TO ?? "2026-08-19";
const EMIT_SAMPLES = process.env.EMIT_SAMPLES === "1";
const TRAILING_MEDIAN_DAYS = 5;
const BUCKETS = 41;

type Row = { d: string; c: string; v: string; p: string; s: string };
type Quote = { deliveryMonth: string; settlement: number; openInterest: number; volume: number };

function monthSymbols(): string[] {
  const out: string[] = [];
  let y = 2000 + Number(FROM_YM.slice(0, 2));
  let m = Number(FROM_YM.slice(2));
  const ty = 2000 + Number(TO_YM.slice(0, 2));
  const tm = Number(TO_YM.slice(2));
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${METAL}${String(y % 100).padStart(2, "0")}${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

async function fetchSymbol(symbol: string): Promise<Row[] | null> {
  const cache = join(CACHE_DIR, `${symbol}.json`);
  if (existsSync(cache)) {
    const parsed = JSON.parse(readFileSync(cache, "utf8")) as { rows: Row[] | null };
    return parsed.rows;
  }
  const url = `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20t=/InnerFuturesNewService.getDailyKLine?symbol=${symbol}`;
  const response = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://finance.sina.com.cn/" } });
  if (!response.ok) throw new Error(`${symbol}: HTTP ${response.status}`);
  const body = await response.text();
  const match = body.match(/var t=\((.*)\);?$/s);
  const rows = match ? JSON.parse(match[1]) as Row[] : null;
  const digest = createHash("sha256").update(body).digest("hex");
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cache, JSON.stringify({ symbol, url, digest, fetchedAt: new Date().toISOString(), rows }, null, 0));
  await new Promise((resolve) => setTimeout(resolve, 250));
  return rows;
}

// ── pivot: per trading day, the listed delivery months with settlement/OI/volume ──
type DailyCurve = Map<string, Quote[]>;

function pivot(bySymbol: Array<{ symbol: string; rows: Row[] | null }>): DailyCurve {
  const days: DailyCurve = new Map();
  for (const { symbol, rows } of bySymbol) {
    if (!symbol.startsWith(METAL) || !rows) continue;
    const deliveryMonth = symbol.slice(2); // YYMM
    for (const row of rows) {
      const settlement = Number(row.s);
      if (!Number.isFinite(settlement) || settlement <= 0) continue;
      const quote: Quote = {
        deliveryMonth,
        settlement,
        openInterest: Number(row.p) || 0,
        volume: Number(row.v) || 0,
      };
      const list = days.get(row.d) ?? [];
      list.push(quote);
      days.set(row.d, list);
    }
  }
  for (const [date, list] of days) {
    const seen = new Set<string>();
    days.set(date, list
      .filter((q) => { if (seen.has(q.deliveryMonth)) return false; seen.add(q.deliveryMonth); return true; })
      .sort((a, b) => a.deliveryMonth.localeCompare(b.deliveryMonth)));
  }
  return days;
}

function monthIndex(yymm: string): number {
  return Number(yymm.slice(0, 2)) * 12 + Number(yymm.slice(2)) - 1;
}

// ── the lithium roll rule: liquidity-gated hysteresis, never backward ──
function roll(fronts: string[], quotes: Quote[], entryOi: number, entryVol: number, exitOi: number, exitVol: number): string | null {
  const eligible = quotes.filter((q) => /^\d{4}$/.test(q.deliveryMonth));
  if (eligible.length === 0) return null;
  const previous = fronts.at(-1);
  const stillEligible = previous
    ? eligible.find((q) => q.deliveryMonth === previous
      && (q.openInterest > exitOi || q.volume > exitVol))
    : undefined;
  const candidates = eligible.filter((q) => q.openInterest > entryOi && q.volume > entryVol);
  const firstNew = candidates[0];
  if (stillEligible && firstNew && stillEligible.deliveryMonth < firstNew.deliveryMonth) return stillEligible.deliveryMonth;
  if (firstNew) return firstNew.deliveryMonth;
  return null;
}

function slopeFor(quotes: Quote[], front: string): number | null {
  const sorted = [...quotes].sort((a, b) => a.deliveryMonth.localeCompare(b.deliveryMonth));
  const frontIndex = sorted.findIndex((q) => q.deliveryMonth === front);
  if (frontIndex < 0) return null;
  const third = sorted[frontIndex + 2];
  if (!third) return null;
  const months = monthIndex(third.deliveryMonth) - monthIndex(front);
  if (months <= 0) return null;
  return (sorted[frontIndex].settlement / third.settlement - 1) * (365 / (months * 30.4375));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalize(slope: number, anchor: number): number {
  const anchors: Array<[number, number]> = [[-anchor, 0], [-anchor / 2, 25], [0, 50], [anchor / 2, 75], [anchor, 100]];
  if (slope <= anchors[0][0]) return 0;
  if (slope >= anchors[4][0]) return 100;
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (slope >= x0 && slope <= x1) return y0 + ((slope - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 50;
}

function correlation(a: number[], b: number[]): { r: number; n: number; z: number } | null {
  const n = a.length;
  if (n < 8) return null;
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const [ma, mb] = [mean(a), mean(b)];
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return null;
  const r = num / Math.sqrt(da * db);
  const fisher = 0.5 * Math.log((1 + r) / (1 - r));
  const se = 1 / Math.sqrt(n - 3);
  return { r, n, z: fisher / se };
}

async function main() {
  // 1. fetch
  const symbols = monthSymbols();
  const bySymbol: Array<{ symbol: string; rows: Row[] | null }> = [];
  for (const symbol of symbols) {
    const rows = await fetchSymbol(symbol);
    bySymbol.push({ symbol, rows });
  }
  const live = bySymbol.filter((s) => s.rows && s.rows.length > 0);
  process.stderr.write(`fetched ${symbols.length} symbols, ${live.length} with data\n`);

  // 2. pivot + restrict to the evaluation window
  const curves = pivot(bySymbol);
  const dates = [...curves.keys()].sort().filter((d) => d >= WINDOW_FROM && d <= WINDOW_TO);
  process.stderr.write(`${dates.length} trading days in [${WINDOW_FROM}, ${WINDOW_TO}]\n`);

  // 3. calibrate the liquidity gates on the OI/volume distribution of the first three months
  const oiSample: number[] = [];
  const volSample: number[] = [];
  for (const date of dates.slice(0, Math.min(dates.length, 250))) {
    for (const q of (curves.get(date) ?? []).slice(0, 3)) { oiSample.push(q.openInterest); volSample.push(q.volume); }
  }
  const pct = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * p)];
  process.stderr.write(`front-3 OI p10/p50: ${pct(oiSample, 0.1)} / ${pct(oiSample, 0.5)};  volume p10/p50: ${pct(volSample, 0.1)} / ${pct(volSample, 0.5)}\n`);
  const entryOi = Math.max(500, Math.floor(pct(oiSample, 0.1) * 0.5));
  const entryVol = Math.max(100, Math.floor(pct(volSample, 0.1) * 0.5));
  const exitOi = Math.floor(entryOi / 2);
  const exitVol = Math.floor(entryVol / 2);
  process.stderr.write(`gates entry {oi>${entryOi}, vol>${entryVol}} exit {oi>${exitOi}, vol>${exitVol}}\n`);

  // 4. roll + raw slopes + trailing median
  const fronts: string[] = [];
  const rowsOut: Array<{ date: string; front: string; third: string; slope: number | null; median: number | null; price: number | null }> = [];
  for (const date of dates) {
    const quotes = curves.get(date) ?? [];
    const front = roll(fronts, quotes, entryOi, entryVol, exitOi, exitVol);
    if (!front) { rowsOut.push({ date, front: "-", third: "-", slope: null, median: null, price: null }); continue; }
    fronts.push(front);
    const slope = slopeFor(quotes, front);
    const window: number[] = [];
    for (let i = rowsOut.length - 1, seen = 0; i >= 0 && seen < TRAILING_MEDIAN_DAYS; i--, seen++) {
      if (rowsOut[i].slope !== null) window.push(rowsOut[i].slope!);
    }
    if (slope !== null) window.push(slope);
    const med = window.length >= Math.ceil(TRAILING_MEDIAN_DAYS / 2) ? median(window.slice(-TRAILING_MEDIAN_DAYS)) : null;
    const price = quotes.find((q) => q.deliveryMonth === front)?.settlement ?? null;
    const sorted = [...quotes].sort((a, b) => a.deliveryMonth.localeCompare(b.deliveryMonth));
    const thirdSym = sorted[sorted.findIndex((q) => q.deliveryMonth === front) + 2]?.deliveryMonth ?? "-";
    rowsOut.push({ date, front, third: thirdSym, slope, median: med, price });
  }
  const slopes = rowsOut.map((r) => r.slope).filter((v): v is number => v !== null);
  const medians = rowsOut.map((r) => r.median).filter((v): v is number => v !== null);
  process.stderr.write(`scored ${slopes.length}/${rowsOut.length} days; raw slope min/p2/p50/p98/max: `
    + `${pct(slopes, 0).toFixed(4)} / ${pct(slopes, 0.02).toFixed(4)} / ${pct(slopes, 0.5).toFixed(4)} / ${pct(slopes, 0.98).toFixed(4)} / ${pct(slopes, 1).toFixed(4)}\n`);

  // 5. anchors from the observed range (lithium discipline: measure, don't choose)
  const anchor = Math.max(0.05, Math.ceil(Math.max(Math.abs(pct(slopes, 0.005)), Math.abs(pct(slopes, 0.995))) * 100) / 100);
  process.stderr.write(`anchor ±${anchor.toFixed(2)} (covers P0.5–P99.5)\n`);
  const scores = rowsOut.map((r) => (r.median === null ? null : normalize(r.median, anchor)));

  // 6. dispersion across 41 buckets
  const histogram = new Array(BUCKETS).fill(0);
  let scored = 0, railed = 0;
  for (const s of scores) {
    if (s === null) continue;
    scored += 1;
    const bucket = Math.min(BUCKETS - 1, Math.max(0, Math.round((s / 100) * (BUCKETS - 1))));
    histogram[bucket] += 1;
    if (s <= 0.5 || s >= 99.5) railed += 1;
  }
  let widestTriple = 0;
  for (let i = 0; i + 2 < BUCKETS; i++) {
    widestTriple = Math.max(widestTriple, histogram[i] + histogram[i + 1] + histogram[i + 2]);
  }
  const occupied = histogram.filter((h) => h > 0).length;
  const tripleShare = widestTriple / Math.max(1, scored);
  const dispersionVerdict = tripleShare >= 0.90 ? "FAIL — degenerate, do not build" : "PASS";

  // 7. lead test: forward h-day price change vs 20-day score change, non-overlapping strides
  const priceSeries = rowsOut.map((r) => r.price);
  const scoreSeries = rowsOut.map((r) => (r.median === null ? null : normalize(r.median, anchor)));
  const leadResults: Array<{ horizon: number; dir: "forward" | "backward"; r: number; n: number; z: number }> = [];
  for (const horizon of [5, 10, 20]) {
    for (const dir of ["forward", "backward"] as const) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let t = 20; t < rowsOut.length; t += horizon) {
        const s0 = scoreSeries[t - 20];
        const s1 = scoreSeries[t];
        if (s0 === null || s1 === null) continue;
        const pFrom = dir === "forward" ? priceSeries[t] : priceSeries[t - horizon];
        const pTo = dir === "forward" ? priceSeries[t + horizon] : priceSeries[t];
        if (pFrom == null || pTo == null) continue;
        xs.push(s1 - s0);
        ys.push(pTo / pFrom - 1);
      }
      const c = correlation(xs, ys);
      if (c) leadResults.push({ horizon, dir, ...c });
    }
  }

  // 8. emit paired samples for cross-metal pooling (spec test #4: "broad enough")
  if (EMIT_SAMPLES) {
    const samples = { metal: METAL, window: { from: dates[0], to: dates.at(-1) }, horizons: {} as Record<string, unknown> };
    for (const horizon of [5, 10, 20]) {
      const pairs: Array<{ t: string; dscore: number; fwd: number; bwd: number | null }> = [];
      for (let t = 20; t < rowsOut.length; t += horizon) {
        const s0 = scoreSeries[t - 20];
        const s1 = scoreSeries[t];
        if (s0 === null || s1 === null) continue;
        const p0 = priceSeries[t];
        const pf = priceSeries[t + horizon];
        const pb = priceSeries[t - horizon];
        if (p0 == null || pf == null) continue;
        pairs.push({ t: rowsOut[t].date, dscore: s1 - s0, fwd: pf / p0 - 1, bwd: pb == null ? null : p0 / pb - 1 });
      }
      samples.horizons[String(horizon)] = pairs;
    }
    const out = join(process.cwd(), ".scarcity-cache", `lead-samples-${METAL}.json`);
    writeFileSync(out, JSON.stringify(samples));
    process.stderr.write(`samples written to ${out}\n`);
  }

  // 9. report
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    metal: METAL,
    window: { from: dates[0], to: dates.at(-1), tradingDays: rowsOut.length, scoredDays: scored },
    data: "Sina public kline mirror of SHFE copper settlements — research/calibration grade only, NOT a settlement source (shfe.com.cn is behind a SafeLine bot challenge as of 2026-08-20)",
    calibration: {
      entryGate: { openInterest: entryOi, volume: entryVol },
      exitGate: { openInterest: exitOi, volume: exitVol },
      anchor: anchor,
      rawSlopePercentiles: { p2: pct(slopes, 0.02), p50: pct(slopes, 0.5), p98: pct(slopes, 0.98) },
    },
    dispersion: {
      verdict: dispersionVerdict,
      widestAdjacentTripleShare: Number(tripleShare.toFixed(4)),
      occupiedBuckets: occupied,
      railedDays: railed,
      histogram,
    },
    lead: leadResults.map((r) => ({
      horizon: r.horizon, direction: r.dir, r: Number(r.r.toFixed(3)), n: r.n,
      significant: Math.abs(r.z) >= 2, z: Number(r.z.toFixed(2)),
    })),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
