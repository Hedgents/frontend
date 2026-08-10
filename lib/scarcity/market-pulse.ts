import { CFTC_CONTRACT_BY_METAL_ID, type CftcMetalContract } from "./frequency-coverage";

export type PulseFreshness = "fresh" | "delayed" | "stale" | "unavailable";
export type PulseSeverity = "info" | "watch" | "material";

export interface CftcApiRow {
  cftc_contract_market_code?: string;
  commodity_name?: string;
  market_and_exchange_names?: string;
  report_date_as_yyyy_mm_dd?: string;
  open_interest_all?: string;
  change_in_open_interest_all?: string;
  pct_of_oi_prod_merc_long?: string;
  pct_of_oi_prod_merc_short?: string;
  pct_of_oi_m_money_long_all?: string;
  pct_of_oi_m_money_short_all?: string;
}

export interface WeeklyPositionPoint {
  observedAt: string;
  openInterest: number;
  openInterestChangePct: number;
  producerMerchantNetPct: number;
  managedMoneyNetPct: number;
}

export interface MarketPulseFlag {
  id: string;
  type: "producer-positioning" | "managed-money-positioning" | "open-interest-change";
  label: string;
  description: string;
  severity: PulseSeverity;
  observed: number;
  unit: "percent of open interest" | "percent week over week";
}

export interface WeeklyPositioningPulse {
  available: boolean;
  metalId: string;
  source: {
    id: "cftc-disaggregated-futures-only";
    name: string;
    url: string;
    cadence: "weekly";
    contractCode: string | null;
    market: string | null;
    settlementUse: "not-approved";
  };
  freshness: PulseFreshness;
  observedAt: string | null;
  nextExpectedAt: string | null;
  latest: WeeklyPositionPoint | null;
  history: WeeklyPositionPoint[];
  flags: MarketPulseFlag[];
  note: string;
}

const CFTC_API = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json";
const CFTC_DATASET_PAGE = "https://publicreporting.cftc.gov/Commitments-of-Traders/Disaggregated-Futures-Only/72hh-3qpy";
const DAY_MS = 86_400_000;

function finiteNumber(value: string | undefined) {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function nextFridayAfter(observedAt: string) {
  const date = new Date(observedAt);
  date.setUTCHours(19, 30, 0, 0);
  const daysUntilFriday = (5 - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilFriday);
  return date.toISOString();
}

function freshnessFor(observedAt: string, asOf: string): PulseFreshness {
  const ageDays = Math.max(0, (Date.parse(asOf) - Date.parse(observedAt)) / DAY_MS);
  if (ageDays <= 14) return "fresh";
  if (ageDays <= 28) return "delayed";
  return "stale";
}

function normalizeRow(row: CftcApiRow, contract: CftcMetalContract): WeeklyPositionPoint | null {
  if (row.cftc_contract_market_code !== contract.code) return null;
  const timestamp = Date.parse(row.report_date_as_yyyy_mm_dd ?? "");
  const openInterest = finiteNumber(row.open_interest_all);
  const change = finiteNumber(row.change_in_open_interest_all);
  const producerLong = finiteNumber(row.pct_of_oi_prod_merc_long);
  const producerShort = finiteNumber(row.pct_of_oi_prod_merc_short);
  const managedLong = finiteNumber(row.pct_of_oi_m_money_long_all);
  const managedShort = finiteNumber(row.pct_of_oi_m_money_short_all);
  if (!Number.isFinite(timestamp) || openInterest === null || openInterest <= 0 || change === null
    || producerLong === null || producerShort === null || managedLong === null || managedShort === null) return null;
  const priorOpenInterest = openInterest - change;
  if (priorOpenInterest <= 0) return null;
  return {
    observedAt: new Date(timestamp).toISOString(),
    openInterest: Math.round(openInterest),
    openInterestChangePct: round((change / priorOpenInterest) * 100),
    producerMerchantNetPct: round(producerLong - producerShort),
    managedMoneyNetPct: round(managedLong - managedShort),
  };
}

export function detectPositioningFlags(point: WeeklyPositionPoint): MarketPulseFlag[] {
  const flags: MarketPulseFlag[] = [];
  if (Math.abs(point.producerMerchantNetPct) >= 25) {
    flags.push({
      id: `producer-positioning:${point.observedAt}`,
      type: "producer-positioning",
      label: point.producerMerchantNetPct < 0 ? "Producer/merchant net short share is elevated" : "Producer/merchant net long share is elevated",
      description: "This is a participant-positioning observation, not a physical shortage claim or trading recommendation.",
      severity: Math.abs(point.producerMerchantNetPct) >= 35 ? "material" : "watch",
      observed: point.producerMerchantNetPct,
      unit: "percent of open interest",
    });
  }
  if (Math.abs(point.managedMoneyNetPct) >= 20) {
    flags.push({
      id: `managed-money-positioning:${point.observedAt}`,
      type: "managed-money-positioning",
      label: point.managedMoneyNetPct < 0 ? "Managed-money net short share is crowded" : "Managed-money net long share is crowded",
      description: "The flag identifies directional concentration among reportable managed-money positions; it does not predict price direction.",
      severity: Math.abs(point.managedMoneyNetPct) >= 30 ? "material" : "watch",
      observed: point.managedMoneyNetPct,
      unit: "percent of open interest",
    });
  }
  if (Math.abs(point.openInterestChangePct) >= 5) {
    flags.push({
      id: `open-interest-change:${point.observedAt}`,
      type: "open-interest-change",
      label: point.openInterestChangePct < 0 ? "Open interest contracted sharply" : "Open interest expanded sharply",
      description: "Week-over-week change in total reportable contract participation.",
      severity: Math.abs(point.openInterestChangePct) >= 10 ? "material" : "watch",
      observed: point.openInterestChangePct,
      unit: "percent week over week",
    });
  }
  return flags;
}

export function buildWeeklyPositioningPulse(
  metalId: string,
  rows: CftcApiRow[],
  asOf = new Date().toISOString(),
): WeeklyPositioningPulse {
  const contract = CFTC_CONTRACT_BY_METAL_ID[metalId];
  if (!contract) return unavailableWeeklyPositioningPulse(metalId, "No current CFTC disaggregated metal contract is pinned for this element.");
  const byDate = new Map<string, WeeklyPositionPoint>();
  for (const row of rows) {
    const point = normalizeRow(row, contract);
    if (point && Date.parse(point.observedAt) <= Date.parse(asOf)) byDate.set(point.observedAt, point);
  }
  const history = [...byDate.values()].sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt)).slice(-26);
  const latest = history.at(-1) ?? null;
  if (!latest) return unavailableWeeklyPositioningPulse(metalId, "The official response contained no valid observations for the pinned contract.", contract);
  return {
    available: true,
    metalId,
    source: {
      id: "cftc-disaggregated-futures-only",
      name: "CFTC Disaggregated Commitments of Traders — Futures Only",
      url: CFTC_DATASET_PAGE,
      cadence: "weekly",
      contractCode: contract.code,
      market: contract.market,
      settlementUse: "not-approved",
    },
    freshness: freshnessFor(latest.observedAt, asOf),
    observedAt: latest.observedAt,
    nextExpectedAt: nextFridayAfter(latest.observedAt),
    latest,
    history,
    flags: detectPositioningFlags(latest),
    note: "Weekly futures positioning is a market-context overlay. It is excluded from physical scarcity scores and cannot resolve a market without a separately approved specification.",
  };
}

