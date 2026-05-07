"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { fetchEvents } from "@/lib/api";

interface ActivityBucket {
  hour: string;
  events: number;
}

export function BehaviorTimeline() {
  const [buckets, setBuckets] = useState<ActivityBucket[]>([]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const since = Date.now() - 24 * 3_600_000;
        const events = await fetchEvents({ since, limit: 1000 });
        if (cancelled) return;
        const counts = new Array(24).fill(0);
        events.forEach((e) => {
          const eventHour = new Date(e.ts_ms).getHours();
          counts[eventHour]++;
        });
        const next: ActivityBucket[] = counts.map((c, i) => ({
          hour: `${i.toString().padStart(2, "0")}:00`,
          events: c,
        }));
        setBuckets(next);
      } catch {
        if (!cancelled && buckets.length === 0) {
          // Show empty 24h grid even if backend is unreachable
          const empty: ActivityBucket[] = new Array(24).fill(0).map((_, i) => ({
            hour: `${i.toString().padStart(2, "0")}:00`,
            events: 0,
          }));
          setBuckets(empty);
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
          <LineChart data={buckets}>
            <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={28} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="events" stroke="#06b6d4" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
