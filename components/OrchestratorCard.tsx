"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  fetchOrchestratorDecisions,
  OrchestratorDecision,
} from "@/lib/api";

function actionLabel(action: string): string {
  switch (action) {
    case "no_action":
      return "NoAction";
    case "deposit":
      return "Deposit";
    case "withdraw":
      return "Withdraw";
    default:
      return action;
  }
}

function actionTone(action: string): string {
  switch (action) {
    case "deposit":
      return "text-emerald-600 dark:text-emerald-400";
    case "withdraw":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "opacity-70";
  }
}

function resultTone(r: string): string {
  if (!r) return "opacity-50";
  if (r === "sent") return "text-emerald-600 dark:text-emerald-400";
  if (r.startsWith("failed")) return "text-red-600 dark:text-red-400";
  if (r.startsWith("skipped")) return "text-amber-600 dark:text-amber-400";
  return "opacity-70";
}

function formatAge(unix: number, nowSec: number): string {
  const s = Math.max(0, nowSec - unix);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function OrchestratorCard() {
  const [decisions, setDecisions] = useState<OrchestratorDecision[] | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await fetchOrchestratorDecisions(8);
        if (!cancelled) {
          setDecisions(d);
          setNowSec(Math.floor(Date.now() / 1000));
        }
      } catch {
        // keep previous state
      }
    };
    tick();
    const i = setInterval(tick, 10000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  const latest = decisions?.[0];
  const mode = latest?.mode ?? "—";
  const live = latest != null;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-60">
              Orchestrator
            </div>
            <div className="text-[11px] opacity-50 mt-0.5">
              Regime-aware allocator · {mode}
            </div>
          </div>
          {live ? (
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] uppercase tracking-wide opacity-60">
                ticking
              </span>
            </div>
          ) : (
            <span className="text-[10px] uppercase tracking-wide opacity-40">
              no audit log
            </span>
          )}
        </div>

        {!decisions ? (
          <div className="text-xs opacity-50">Loading…</div>
        ) : decisions.length === 0 ? (
          <div className="text-xs opacity-50">
            No decisions recorded yet. The orchestrator writes one per tick to
            `orchestrator-audit.jsonl`.
          </div>
        ) : (
          <>
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wide opacity-50 mb-1">
                Latest decision
              </div>
              <div className="flex items-baseline gap-3">
                <span
                  className={`text-sm font-semibold ${actionTone(latest!.action)}`}
                >
                  {actionLabel(latest!.action)}
                </span>
                {latest!.strategy && (
                  <span className="text-sm">{latest!.strategy.replace("_", "-")}</span>
                )}
                {latest!.amount_usd > 0 && (
                  <span className="text-sm tabular-nums">
                    ${latest!.amount_usd.toFixed(2)}
                  </span>
                )}
                <span className="opacity-50 tabular-nums text-[11px] ml-auto">
                  {formatAge(latest!.ts_unix, nowSec)}
                </span>
              </div>
              <div className="text-[11px] opacity-60 mt-1 leading-relaxed">
                {latest!.reason}
              </div>
              {latest!.envelope_result && (
                <div
                  className={`text-[10px] uppercase tracking-wide mt-1 ${resultTone(
                    latest!.envelope_result,
                  )}`}
                >
                  envelope: {latest!.envelope_result}
                </div>
              )}
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wide opacity-50 mb-2">
                Recent history
              </div>
              <ol className="space-y-1.5">
                {decisions.slice(1).map((d, idx) => (
                  <li
                    key={`${d.ts_unix}-${idx}`}
                    className="flex items-baseline gap-3 text-[11px]"
                  >
                    <span className="opacity-40 tabular-nums w-14 shrink-0">
                      {formatAge(d.ts_unix, nowSec)}
                    </span>
                    <span className={`font-medium w-16 shrink-0 ${actionTone(d.action)}`}>
                      {actionLabel(d.action)}
                    </span>
                    <span className="opacity-50 truncate">{d.reason}</span>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
