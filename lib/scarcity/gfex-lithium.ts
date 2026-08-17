import { createHash } from "node:crypto";
import type { CurveQuote } from "./lithium-tightness";

/**
 * Fetching and parsing the two GFEX lithium carbonate series.
 *
 * Extracted from the backfill script so the scheduled ingest and the manual backfill share ONE
 * implementation. Two parsers reading the same exchange payload is exactly the seam where a
 * settlement series quietly diverges from the history it was calibrated on.
 *
 * Transport quirk, unchanged from the backfill: HTTPS returns an obfuscated anti-bot challenge no
 * matter what headers are sent, so requests go over plain HTTP with a browser user agent. Nothing
 * secret travels in either direction, and the response digest is what establishes authenticity.
 */
export const GFEX_WARRANT_URL = "http://www.gfex.com.cn/u/interfacesWebTdWbillWeeklyQuotes/loadList";
export const GFEX_QUOTE_URL = "http://www.gfex.com.cn/u/interfacesWebTiDayQuotes/loadList";
export const GFEX_VARIETY = "lc";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface GfexWarrantTotals {
  previousTotal: number;
  registered: number;
  cancelled: number;
  closingTotal: number;
  netChange: number;
}

export interface GfexDayRecord {
  /** YYYYMMDD, the exchange's own trade date. */
  date: string;
  tradingDay: boolean;
  warrants: GfexWarrantTotals | null;
  curve: CurveQuote[];
  sourceDigests: { warrants: string; quotes: string };
  raw: { warrants: string; quotes: string };
}

interface WarrantRow {
  variety: string;
  varietyOrder: string;
  lastWbillQty: number;
  regWbillQty: number;
  logoutWbillQty: number;
  wbillQty: number;
  diff: number;
}

interface QuoteRow {
  variety: string;
  delivMonth: string;
  clearPrice: number | null;
  openInterest: number;
  volumn: number;
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function isGfexDate(value: string) {
  return /^\d{8}$/.test(value);
}

/** Weekends are never trading days. Chinese public holidays are not filtered; the endpoint returns
 * an empty data array for them, which is recorded as a non-trading day rather than guessed at. */
export function gfexTradingDayCandidates(startDate: string, endDate: string) {
  if (!isGfexDate(startDate) || !isGfexDate(endDate)) throw new Error("Pass dates as YYYYMMDD.");
  const days: string[] = [];
  const cursor = new Date(`${startDate.slice(0, 4)}-${startDate.slice(4, 6)}-${startDate.slice(6, 8)}T00:00:00Z`);
  const last = new Date(`${endDate.slice(0, 4)}-${endDate.slice(4, 6)}-${endDate.slice(6, 8)}T00:00:00Z`);
  while (cursor <= last) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(cursor.toISOString().slice(0, 10).replace(/-/g, ""));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

async function post(url: string, body: string, attempts = 4) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
        body,
        signal: AbortSignal.timeout(25_000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`GFEX returned ${response.status}.`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await wait(900 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("GFEX request failed.");
}

/** The per-variety subtotal row, which is the one carrying the exchange-wide warrant total. */
export function parseWarrantSubtotal(payload: string): GfexWarrantTotals | null {
  const parsed = JSON.parse(payload) as { data?: WarrantRow[] };
  const rows = parsed.data ?? [];
  const subtotal = rows.find((row) => row.varietyOrder === GFEX_VARIETY && row.variety.endsWith("小计"));
  if (!subtotal) return null;
  return {
    previousTotal: subtotal.lastWbillQty,
    registered: subtotal.regWbillQty,
    cancelled: subtotal.logoutWbillQty,
    closingTotal: subtotal.wbillQty,
    netChange: subtotal.diff,
  };
}

export function parseQuoteCurve(payload: string): CurveQuote[] {
  const parsed = JSON.parse(payload) as { data?: QuoteRow[] };
  return (parsed.data ?? [])
    .filter((row) => /^\d{4}$/.test(row.delivMonth) && row.clearPrice !== null)
    .map((row) => ({
      deliveryMonth: row.delivMonth,
      settlement: Number(row.clearPrice),
      openInterest: Number(row.openInterest ?? 0),
      volume: Number(row.volumn ?? 0),
    }));
}

/**
 * Fetch one exchange day. The raw bodies and their digests are kept because GFEX publishes no
 * archive: they are the only way to prove later what the source actually said on the day a market
 * settled.
 */
export async function fetchGfexDay(date: string): Promise<GfexDayRecord> {
  if (!isGfexDate(date)) throw new Error("Pass the date as YYYYMMDD.");
  const warrantBody = await post(GFEX_WARRANT_URL, `gen_date=${date}&variety=`);
  const quoteBody = await post(GFEX_QUOTE_URL, `trade_date=${date}&variety=${GFEX_VARIETY}&trade_type=0`);
  const warrants = parseWarrantSubtotal(warrantBody);
  const curve = parseQuoteCurve(quoteBody);
  return {
    date,
    tradingDay: warrants !== null || curve.length > 0,
    warrants,
    curve,
    sourceDigests: {
      warrants: createHash("sha256").update(warrantBody).digest("hex"),
      quotes: createHash("sha256").update(quoteBody).digest("hex"),
    },
    raw: { warrants: warrantBody, quotes: quoteBody },
  };
}
