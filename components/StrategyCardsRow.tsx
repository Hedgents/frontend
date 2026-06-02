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
    // For hedgedjlp, "deployed" the operator cares about is JLP value +
    // perp short collateral. Show the sum in the badge so the headline
    // matches the on-chain capital actually committed.
    const total =
      s.deployed_usdc + (s.hedge_collateral_usdc ?? 0);
    return (
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-medium">
          Live · ${total.toFixed(2)} deployed
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
  // v0.4.8: prefer the trailing 24h mean as the headline APR. It's
  // backend-smoothed against the second-by-second noise that made the
  // realtime number swing 0 → 1000 → 0 throughout the day. The realtime
  // figure is still shown beneath as "live: X%" for transparency.
  const headlineApr = s.apr_24h_bps ?? s.current_apr_bps;
  const aprShown = headlineApr > 0;
  const showRealtimeSecondary =
    s.apr_24h_bps !== undefined &&
    s.current_apr_bps > 0 &&
    s.current_apr_bps !== s.apr_24h_bps;
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
            {/* rc16: hedgedjlp's perp-short collateral lives outside the
                wallet ATA and outside the JLP value surface. Show it as a
                secondary line so operators can see total committed capital
                without thinking the wallet leaked money into "nowhere". */}
            {isLive &&
              s.hedge_collateral_usdc !== undefined &&
              s.hedge_collateral_usdc > 0 && (
                <div className="text-[10px] opacity-60 tabular-nums mt-0.5">
                  + ${s.hedge_collateral_usdc.toFixed(2)} collateral
                </div>
              )}
            {/* v0.4.9: collateral / debt decomposition for strategies that
                borrow (multiply today). Lets the operator see that "$287
                net" is actually "$495 collateral − $208 debt" and answers
                the recurring "what is this number made of?" question. */}
            {isLive &&
              s.collateral_usd !== undefined &&
              s.debt_usd !== undefined &&
              s.collateral_usd > 0 && (
                <div
                  className="text-[10px] opacity-60 tabular-nums mt-0.5"
                  title="Gross collateral minus gross debt equals the net position shown above. Move with the underlying asset prices."
                >
                  ${s.collateral_usd.toFixed(2)} collateral − $
                  {s.debt_usd.toFixed(2)} debt
                </div>
              )}
          </div>
          <div className="text-right">
            <div
              className="text-[10px] uppercase tracking-wide opacity-50"
              title={
                s.apr_24h_bps !== undefined
                  ? "Trailing 24-hour mean APR. Smoothed against second-by-second noise; the realtime number is shown below."
                  : "Live APR. Trailing average will appear once ~1 hour of samples is collected."
              }
            >
              APR{s.apr_24h_bps !== undefined ? " · 24h" : ""}
            </div>
            <div
              className={`text-xl font-semibold tabular-nums mt-0.5 ${
                isLive && aprShown ? "text-emerald-600 dark:text-emerald-400" : ""
              }`}
            >
              {aprShown ? bpsToPercent(headlineApr) : "—"}
            </div>
            {showRealtimeSecondary && (
              <div
                className="text-[10px] opacity-60 tabular-nums mt-0.5"
                title="Realtime APR — the live tick. Swings throughout the day; the trailing 24h figure above is the more honest number."
              >
                live: {bpsToPercent(s.current_apr_bps)}
              </div>
            )}
          </div>
        </div>

        {/* rc44 + rc45: prefer realtime protocol-native PnL when
            available. hedgedjlp = Jupiter Perps API; stable_yield =
            Kamino exchange-rate accrual. Falls back to rc43's
            position-delta otherwise so the framing is unambiguous. */}
        {isLive && s.realtime_protocol_pnl_usdc !== undefined ? (
          <div className="mt-3 pt-3 border-t border-white/5 flex items-baseline justify-between">
            <div
              className="text-[10px] uppercase tracking-wide opacity-50"
              title={
                s.id === "hedgedjlp"
                  ? "Sum of pnlAfterFeesUsd across open Jupiter Perps shorts. Includes settled funding and close fees."
                  : s.id === "stable_yield"
                  ? "Pure Kamino interest accrual: current cToken balance × (current exchange rate − baseline rate). Anchored from the first observed snapshot; grows as the reserve's index moves."
                  : "Real-time on-chain unrealised earn."
              }
            >
              {s.id === "hedgedjlp"
                ? "Realtime perp PnL"
                : "Pure interest accrued"}
            </div>
            <div
              className={`text-sm font-semibold tabular-nums ${
                s.realtime_protocol_pnl_usdc >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {s.realtime_protocol_pnl_usdc >= 0 ? "+" : ""}$
              {/* rc45: stable_yield interest is in cents-fractions for the
                  first hours after baseline; use 4 decimals so users see
                  it accumulate. hedgedjlp is in dollars; keep 2 decimals. */}
              {Math.abs(s.realtime_protocol_pnl_usdc) < 1 && s.id !== "hedgedjlp"
                ? s.realtime_protocol_pnl_usdc.toFixed(4)
                : s.realtime_protocol_pnl_usdc.toFixed(2)}
            </div>
          </div>
        ) : isLive &&
          s.lifetime_earned_usdc !== undefined &&
          s.lifetime_earned_since_unix !== undefined ? (
          <div className="mt-3 pt-3 border-t border-white/5 flex items-baseline justify-between">
            <div
              className="text-[10px] uppercase tracking-wide opacity-50"
              title="Current value minus first observed position value. Includes operator-funded capital flows in the delta — not pure interest accrual."
            >
              Position Δ since {new Date(s.lifetime_earned_since_unix * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </div>
            <div
              className={`text-sm font-semibold tabular-nums ${
                s.lifetime_earned_usdc >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {s.lifetime_earned_usdc >= 0 ? "+" : ""}$
              {s.lifetime_earned_usdc.toFixed(2)}
            </div>
          </div>
        ) : null}

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
