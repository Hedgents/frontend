"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  fetchOnchainActivity,
  fetchWallet,
  OnchainActivityItem,
  WalletResponse,
} from "@/lib/api";

function inferCluster(rpcUrl: string | undefined): string {
  if (!rpcUrl) return "mainnet";
  const u = rpcUrl.toLowerCase();
  if (u.includes("devnet")) return "devnet";
  if (u.includes("testnet")) return "testnet";
  if (u.includes("127.0.0.1") || u.includes("localhost")) return "localnet";
  return "mainnet";
}

function solscanTx(sig: string, cluster: string): string {
  return cluster === "mainnet"
    ? `https://solscan.io/tx/${sig}`
    : `https://solscan.io/tx/${sig}?cluster=${cluster}`;
}

function relative(tsMs: number, nowMs: number): string {
  const ago = Math.max(0, nowMs - tsMs);
  const s = Math.floor(ago / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function shortSig(sig: string): string {
  return `${sig.slice(0, 6)}…${sig.slice(-4)}`;
}

function prettyRole(role: string): string {
  return role.replace(/_/g, "-");
}

export function OnchainActivityRail() {
  const [items, setItems] = useState<OnchainActivityItem[]>([]);
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [a, w] = await Promise.all([
          fetchOnchainActivity(20).catch(() => [] as OnchainActivityItem[]),
          fetchWallet().catch(() => null),
        ]);
        if (cancelled) return;
        setItems(a);
        if (w) setWallet(w);
        setLoaded(true);
      } catch {
        // ignore
      }
    };
    tick();
    const i = setInterval(tick, 10000);
    const clock = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(i);
      clearInterval(clock);
    };
  }, []);

  const cluster = inferCluster(wallet?.rpc_url);

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-60">
              On-chain activity
            </div>
            <div className="text-[11px] opacity-50 mt-0.5">
              Confirmed fleet transactions, newest first
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-wide opacity-40">
            {items.length} {items.length === 1 ? "event" : "events"}
          </span>
        </div>

        {!loaded ? (
          <div className="text-xs opacity-50">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-xs opacity-50 py-4 text-center">
            No on-chain activity yet
          </div>
        ) : (
          <ul className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {items.map((e, idx) => (
              <li
                key={`${e.tx_signature}-${idx}`}
                className="flex items-start justify-between gap-3 text-xs border-b border-neutral-200/40 dark:border-neutral-700/40 pb-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{prettyRole(e.sender_role)}</span>
                    <span className="opacity-50 text-[10px] uppercase tracking-wide">
                      {e.msg_type}
                    </span>
                  </div>
                  <div className="opacity-60 truncate">{e.payload_summary}</div>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  <span className="opacity-50 text-[10px] tabular-nums">
                    {relative(e.ts_ms, nowMs)}
                  </span>
                  <a
                    href={solscanTx(e.tx_signature, cluster)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-mono opacity-60 hover:opacity-100 hover:underline"
                    title={e.tx_signature}
                  >
                    {shortSig(e.tx_signature)} ↗
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
