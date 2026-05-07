"use client";

import { useEffect, useState } from "react";
import { fetchAum, fetchPnl, fetchDaemons, AumResponse, PnlResponse, DaemonHealth } from "@/lib/api";
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

export function NumbersPanel() {
  const [aum, setAum] = useState<AumResponse | null>(null);
  const [pnl, setPnl] = useState<PnlResponse | null>(null);
  const [daemons, setDaemons] = useState<DaemonHealth[]>([]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [a, p, d] = await Promise.all([fetchAum(), fetchPnl("24h"), fetchDaemons()]);
        if (!cancelled) {
          setAum(a);
          setPnl(p);
          setDaemons(d);
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
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
      <Card className="md:col-span-3">
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
