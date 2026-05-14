export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:7700";
export const WS_BASE = API_BASE.replace(/^http/, "ws");

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
    idle_usdc: number;
  };
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
  id: "stable_yield" | "multiply" | "hedgedjlp";
  name: string;
  tagline: string;
  description: string;
  status: "live" | "idle";
  deployed_usdc: number;
  current_apr_bps: number;
  last_sig: string | null;
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

export async function fetchRates(): Promise<RatesResponse> {
  const r = await fetch(`${API_BASE}/rates`);
  if (!r.ok) throw new Error(`fetchRates ${r.status}`);
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
