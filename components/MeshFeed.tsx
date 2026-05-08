"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchEvents, openEventStream, MeshEvent } from "@/lib/api";
import { EventCard } from "./EventCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export function MeshFeed() {
  const [events, setEvents] = useState<MeshEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [showBeacons, setShowBeacons] = useState(false);
  const seenIds = useRef(new Set<number>());

  useEffect(() => {
    let cancelled = false;
    fetchEvents({ limit: 200 })
      .then((initial) => {
        if (cancelled) return;
        initial.forEach((e) => {
          if (e.id !== null && e.id !== undefined) seenIds.current.add(e.id);
        });
        setEvents(initial);
      })
      .catch((e) => console.warn("fetchEvents failed", e));

    const close = openEventStream({
      onEvent: (e) => {
        if (e.id !== null && e.id !== undefined && seenIds.current.has(e.id)) return;
        if (e.id !== null && e.id !== undefined) seenIds.current.add(e.id);
        setEvents((prev) => [e, ...prev].slice(0, 500));
        setConnected(true);
      },
      onError: () => setConnected(false),
      onClose: () => setConnected(false),
    });

    return () => {
      cancelled = true;
      close();
    };
  }, []);

  // Beacons are daemon health pings; the 5 pills above already show that.
  // Hide them from the feed by default to keep actionable events
  // (Assign / Approve / Withdraw / Report / Escalate / MarketSignal /
  // Internal) visible.
  const visibleEvents = useMemo(
    () => (showBeacons ? events : events.filter((e) => e.msg_type !== "Beacon")),
    [events, showBeacons],
  );

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Mesh feed</CardTitle>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setShowBeacons((s) => !s)}
            className="rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-60 hover:opacity-100"
            title="Toggle Beacon (heartbeat) events"
          >
            {showBeacons ? "hide beacons" : "show beacons"}
          </button>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
            <span className="opacity-60">{connected ? "live" : "reconnecting…"}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        <ScrollArea className="h-[600px]">
          <div className="space-y-1 px-3 pb-3">
            {visibleEvents.length === 0 && (
              <div className="text-sm opacity-50 py-8 text-center">
                No actionable events yet — daemons are alive (see pills above).
              </div>
            )}
            {visibleEvents.map((e, i) => (
              <EventCard key={e.id ?? `t-${e.ts_ms}-${i}`} event={e} />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
