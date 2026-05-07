"use client";

import { useEffect, useRef, useState } from "react";
import { fetchEvents, openEventStream, MeshEvent } from "@/lib/api";
import { EventCard } from "./EventCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export function MeshFeed() {
  const [events, setEvents] = useState<MeshEvent[]>([]);
  const [connected, setConnected] = useState(false);
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

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Mesh feed</CardTitle>
        <div className="flex items-center gap-2 text-xs">
          <div className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
          <span className="opacity-60">{connected ? "live" : "reconnecting…"}</span>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        <ScrollArea className="h-[600px]">
          <div className="space-y-1 px-3 pb-3">
            {events.length === 0 && (
              <div className="text-sm opacity-50 py-8 text-center">Waiting for fleet activity…</div>
            )}
            {events.map((e, i) => (
              <EventCard key={e.id ?? `t-${e.ts_ms}-${i}`} event={e} />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
