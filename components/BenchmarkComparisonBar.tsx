"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { fetchAum, fetchRates, AumResponse, RatesResponse } from "@/lib/api";

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

interface Row {
  label: string;
  sublabel: string;
  bps: number;
  highlight: boolean;
}

export function BenchmarkComparisonBar() {
  const [rates, setRates] = useState<RatesResponse | null>(null);
  const [aum, setAum] = useState<AumResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [r, a] = await Promise.all([
          fetchRates(),
          fetchAum().catch(() => null),
        ]);
        if (!cancelled) {
          setRates(r);
          if (a) setAum(a);
        }
      } catch {
        // keep previous state
      }
    };
    tick();
    const i = setInterval(tick, 30000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  const hedgents = aum?.combined_apr_bps ?? 0;
  const usdy = rates?.usdy_apy_bps ?? 490;
  const effr = rates?.effr_bps ?? 433;
  const buidl = rates?.buidl_apy_bps ?? 475;
  const note = rates?.kamino_note;
  const hedgentsLive = hedgents > 0;

  const rows: Row[] = [
    { label: "EFFR", sublabel: "Effective Fed Funds Rate", bps: effr, highlight: false },
    { label: "BUIDL", sublabel: "BlackRock tokenised T-bills", bps: buidl, highlight: false },
    { label: "USDY", sublabel: "Ondo tokenised T-bills (Solana)", bps: usdy, highlight: false },
    {
      label: "Hedgents fleet",
      sublabel: "Combined APR across 3 live strategies",
      bps: hedgents,
      highlight: true,
    },
  ];

  const maxBps = Math.max(...rows.map((r) => r.bps), 1);
  const spreadOverUsdy = hedgents > usdy ? hedgents - usdy : null;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-60">
              Benchmark comparison
            </div>
            <div className="text-[11px] opacity-50 mt-0.5">
              Hedgents fleet combined APR vs short-duration reference rates
            </div>
          </div>
          {hedgentsLive ? (
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] uppercase tracking-wide opacity-60">live</span>
            </div>
          ) : note === "unavailable" ? (
            <span className="text-[10px] uppercase tracking-wide opacity-40">
              mainnet only
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-wide opacity-40">loading…</span>
          )}
        </div>

        <div className="space-y-3">
          {rows.map((row) => {
            const pct = maxBps > 0 ? Math.min((row.bps / maxBps) * 100, 100) : 0;
            const showDash = row.highlight && !hedgentsLive;
            return (
              <div key={row.label}>
                <div className="flex items-baseline justify-between mb-1">
                  <div className="min-w-0">
                    <span
                      className={`text-sm font-medium ${
                        row.highlight ? "text-emerald-600 dark:text-emerald-400" : ""
                      }`}
                    >
                      {row.label}
                    </span>
                    <span className="ml-2 text-[11px] opacity-50">{row.sublabel}</span>
                  </div>
                  <span
                    className={`tabular-nums text-sm font-semibold ml-3 ${
                      row.highlight
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "opacity-70"
                    }`}
                  >
                    {showDash ? "—" : bpsToPercent(row.bps)}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      row.highlight
                        ? "bg-emerald-500"
                        : "bg-neutral-400 dark:bg-neutral-500"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {spreadOverUsdy !== null ? (
          <div className="mt-4 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] text-emerald-700 dark:text-emerald-400">
            +{bpsToPercent(spreadOverUsdy)} over USDY — {(spreadOverUsdy / 100).toFixed(0)}bps
            yield premium on the same risk class
          </div>
        ) : null}

        <div className="mt-2 text-[10px] opacity-30">
          BUIDL no public live feed; baked at 4.75% mid-point of BlackRock's
          published 4.70–4.80% range. USDY {bpsToPercent(usdy)}, EFFR{" "}
          {bpsToPercent(effr)} updated manually as of May 2026.
        </div>
      </CardContent>
    </Card>
  );
}
