"use client";

import { useEffect, useState } from "react";
import {
  fetchAum,
  fetchPnl,
  fetchDaemons,
  fetchWallet,
  AumResponse,
  PnlResponse,
  DaemonHealth,
  WalletResponse,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { DaemonPill } from "./DaemonPill";
import { formatUsdc } from "@/lib/decode";

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="opacity-60">{label}</span>
      <span className="tabular-nums">{formatUsdc(value)}</span>
    </div>
  );
}

function truncatePubkey(pk: string): string {
  if (pk.length <= 12) return pk;
  return `${pk.slice(0, 6)}…${pk.slice(-4)}`;
}

function inferCluster(rpcUrl: string): "mainnet" | "devnet" | "testnet" | "localnet" | "unknown" {
  const u = rpcUrl.toLowerCase();
  if (u.includes("mainnet")) return "mainnet";
  if (u.includes("devnet")) return "devnet";
  if (u.includes("testnet")) return "testnet";
  if (u.includes("127.0.0.1") || u.includes("localhost")) return "localnet";
  return "unknown";
}

function WalletCard({ wallet }: { wallet: WalletResponse | null }) {
  const [copied, setCopied] = useState(false);

  if (!wallet) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-xs uppercase tracking-wide opacity-60">Wallet</div>
          <div className="text-xs mt-2 opacity-50">No data</div>
        </CardContent>
      </Card>
    );
  }

  const sol = wallet.sol_lamports / 1_000_000_000;
  const usdc = wallet.usdc_lamports / 1_000_000;
  const jlp = wallet.jlp_lamports / 1_000_000;
  const cluster = inferCluster(wallet.rpc_url);
  const solscanCluster = cluster === "mainnet" ? "" : `?cluster=${cluster === "unknown" ? "devnet" : cluster}`;
  const solscanUrl = `https://solscan.io/account/${wallet.pubkey}${solscanCluster}`;
  const needsFunding = wallet.sol_lamports === 0;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.pubkey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard may be blocked in non-https origins; ignore
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide opacity-60">Wallet</div>
          <div className="text-[10px] uppercase tracking-wide opacity-60">{cluster}</div>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="mt-1 font-mono text-sm hover:underline tabular-nums"
          title={`Click to copy: ${wallet.pubkey}`}
        >
          {truncatePubkey(wallet.pubkey)}
          {copied ? <span className="ml-2 text-[10px] opacity-60">copied</span> : null}
        </button>
        <div className="text-xs mt-2 space-y-1">
          <div className="flex justify-between gap-4">
            <span className="opacity-60">SOL</span>
            <span className="tabular-nums">{sol.toFixed(4)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="opacity-60">USDC</span>
            <span className="tabular-nums">{usdc.toFixed(2)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="opacity-60">JLP</span>
            <span className="tabular-nums">{jlp.toFixed(4)}</span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <a
            href={solscanUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] uppercase tracking-wide opacity-60 hover:opacity-100 hover:underline"
          >
            Solscan ↗
          </a>
        </div>
        {needsFunding ? (
          <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
            ⚠ Fund this wallet to enable trading
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function NumbersPanel() {
  const [aum, setAum] = useState<AumResponse | null>(null);
  const [pnl, setPnl] = useState<PnlResponse | null>(null);
  const [daemons, setDaemons] = useState<DaemonHealth[]>([]);
  const [wallet, setWallet] = useState<WalletResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [a, p, d, w] = await Promise.all([
          fetchAum(),
          fetchPnl("24h"),
          fetchDaemons(),
          // /wallet may 404 against an old running dashboard binary;
          // swallow that so the rest of the panel still renders.
          fetchWallet().catch(() => null),
        ]);
        if (!cancelled) {
          setAum(a);
          setPnl(p);
          setDaemons(d);
          setWallet(w);
        }
      } catch {
        // dashboard server unreachable; keep previous state
      }
    };
    tick();
    const i = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  const total = aum?.total_usdc ?? 0;
  const pnlDelta = pnl?.delta_usdc ?? 0;
  const pnlPct = pnl?.percent_bps ?? 0;
  const pnlColor = pnlDelta > 0 ? "text-emerald-600" : pnlDelta < 0 ? "text-red-600" : "opacity-60";

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-6">
          <div className="text-xs uppercase tracking-wide opacity-60">Total AUM</div>
          <div className="text-3xl font-semibold mt-1 tabular-nums">{formatUsdc(total)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-xs uppercase tracking-wide opacity-60">24h P&amp;L</div>
          <div className={`text-3xl font-semibold mt-1 tabular-nums ${pnlColor}`}>
            {pnlDelta >= 0 ? "+" : ""}
            {formatUsdc(pnlDelta)}
          </div>
          <div className={`text-xs mt-1 ${pnlColor}`}>{(pnlPct / 100).toFixed(2)}%</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-xs uppercase tracking-wide opacity-60">Allocation</div>
          {aum ? (
            <div className="text-xs mt-2 space-y-1">
              <Row label="Multiply" value={aum.per_strategy.multiply} />
              <Row label="Stable-yield" value={aum.per_strategy.stable_yield} />
              <Row label="HedgedJLP" value={aum.per_strategy.hedgedjlp_jlp_value_usd} />
              <Row label="Idle USDC" value={aum.per_strategy.idle_usdc} />
            </div>
          ) : (
            <div className="text-xs mt-2 opacity-50">No data</div>
          )}
        </CardContent>
      </Card>
      <WalletCard wallet={wallet} />
      <Card className="md:col-span-4">
        <CardContent className="pt-6">
          <div className="text-xs uppercase tracking-wide opacity-60 mb-2">Fleet health</div>
          {daemons.length === 0 ? (
            <div className="text-xs opacity-50">No daemons reporting</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {daemons.map((d) => (
                <DaemonPill key={d.role} daemon={d} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
