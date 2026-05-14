"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { fetchAprHistory, AprHistoryResponse } from "@/lib/api";

// Match the institutional strategy card palette used elsewhere on the
// dashboard: emerald (stable-yield), amber (multiply), sky (hedgedjlp).
const STRATEGIES = [
  { id: "stable_yield", label: "Stable Yield", color: "#10b981" },
  { id: "multiply", label: "Multiply", color: "#f59e0b" },
  { id: "hedgedjlp", label: "Hedged JLP", color: "#0ea5e9" },
] as const;

type StrategyId = (typeof STRATEGIES)[number]["id"];

const W = 720;
const H = 220;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 28;
const MIN_SAMPLES_FOR_SOLID_LINE = 5;

function bpsToPct(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

function timeLabel(ts_ms: number, now_ms: number): string {
  const ago_ms = now_ms - ts_ms;
  const h = Math.round(ago_ms / 3_600_000);
  if (h <= 0) return "now";
  return `${h}h ago`;
}

export function AprHistoryChart() {
  const [data, setData] = useState<Record<StrategyId, AprHistoryResponse | null>>({
    stable_yield: null,
    multiply: null,
    hedgedjlp: null,
  });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [sy, mu, hj] = await Promise.all([
          fetchAprHistory("stable_yield", 24),
          fetchAprHistory("multiply", 24),
          fetchAprHistory("hedgedjlp", 24),
        ]);
        if (cancelled) return;
        setData({ stable_yield: sy, multiply: mu, hedgedjlp: hj });
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const totalSamples = STRATEGIES.reduce(
    (acc, s) => acc + (data[s.id]?.samples.length ?? 0),
    0,
  );

  // Shared y-axis domain across all three lines so users can compare
  // strategies on a single scale.
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  let tStart = Number.POSITIVE_INFINITY;
  let tEnd = Number.NEGATIVE_INFINITY;
  for (const s of STRATEGIES) {
    const d = data[s.id];
    if (!d) continue;
    for (const p of d.samples) {
      if (p.apr_bps < yMin) yMin = p.apr_bps;
      if (p.apr_bps > yMax) yMax = p.apr_bps;
      if (p.ts_ms < tStart) tStart = p.ts_ms;
      if (p.ts_ms > tEnd) tEnd = p.ts_ms;
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = 0;
    yMax = 0;
  }
  if (yMin === yMax) {
    yMin = yMin - 50;
    yMax = yMax + 50;
  }
  const now_ms = Date.now();
  if (!Number.isFinite(tStart) || !Number.isFinite(tEnd)) {
    tEnd = now_ms;
    tStart = now_ms - 86_400_000;
  }

  const x = (ts: number) =>
    PAD_L + ((ts - tStart) / Math.max(tEnd - tStart, 1)) * (W - PAD_L - PAD_R);
  const y = (bps: number) =>
    PAD_T + (1 - (bps - yMin) / Math.max(yMax - yMin, 1)) * (H - PAD_T - PAD_B);

  const empty = totalSamples === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">APR history (24h)</CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="text-xs text-muted-foreground py-12 text-center">
            {err
              ? "APR history unavailable (dashboard restarting?)"
              : "Collecting APR history… check back in an hour"}
          </div>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="block">
              {/* y-axis labels: min / max */}
              <text x={4} y={PAD_T + 8} fontSize={10} fill="currentColor" opacity={0.6}>
                {bpsToPct(yMax)}
              </text>
              <text x={4} y={H - PAD_B + 2} fontSize={10} fill="currentColor" opacity={0.6}>
                {bpsToPct(yMin)}
              </text>
              {/* x-axis labels: start / mid / end */}
              {[tStart, (tStart + tEnd) / 2, tEnd].map((ts, i) => {
                const xPos = i === 0 ? PAD_L : i === 1 ? (PAD_L + (W - PAD_R)) / 2 : W - PAD_R;
                const anchor: "start" | "middle" | "end" = i === 0 ? "start" : i === 1 ? "middle" : "end";
                return (
                  <text
                    key={i}
                    x={xPos}
                    y={H - 6}
                    fontSize={10}
                    fill="currentColor"
                    opacity={0.6}
                    textAnchor={anchor}
                  >
                    {timeLabel(ts, now_ms)}
                  </text>
                );
              })}
              {/* baseline border */}
              <line
                x1={PAD_L}
                y1={H - PAD_B}
                x2={W - PAD_R}
                y2={H - PAD_B}
                stroke="currentColor"
                strokeOpacity={0.15}
              />
              {STRATEGIES.map((s) => {
                const d = data[s.id];
                if (!d || d.samples.length === 0) return null;
                const path = d.samples
                  .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts_ms).toFixed(1)},${y(p.apr_bps).toFixed(1)}`)
                  .join(" ");
                const sparse = d.samples.length < MIN_SAMPLES_FOR_SOLID_LINE;
                return (
                  <path
                    key={s.id}
                    d={path}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeOpacity={sparse ? 0.45 : 1}
                    strokeDasharray={sparse ? "4 3" : undefined}
                  />
                );
              })}
            </svg>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              {STRATEGIES.map((s) => {
                const d = data[s.id];
                const stats = d?.stats;
                const sparse = (d?.samples.length ?? 0) < MIN_SAMPLES_FOR_SOLID_LINE;
                return (
                  <div key={s.id} className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-3 h-[2px]"
                      style={{
                        background: s.color,
                        opacity: sparse ? 0.45 : 1,
                      }}
                    />
                    <span className="font-medium">{s.label}</span>
                    {stats && stats.samples_count > 0 ? (
                      <span className="text-muted-foreground">
                        min {bpsToPct(stats.min_bps)} · mean {bpsToPct(stats.mean_bps)} · max{" "}
                        {bpsToPct(stats.max_bps)}
                        {sparse ? ` · ${stats.samples_count} samples` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">no data</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
