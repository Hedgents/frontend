/**
 * Zero-cost backfill of the two GFEX series the lithium tightness dimension is built from.
 *
 *   npx tsx scripts/ingest-gfex-lithium.ts [startYYYYMMDD] [endYYYYMMDD]
 *
 * Both endpoints are unauthenticated and free, but they have a transport quirk worth stating
 * plainly: HTTPS returns an obfuscated anti-bot challenge no matter what headers you send, so the
 * requests must go over plain HTTP with a browser user agent. Nothing secret travels either way.
 *
 * Every response body is stored verbatim with its SHA-256, because the settlement series must be
 * reconstructible later and GFEX publishes no archive. Once a day is stored it is never refetched.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WARRANT_URL = "http://www.gfex.com.cn/u/interfacesWebTdWbillWeeklyQuotes/loadList";
const QUOTE_URL = "http://www.gfex.com.cn/u/interfacesWebTiDayQuotes/loadList";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const VARIETY = "lc";
const ROOT = process.env.SCARCITY_CACHE_DIR?.trim() || join(process.cwd(), ".scarcity-cache", "gfex-lc");
const REQUEST_INTERVAL_MS = 350;

const startArgument = process.argv[2] ?? "20231201";
const endArgument = process.argv[3] ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");
if (!/^\d{8}$/.test(startArgument) || !/^\d{8}$/.test(endArgument)) {
  throw new Error("Pass dates as YYYYMMDD.");
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function tradingDays(start: string, end: string) {
  const days: string[] = [];
  const cursor = new Date(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T00:00:00Z`);
  const last = new Date(`${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}T00:00:00Z`);
  while (cursor <= last) {
    const weekday = cursor.getUTCDay();
    // Weekends are never trading days. Chinese public holidays are not filtered here; the endpoint
    // simply returns an empty data array for them, which is recorded as a non-trading day.
    if (weekday !== 0 && weekday !== 6) days.push(cursor.toISOString().slice(0, 10).replace(/-/g, ""));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

async function post(url: string, body: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": USER_AGENT,
        },
        body,
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`GFEX returned ${response.status}.`);
      return await response.text();
    } catch (error) {
      if (attempt === 3) throw error;
      await wait(900 * (attempt + 1));
    }
  }
  throw new Error("unreachable");
}

interface WarrantRow { variety: string; varietyOrder: string; lastWbillQty: number; regWbillQty: number; logoutWbillQty: number; wbillQty: number; diff: number }
interface QuoteRow { variety: string; delivMonth: string; clearPrice: number | null; openInterest: number; volumn: number }

/** The per-variety subtotal row, which is the one carrying the exchange-wide warrant total. */
function warrantSubtotal(payload: string) {
  const parsed = JSON.parse(payload) as { data?: WarrantRow[] };
  const rows = parsed.data ?? [];
  const subtotal = rows.find((row) => row.varietyOrder === VARIETY && row.variety.endsWith("小计"));
  if (!subtotal) return null;
  return {
    previousTotal: subtotal.lastWbillQty,
    registered: subtotal.regWbillQty,
    cancelled: subtotal.logoutWbillQty,
    closingTotal: subtotal.wbillQty,
    netChange: subtotal.diff,
  };
}

function quoteCurve(payload: string) {
  const parsed = JSON.parse(payload) as { data?: QuoteRow[] };
  const rows = (parsed.data ?? []).filter((row) => /^\d{4}$/.test(row.delivMonth) && row.clearPrice !== null);
  return rows.map((row) => ({
    deliveryMonth: row.delivMonth,
    settlement: Number(row.clearPrice),
    openInterest: Number(row.openInterest ?? 0),
    volume: Number(row.volumn ?? 0),
  }));
}

async function main() {
  mkdirSync(ROOT, { recursive: true });
  const stored = new Set(readdirSync(ROOT).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, 8)));
  const days = tradingDays(startArgument, endArgument).filter((day) => !stored.has(day));
  process.stderr.write(`${stored.size} days already cached, fetching ${days.length}\n`);

  let fetched = 0;
  let empty = 0;
  for (const day of days) {
    const warrantBody = await post(WARRANT_URL, `gen_date=${day}&variety=`);
    await wait(REQUEST_INTERVAL_MS);
    const quoteBody = await post(QUOTE_URL, `trade_date=${day}&variety=${VARIETY}&trade_type=0`);

    const warrants = warrantSubtotal(warrantBody);
    const curve = quoteCurve(quoteBody);
    const tradingDay = warrants !== null || curve.length > 0;
    if (!tradingDay) empty += 1;

    writeFileSync(join(ROOT, `${day}.json`), JSON.stringify({
      date: day,
      tradingDay,
      warrants,
      curve,
      // The exchange keeps no archive, so the raw bodies and their digests are the only way to
      // prove later what the source actually said on the day a market settled.
      sourceDigests: {
        warrants: createHash("sha256").update(warrantBody).digest("hex"),
        quotes: createHash("sha256").update(quoteBody).digest("hex"),
      },
      raw: { warrants: warrantBody, quotes: quoteBody },
    }));

    fetched += 1;
    if (fetched % 25 === 0) process.stderr.write(`  ${fetched}/${days.length} (${empty} non-trading)\n`);
    await wait(REQUEST_INTERVAL_MS);
  }

  const all = readdirSync(ROOT).filter((name) => name.endsWith(".json")).sort();
  const trading = all.filter((name) => {
    const record = JSON.parse(readFileSync(join(ROOT, name), "utf8")) as { tradingDay: boolean };
    return record.tradingDay;
  });
  process.stderr.write(`done: ${all.length} days stored, ${trading.length} trading days\n`);
  console.log(JSON.stringify({
    cacheDirectory: ROOT,
    daysStored: all.length,
    tradingDays: trading.length,
    first: trading[0]?.slice(0, 8) ?? null,
    last: trading[trading.length - 1]?.slice(0, 8) ?? null,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