export function unavailableWeeklyPositioningPulse(
  metalId: string,
  note: string,
  contract = CFTC_CONTRACT_BY_METAL_ID[metalId] ?? null,
): WeeklyPositioningPulse {
  return {
    available: false,
    metalId,
    source: {
      id: "cftc-disaggregated-futures-only",
      name: "CFTC Disaggregated Commitments of Traders — Futures Only",
      url: CFTC_DATASET_PAGE,
      cadence: "weekly",
      contractCode: contract?.code ?? null,
      market: contract?.market ?? null,
      settlementUse: "not-approved",
    },
    freshness: "unavailable",
    observedAt: null,
    nextExpectedAt: null,
    latest: null,
    history: [],
    flags: [],
    note,
  };
}

type PulseFetch = (input: string | URL | Request, init?: RequestInit & { next?: { revalidate?: number } }) => Promise<Response>;

export async function fetchWeeklyPositioningPulse(
  metalId: string,
  options: { fetchImpl?: PulseFetch; asOf?: string } = {},
) {
  const contract = CFTC_CONTRACT_BY_METAL_ID[metalId];
  if (!contract) return unavailableWeeklyPositioningPulse(metalId, "No current CFTC disaggregated metal contract is pinned for this element.");
  const params = new URLSearchParams({
    "$select": [
      "cftc_contract_market_code",
      "commodity_name",
      "market_and_exchange_names",
      "report_date_as_yyyy_mm_dd",
      "open_interest_all",
      "change_in_open_interest_all",
      "pct_of_oi_prod_merc_long",
      "pct_of_oi_prod_merc_short",
      "pct_of_oi_m_money_long_all",
      "pct_of_oi_m_money_short_all",
    ].join(","),
    "$where": `cftc_contract_market_code='${contract.code}'`,
    "$order": "report_date_as_yyyy_mm_dd DESC",
    "$limit": "26",
  });
  const response = await (options.fetchImpl ?? fetch)(`${CFTC_API}?${params}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 3_600 },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`CFTC pulse source returned ${response.status}.`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("CFTC pulse source returned malformed data.");
  return buildWeeklyPositioningPulse(metalId, payload as CftcApiRow[], options.asOf);
}
