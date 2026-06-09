"use client";

import { useEffect, useState } from "react";
import {
  fetchAum,
  fetchDaemons,
  fetchWallet,
  fetchRates,
  AumResponse,
  DaemonHealth,
  WalletResponse,
  RatesResponse,
} from "@/lib/api";
import { YieldBenchmarkCard } from "./YieldBenchmarkCard";
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
  const [daemons, setDaemons] = useState<DaemonHealth[]>([]);
  const [wallet, setWallet] = useState<WalletResponse | null>(null);
  const [rates, setRates] = useState<RatesResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [a, d, w, r] = await Promise.all([
          fetchAum(),
          fetchDaemons(),
          fetchWallet().catch(() => null),
          fetchRates().catch(() => null),
        ]);
        if (!cancelled) {
          setAum(a);
          setDaemons(d);
          setWallet(w);
          setRates(r);
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
  const combinedAprBps = aum?.combined_apr_bps ?? 0;
  const annualisedUsd = aum?.combined_annualised_usd ?? 0;
  const lifetimeEarned = aum?.lifetime_earned_usdc;
  const lifetimeEarnedSince = aum?.lifetime_earned_since_unix;
  const realtimePerpPnl = aum?.realtime_protocol_pnl_usdc;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-6">
          <div className="text-xs uppercase tracking-wide opacity-60">Total AUM</div>
          <div className="text-3xl font-semibold mt-1 tabular-nums">{formatUsdc(total)}</div>
          <div className="text-xs mt-1 opacity-40">on-chain positions</div>
          {realtimePerpPnl !== undefined && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <div
                className="text-xs uppercase tracking-wide opacity-60"
                title="Combined realtime protocol-native earn: hedgedjlp Jupiter Perps PnL (rc44) + stable_yield Kamino interest accrual (rc45). Zero capital-flow noise."
              >
                Pure earn (real-time)
              </div>
              <div
                className={`text-2xl font-semibold tabular-nums ${
                  realtimePerpPnl >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {realtimePerpPnl >= 0 ? "+" : ""}${realtimePerpPnl.toFixed(2)}
              </div>
              <div className="text-[10px] mt-1 opacity-50">
                Jupiter Perps PnL + Kamino interest · no flow noise
              </div>
            </div>
          )}
          {lifetimeEarned !== undefined && lifetimeEarnedSince !== undefined && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <div
                className="text-xs uppercase tracking-wide opacity-60"
                title="Current AUM minus first observed AUM. Includes operator capital flows in the delta — not pure interest accrual."
              >
                Position Δ since {new Date(lifetimeEarnedSince * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </div>
              <div
                className={`text-2xl font-semibold tabular-nums ${
                  lifetimeEarned >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {lifetimeEarned >= 0 ? "+" : ""}${lifetimeEarned.toFixed(2)}
              </div>
              <div className="text-[10px] mt-1 opacity-50">
                includes capital flows (rebalances, deposits, withdraws)
              </div>
            </div>
          )}
          {combinedAprBps > 0 && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <div className="text-xs uppercase tracking-wide opacity-60">Combined APR</div>
              <div className="text-2xl font-semibold tabular-nums text-emerald-500 dark:text-emerald-400">
                {(combinedAprBps / 100).toFixed(2)}%
              </div>
              <div className="text-xs mt-1 opacity-50 tabular-nums">
                ≈ ${annualisedUsd.toFixed(2)} / year
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-xs uppercase tracking-wide opacity-60">Allocation</div>
          {aum ? (
            <div className="text-xs mt-2 space-y-1">
              <Row label="Stable-yield" value={aum.per_strategy.stable_yield} />
              <Row label="HedgedJLP (JLP)" value={aum.per_strategy.hedgedjlp_jlp_value_usd} />
              {/* rc16: surface perp short collateral so the Allocation rows
                  sum to Total AUM. Hidden when zero to keep the panel
                  uncluttered on tiers without an open hedgedjlp position. */}
              {aum.per_strategy.hedgedjlp_collateral_usd > 0 && (
                <Row
                  label="HedgedJLP (collateral)"
                  value={aum.per_strategy.hedgedjlp_collateral_usd}
                />
              )}
              {/* v0.5.0: ONyc added as fourth strategy. Hidden when zero
                  to keep panel uncluttered on tiers without an open ONyc
                  position. */}
              {(aum.per_strategy.onyc ?? 0) > 0 && (
                <Row label="ONyc" value={aum.per_strategy.onyc ?? 0} />
              )}
              <Row label="Idle USDC" value={aum.per_strategy.idle_usdc} />
              {/* v0.4.12: surface native SOL residual. Previously
                  invisible to the dashboard's AUM; the 0.62 SOL of
                  recovered capital that hid here on 2026-06-01 is
                  what motivated the fix. */}
              {aum.per_strategy.idle_sol_usd > 0 && (
                <Row label="Idle SOL (USD)" value={aum.per_strategy.idle_sol_usd} />
              )}
            </div>
          ) : (
            <div className="text-xs mt-2 opacity-50">No data</div>
          )}
        </CardContent>
      </Card>
      <WalletCard wallet={wallet} />
      <YieldBenchmarkCard rates={rates} hedgentsAprBps={combinedAprBps} />
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
