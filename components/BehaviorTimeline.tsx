"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { fetchActivity, ActivityBucket } from "@/lib/api";

interface ChartRow {
  ts_ms: number;
  label: string;
  events: number;
}

function bucketLabel(ts_ms: number): string {
  const d = new Date(ts_ms);
  return d.getHours().toString().padStart(2, "0") + ":00";
}

export function BehaviorTimeline() {
  const [rows, setRows] = useState<ChartRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const buckets: ActivityBucket[] = await fetchActivity(24);
        if (cancelled) return;
        setRows(
          buckets.map((b) => ({
            ts_ms: b.ts_ms,
            label: bucketLabel(b.ts_ms),
            events: b.events,
          })),
        );
      } catch {
        if (!cancelled && rows.length === 0) {
          const now = Date.now();
          const hourMs = 3_600_000;
          const bucketStart = Math.floor(now / hourMs) * hourMs;
          const empty: ChartRow[] = Array.from({ length: 24 }, (_, i) => {
            const ts = bucketStart - (23 - i) * hourMs;
            return { ts_ms: ts, label: bucketLabel(ts), events: 0 };
          });
          setRows(empty);
        }
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Activity (24h)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={rows}>
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={3} />
            <YAxis tick={{ fontSize: 10 }} width={28} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              labelFormatter={(label, payload) => {
                const ts = payload?.[0]?.payload?.ts_ms;
                if (typeof ts === "number") {
                  return new Date(ts).toLocaleString();
                }
                return label;
              }}
            />
            <Line type="monotone" dataKey="events" stroke="#06b6d4" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
