"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  fetchStrategies,
  fetchWallet,
  StrategyCard,
  WalletResponse,
} from "@/lib/api";

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

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

function StatusBadge({ s }: { s: StrategyCard }) {
  if (s.status === "live") {
    return (
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-medium">
          Live · ${s.deployed_usdc.toFixed(2)} deployed
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full bg-neutral-400" />
      <span className="text-[10px] uppercase tracking-wide opacity-60">
        Idle · awaiting first deployment
      </span>
    </div>
  );
}

function StrategyCardView({
  s,
  cluster,
}: {
  s: StrategyCard;
  cluster: string;
}) {
  const isLive = s.status === "live";
  const aprShown = s.current_apr_bps > 0;
  return (
    <Card>
      <CardContent className="pt-6 flex flex-col h-full">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide opacity-60">{s.name}</div>
            <div className="text-[11px] opacity-50 mt-0.5 leading-snug">{s.tagline}</div>
          </div>
          <StatusBadge s={s} />
        </div>

        <div className="mt-4 flex items-baseline justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wide opacity-50">Position</div>
            <div className="text-xl font-semibold tabular-nums mt-0.5">
              {isLive ? `$${s.deployed_usdc.toFixed(2)}` : "—"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide opacity-50">APR</div>
            <div
              className={`text-xl font-semibold tabular-nums mt-0.5 ${
                isLive && aprShown ? "text-emerald-600 dark:text-emerald-400" : ""
              }`}
            >
              {aprShown ? bpsToPercent(s.current_apr_bps) : "—"}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] opacity-60 leading-relaxed">{s.description}</p>

        <div className="mt-auto pt-3 text-[10px]">
          {s.last_sig ? (
            <a
              href={solscanTx(s.last_sig, cluster)}
              target="_blank"
              rel="noreferrer"
              className="uppercase tracking-wide opacity-60 hover:opacity-100 hover:underline"
            >
              View on-chain →
            </a>
          ) : (
            <span className="uppercase tracking-wide opacity-30">No on-chain activity yet</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function StrategyCardsRow() {
  const [data, setData] = useState<StrategyCard[]>([]);
  const [wallet, setWallet] = useState<WalletResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [s, w] = await Promise.all([
          fetchStrategies().catch(() => null),
          fetchWallet().catch(() => null),
        ]);
        if (cancelled) return;
        if (s) setData(s.strategies);
        if (w) setWallet(w);
      } catch {
        // keep previous state on transient failure
      }
    };
    tick();
    const i = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  const cluster = inferCluster(wallet?.rpc_url);

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-xs uppercase tracking-wide opacity-60">Strategies</div>
          <div className="text-xs mt-2 opacity-50">Loading…</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {data.map((s) => (
        <StrategyCardView key={s.id} s={s} cluster={cluster} />
      ))}
    </div>
  );
}
