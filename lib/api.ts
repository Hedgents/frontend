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
  note?: string;
}

export interface DaemonHealth {
  role: string;
  last_heartbeat_ms_ago: number | null;
  status: "green" | "yellow" | "red" | "unknown";
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
