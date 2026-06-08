export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:7700";
export const WS_BASE = API_BASE.replace(/^http/, "ws");

// rc21 audit L1: warn at build time (server-side render) AND at first
// client render if the bundle is shipping with the localhost fallback.
// This is the same trap that bit rc18 — `NEXT_PUBLIC_API_BASE` unset in
// CI silently bakes localhost into the production bundle. The warning
// makes the misconfiguration loud at the operator's logs and devtools.
if (
  typeof console !== "undefined" &&
  (API_BASE.includes("localhost") || API_BASE.includes("127.0.0.1"))
) {
  // eslint-disable-next-line no-console
  console.warn(
    `[Hedgents] NEXT_PUBLIC_API_BASE is "${API_BASE}". This is the local-dev fallback. ` +
      `Production builds MUST set NEXT_PUBLIC_API_BASE at build time, or every fetch ` +
      `from this bundle will target the operator's own machine.`,
  );
}

// ── Lifetime (hero banner) ──────────────────────────────────────────────────

export interface LifetimeResponse {
  /** Unix seconds. Genesis of the live mainnet reference deployment. */
  live_since_unix: number;
  /** Server time at response. Use this as the t0 for client-side counters
   *  so the displayed uptime doesn't drift from the server clock. */
  now_unix: number;
  /** Pre-computed `now_unix - live_since_unix`. */
  uptime_secs: number;
  /** Count of rc-tagged incidents documented in DEVLOG with a regression test. */
  incidents_resolved: number;
}

export async function fetchLifetime(): Promise<LifetimeResponse> {
  const r = await fetch(`${API_BASE}/lifetime`);
  if (!r.ok) throw new Error(`fetchLifetime ${r.status}`);
  return r.json();
}

export interface MeshEvent {
  id: number | null;
  ts_unix: number;
  ts_ms: number;
  sender_role: string;
  direction: "in" | "out" | "internal";
  msg_type: string;
  payload_summary: string;
  payload_json: string | null;
  conv_id: string | null;
  tx_signature: string | null;
}

export interface AumResponse {
  total_usdc: number;
  per_strategy: {
    multiply: number;
    stable_yield: number;
    hedgedjlp_jlp_value_usd: number;
    /**
     * rc16: USDC locked as Jupiter Perps short collateral. Already
     * included in `total_usdc`; broken out here for visibility.
     */
    hedgedjlp_collateral_usd: number;
    /** Idle USDC in the wallet ATA. Already included in `total_usdc`. */
    idle_usdc: number;
    /**
     * v0.4.12: native SOL in the wallet, valued at the live SOL/USD
     * mark. Pre-rc12 the dashboard's AUM silently undercounted this
     * (it only counted USDC). Already included in `total_usdc`.
     * `0` when the SOL price feed is unavailable.
     */
    idle_sol_usd: number;
    /**
     * v0.5.0: ONyc deployed equity = deposited_usd - borrowed_usd from
     * the Kamino isolated ONyc market obligation. Already included in
     * `total_usdc`. Optional because pre-v0.5.0 dashboards may not
     * emit it and the frontend should degrade gracefully on older
     * servers during a rolling upgrade.
     */
    onyc?: number;
  };
  /** v0.2.8: deployed-USD-weighted average APR across live strategies (bps). */
  combined_apr_bps?: number;
  /** v0.2.8: projected USD/year at the current combined APR + deployed USD. */
  combined_annualised_usd?: number;
  /**
   * rc43: real-time on-chain unrealised earn (whole fleet). Delta of
   * current total_usdc vs the first observed non-zero total snapshot.
   * Includes operator inflows — UI labels with "since {date}".
   */
  lifetime_earned_usdc?: number;
  /** rc43: UNIX-seconds timestamp of the first observed non-zero total AUM. */
  lifetime_earned_since_unix?: number;
  /**
   * rc44: realtime protocol-native PnL (fleet). Today this is
   * hedgedjlp's perp PnL only (Jupiter Perps API). Pure number,
   * no capital-flow noise.
   */
  realtime_protocol_pnl_usdc?: number;
}

export interface PnlResponse {
  window: "1h" | "24h" | "all";
  start_aum_usdc: number;
  end_aum_usdc: number;
  delta_usdc: number;
  percent_bps: number;
  elapsed_secs: number;
  /** Per-daemon APY averaged — correct even when daemons have different elapsed (restarts). */
  annualised_apy_pct: number;
  note?: string;
}

export interface DaemonHealth {
  role: string;
  last_heartbeat_ms_ago: number | null;
  status: "green" | "yellow" | "red" | "unknown";
}

export interface WalletResponse {
  pubkey: string;
  sol_lamports: number;
  usdc_lamports: number;
  jlp_lamports: number;
  rpc_url: string;
}

