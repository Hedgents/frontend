"use client";

import { Card, CardContent } from "@/components/ui/card";
import { RatesResponse } from "@/lib/api";

interface Props {
  rates: RatesResponse | null;
}

interface Row {
  label: string;
  sublabel: string;
  bps: number;
  highlight: boolean;
}

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

function Bar({ bps, maxBps, highlight }: { bps: number; maxBps: number; highlight: boolean }) {
  const pct = maxBps > 0 ? Math.min((bps / maxBps) * 100, 100) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${
          highlight
            ? "bg-emerald-500"
            : "bg-neutral-400 dark:bg-neutral-500"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function YieldBenchmarkCard({ rates }: Props) {
  const kamino = rates?.kamino_usdc_supply_bps ?? 0;
  const usdy = rates?.usdy_apy_bps ?? 490;
  const effr = rates?.effr_bps ?? 433;
  const note = rates?.kamino_note;

  const rows: Row[] = [
    {
      label: "EFFR",
      sublabel: "Effective Fed Funds Rate",
      bps: effr,
      highlight: false,
    },
    {
      label: "USDY",
      sublabel: "Ondo, Solana — tokenised T-bills",
      bps: usdy,
      highlight: false,
    },
    {
      label: "Kamino USDC",
      sublabel: "Hedgents stable-yield strategy",
      bps: kamino,
      highlight: true,
    },
  ];

  const maxBps = Math.max(...rows.map((r) => r.bps), 1);
  const spread = kamino > usdy ? kamino - usdy : null;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wide opacity-60">
            Yield Benchmark
          </div>
          {note === "live" ? (
            <div className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] uppercase tracking-wide opacity-60">live</span>
            </div>
          ) : note === "unavailable" ? (
            <span className="text-[10px] uppercase tracking-wide opacity-40">mainnet only</span>
          ) : (
            <span className="text-[10px] uppercase tracking-wide opacity-40">loading…</span>
          )}
        </div>

        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="flex items-baseline justify-between mb-1">
                <div>
                  <span className={`text-sm font-medium ${row.highlight ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                    {row.label}
                  </span>
                  <span className="ml-2 text-[11px] opacity-50">{row.sublabel}</span>
                </div>
                <span className={`tabular-nums text-sm font-semibold ${row.highlight ? "text-emerald-600 dark:text-emerald-400" : "opacity-70"}`}>
                  {row.bps === 0 && row.highlight && note !== "live"
                    ? "—"
                    : bpsToPercent(row.bps)}
                </span>
              </div>
              <Bar bps={row.bps} maxBps={maxBps} highlight={row.highlight} />
            </div>
          ))}
        </div>

        {spread !== null && spread > 0 ? (
          <div className="mt-3 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] text-emerald-700 dark:text-emerald-400">
            +{bpsToPercent(spread)} over USDY — {(spread / 100).toFixed(0)}bps yield premium
          </div>
        ) : null}

        <div className="mt-2 text-[10px] opacity-30">
          USDY {bpsToPercent(usdy)} · EFFR {bpsToPercent(effr)} · rates as of May 2026
        </div>
      </CardContent>
    </Card>
  );
}
