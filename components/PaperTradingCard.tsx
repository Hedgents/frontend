"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { formatUsdc } from "@/lib/decode";

interface StrategyData {
  id: string;
  name: string;
  tagline: string;
  description: string;
  principal_usdc: number;
  net_apr_bps: number;
  elapsed_secs: number;
  earned_usdc: number;
  total_aum_usdc: number;
}

interface PortfolioData {
  total_principal_usdc: number;
  total_earned_usdc: number;
  elapsed_secs: number;
  annualised_apy_pct: number;
}

interface PaperResponse {
  strategies: StrategyData[];
  portfolio: PortfolioData;
}

async function fetchPaper(): Promise<PaperResponse> {
  const r = await fetch(`${API_BASE}/paper`);
  if (!r.ok) throw new Error(`fetchPaper ${r.status}`);
  return r.json();
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function aprPct(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

const RISK: Record<string, { label: string; color: string }> = {
  stable_yield: { label: "Low risk",    color: "text-emerald-600 dark:text-emerald-400" },
  multiply:     { label: "Medium risk", color: "text-amber-600 dark:text-amber-400" },
  hedgedjlp:    { label: "Low-medium",  color: "text-sky-600 dark:text-sky-400" },
};

export function PaperTradingCard() {
  const [data, setData] = useState<PaperResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await fetchPaper();
        if (!cancelled) setData(d);
      } catch {
        // server unreachable; keep previous state
      }
    };
    tick();
    const i = setInterval(tick, 10_000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  const p = data?.portfolio;
  const elapsed = p?.elapsed_secs ?? 0;
  const apy = p?.annualised_apy_pct ?? 0;

  return (
    <Card>
      <CardContent className="pt-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold uppercase tracking-wide">
              Paper Trading
            </span>
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
              simulate only
            </span>
          </div>
          <div className="text-xs opacity-60 tabular-nums">
            {elapsed > 0 ? `${formatElapsed(elapsed)} running` : "starting…"}
          </div>
        </div>

        {/* Strategy grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          {(data?.strategies ?? []).map((s) => {
            const risk = RISK[s.id] ?? { label: "—", color: "opacity-60" };
            return (
              <div
                key={s.id}
                className="rounded-lg border border-border/60 bg-muted/30 p-4 flex flex-col gap-3"
              >
                {/* Name + risk */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-sm">{s.name}</div>
                    <div className="text-[11px] opacity-60 mt-0.5">{s.tagline}</div>
                  </div>
                  <span className={`text-[10px] font-medium ${risk.color} whitespace-nowrap`}>
                    {risk.label}
                  </span>
                </div>

                {/* Description */}
                <p className="text-xs leading-relaxed opacity-70">{s.description}</p>

                {/* Live APR */}
                <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide opacity-60 mb-0.5">Live APR</div>
                  <div className="text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {aprPct(s.net_apr_bps)}
                  </div>
                </div>

                {/* P&L */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="opacity-60">Principal</span>
                  <span className="tabular-nums text-right">{formatUsdc(s.principal_usdc)}</span>
                  <span className="opacity-60">Earned</span>
                  <span className="tabular-nums text-right text-emerald-600 dark:text-emerald-400">
                    +{s.earned_usdc.toFixed(4)}
                  </span>
                  <span className="opacity-60">AUM</span>
                  <span className="tabular-nums text-right">{formatUsdc(s.total_aum_usdc)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Portfolio summary */}
        <div className="rounded-lg border border-border bg-muted/50 px-5 py-3 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide opacity-60">Portfolio APY (annualised)</div>
            <div className="text-3xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
              +{apy.toFixed(2)}%
            </div>
          </div>
          <div className="flex gap-8 text-xs">
            <div>
              <div className="opacity-60 mb-0.5">Total principal</div>
              <div className="tabular-nums font-medium">{formatUsdc(p?.total_principal_usdc ?? 0)}</div>
            </div>
            <div>
              <div className="opacity-60 mb-0.5">Total earned</div>
              <div className="tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                +{(p?.total_earned_usdc ?? 0).toFixed(4)}
              </div>
            </div>
            <div>
              <div className="opacity-60 mb-0.5">Window</div>
              <div className="tabular-nums font-medium">{formatElapsed(elapsed)}</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