export interface PositionsResponse {
  multiply: { obligation_pubkey: string; ltv_bps: number; deposited_usd: number; borrowed_usd: number } | null;
  stable_yield: { reserve_pubkey: string; deposited_usdc: number } | null;
  hedgedjlp: { jlp_balance_lamports: number; jlp_value_usd: number; hedge_positions: unknown[] } | null;
}

export async function fetchEvents(opts?: { since?: number; limit?: number; role?: string; type?: string }): Promise<MeshEvent[]> {
  const params = new URLSearchParams();
  if (opts?.since !== undefined) params.set("since", opts.since.toString());
  if (opts?.limit !== undefined) params.set("limit", opts.limit.toString());
  if (opts?.role) params.set("role", opts.role);
  if (opts?.type) params.set("type", opts.type);
  const qs = params.toString();
  const r = await fetch(`${API_BASE}/events${qs ? `?${qs}` : ""}`);
  if (!r.ok) throw new Error(`fetchEvents ${r.status}`);
  return r.json();
}

export async function fetchAum(): Promise<AumResponse> {
  const r = await fetch(`${API_BASE}/aum`);
  if (!r.ok) throw new Error(`fetchAum ${r.status}`);
  return r.json();
}

export interface ActivityBucket {
  ts_ms: number;
  events: number;
}

export async function fetchActivity(hours = 24): Promise<ActivityBucket[]> {
  const r = await fetch(`${API_BASE}/events/activity?hours=${hours}`);
  if (!r.ok) throw new Error(`fetchActivity ${r.status}`);
  return r.json();
}

export async function fetchPnl(window: "1h" | "24h" | "all" = "24h"): Promise<PnlResponse> {
  const r = await fetch(`${API_BASE}/pnl?window=${window}`);
  if (!r.ok) throw new Error(`fetchPnl ${r.status}`);
  return r.json();
}

export async function fetchPositions(): Promise<PositionsResponse> {
  const r = await fetch(`${API_BASE}/positions`);
  if (!r.ok) throw new Error(`fetchPositions ${r.status}`);
  return r.json();
}

export async function fetchDaemons(): Promise<DaemonHealth[]> {
  const r = await fetch(`${API_BASE}/daemons`);
  if (!r.ok) throw new Error(`fetchDaemons ${r.status}`);
  return r.json();
}

export async function fetchWallet(): Promise<WalletResponse> {
  const r = await fetch(`${API_BASE}/wallet`);
  if (!r.ok) throw new Error(`fetchWallet ${r.status}`);
  return r.json();
}

export interface RatesResponse {
  kamino_usdc_supply_bps: number;
  usdy_apy_bps: number;
  effr_bps: number;
  /** BlackRock BUIDL dividend rate, bps. Static — no public live feed. */
  buidl_apy_bps: number;
  kamino_fetched_at: number;
  kamino_note: "live" | "unavailable" | "loading";
}

export interface StrategyCard {
  id: "stable_yield" | "multiply" | "hedgedjlp" | "onyc";
  name: string;
  tagline: string;
  description: string;
  status: "live" | "idle";
  /**
   * Primary deployed value. For stable_yield + multiply: live net equity.
   * For hedgedjlp: mark-to-market JLP value only. The hedge collateral
   * sitting inside Jupiter Perps short positions is reported separately
   * in `hedge_collateral_usdc` — sum the two to show the operator's
   * total capital committed to the strategy.
   */
  deployed_usdc: number;
  /**
   * rc16: USDC locked as collateral inside Jupiter Perps shorts.
   * `undefined` for strategies that don't have a separate collateral
   * surface (currently anything other than hedgedjlp). Rendered as a
   * secondary "+ $X collateral" line beneath the primary deployed
   * figure.
   */
  hedge_collateral_usdc?: number;
  current_apr_bps: number;
  /**
   * v0.4.8: trailing 24-hour mean APR (bps). Primary headline number on
   * the card; `current_apr_bps` is the secondary "live" number underneath.
   * Smooths the second-by-second jitter that made the realtime number
   * swing 0 → 1000 → 0 throughout the day. `undefined` until ~1 hour of
   * samples are available (fresh deploys / db resets).
   */
  apr_24h_bps?: number;
  /**
   * v0.4.9: gross collateral value (USD) for strategies that borrow.
   * For multiply this is the jitoSOL deposit mark-to-market. Paired
   * with `debt_usd` so the dashboard can render the decomposition
   * ("$495 collateral − $208 debt = $287 net") instead of just the
   * net figure. Undefined for stable_yield + hedgedjlp.
   */
  collateral_usd?: number;
  /**
   * v0.4.9: gross debt (USD) for strategies that borrow. For multiply
   * this is the SOL borrow principal mark-to-market.
   */
  debt_usd?: number;
  /**
   * v0.4.11: gross yield rate on the collateral leg (bps). For multiply
   * this is jitoSOL APY (~7%). Renders as "@ X% yield" next to the
   * collateral $.
   */
  collateral_apr_bps?: number;
  /**
   * v0.4.11: cost rate on the debt leg (bps). For multiply this is the
   * Kamino SOL borrow rate (~5-6%). Renders as "@ X% cost" next to the
   * debt $.
   */
  debt_apr_bps?: number;
  last_sig: string | null;
  /**
   * rc43: real-time on-chain unrealised earn since the strategy's
   * first observed non-zero position. Includes operator-funded
   * inflows in the delta — UI labels it "since {date} opened" to
   * make the framing unambiguous.
   */
  lifetime_earned_usdc?: number;
  /** rc43: UNIX-seconds timestamp of the first observed non-zero position. */
  lifetime_earned_since_unix?: number;
  /**
   * rc44: realtime protocol-native PnL for the strategy. Only set
   * for hedgedjlp today (Jupiter Perps API's pnlAfterFeesUsd summed
   * across open shorts). Includes settled funding + close fees,
   * ignores capital flows entirely — this is the cleanest "real
   * on-chain earn" number for hedgedjlp and matches Jupiter's own UI.
   */
  realtime_protocol_pnl_usdc?: number;
}

export interface StrategiesResponse {
  strategies: StrategyCard[];
}

export async function fetchStrategies(): Promise<StrategiesResponse> {
  const r = await fetch(`${API_BASE}/strategies`);
  if (!r.ok) throw new Error(`fetchStrategies ${r.status}`);
  return r.json();
}

export interface OnchainActivityItem {
  ts_ms: number;
  sender_role: string;
  msg_type: string;
  payload_summary: string;
  tx_signature: string;
}

export async function fetchOnchainActivity(limit = 20): Promise<OnchainActivityItem[]> {
  const r = await fetch(`${API_BASE}/onchain/activity?limit=${limit}`);
  if (!r.ok) throw new Error(`fetchOnchainActivity ${r.status}`);
  return r.json();
}

export interface AprSample {
  ts_ms: number;
  apr_bps: number;
}

export interface AprStats {
  min_bps: number;
  max_bps: number;
  mean_bps: number;
  p50_bps: number;
  samples_count: number;
}

export interface AprHistoryResponse {
  strategy: string;
  hours: number;
  samples: AprSample[];
  stats: AprStats;
}

export async function fetchAprHistory(
  strategy: "stable_yield" | "multiply" | "hedgedjlp" | "onyc",
  hours = 24,
): Promise<AprHistoryResponse> {
  const r = await fetch(`${API_BASE}/apr/history?strategy=${strategy}&hours=${hours}`);
  if (!r.ok) throw new Error(`fetchAprHistory ${r.status}`);
  return r.json();
}

export async function fetchRates(): Promise<RatesResponse> {
  const r = await fetch(`${API_BASE}/rates`);
  if (!r.ok) throw new Error(`fetchRates ${r.status}`);
  return r.json();
}

export interface OrchestratorDecision {
  ts_unix: number;
  mode: "dry-run" | "execute" | string;
  /** `"no_action" | "deposit" | "withdraw"`. */
  action: string;
  reason: string;
  /** `"sent" | "failed:<…>" | "skipped:<…>"` or empty. */
  envelope_result: string;
  strategy: string | null;
  amount_usd: number;
}

export async function fetchOrchestratorDecisions(
  limit = 20,
): Promise<OrchestratorDecision[]> {
  const r = await fetch(`${API_BASE}/orchestrator/decisions?limit=${limit}`);
  if (!r.ok) throw new Error(`fetchOrchestratorDecisions ${r.status}`);
  return r.json();
}

export function openEventStream(handlers: {
  onEvent: (e: MeshEvent) => void;
  onError?: (err: Event) => void;
  onClose?: () => void;
}): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    try {
      ws = new WebSocket(`${WS_BASE}/events/live`);
    } catch (err) {
      handlers.onError?.(err as Event);
      if (!closed) reconnectTimer = setTimeout(connect, 2000);
      return;
    }
    ws.onmessage = (msg) => {
      try {
        const event: MeshEvent = JSON.parse(msg.data);
        handlers.onEvent(event);
      } catch (e) {
        console.warn("malformed event frame", e);
      }
    };
    ws.onerror = (err) => handlers.onError?.(err);
    ws.onclose = () => {
      handlers.onClose?.();
      if (!closed) {
        reconnectTimer = setTimeout(connect, 2000);
      }
    };
  };
  connect();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}
