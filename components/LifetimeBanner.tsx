"use client";

/**
 * Hero banner showing the fleet's time-on-mainnet metrics.
 *
 * Design intent: the moat of an operational reliability product compounds
 * only as visible time. If a prospect can't see "this thing has been
 * running for N days with M incidents resolved publicly", the operational
 * track record is invisible. This banner makes the three numbers that
 * matter — live since, uptime, incidents — the first thing on the page.
 *
 * Uptime ticks every second by deriving (Date.now() - liveSinceMs)
 * client-side after fetching once from /lifetime. We trust the server's
 * `now_unix` to anchor the start so the displayed seconds align with
 * server clock, but the per-second increment is computed locally — one
 * fetch per page load, then arithmetic.
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { fetchLifetime, LifetimeResponse } from "@/lib/api";

const SECS_PER_DAY = 86_400;
const SECS_PER_HOUR = 3_600;
const SECS_PER_MIN = 60;

function formatUptime(secs: number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const days = Math.floor(secs / SECS_PER_DAY);
  const hours = Math.floor((secs % SECS_PER_DAY) / SECS_PER_HOUR);
  const minutes = Math.floor((secs % SECS_PER_HOUR) / SECS_PER_MIN);
  const seconds = secs % SECS_PER_MIN;
  return { days, hours, minutes, seconds };
}

function formatLiveSinceDate(unix: number): string {
  // Intl.DateTimeFormat is locale-stable on the server side too; use UTC
  // so SSR + client agree on the displayed date.
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(unix * 1000));
}

export function LifetimeBanner() {
  const [data, setData] = useState<LifetimeResponse | null>(null);
  // Track the moment we fetched so the uptime counter ticks locally
  // without a per-second round-trip.
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  // rc21 audit (H3): fetch on mount AND on visibilitychange. A tab
  // left open for a week was ticking its uptime counter purely off the
  // client clock; refetching when the tab becomes visible re-anchors
  // the displayed uptime to the server's authoritative value (and
  // catches a bumped INCIDENTS_RESOLVED on rc rolls).
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchLifetime()
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setFetchedAtMs(Date.now());
        })
        .catch((err) => {
          // rc21 audit (H3): surface fetch failures to the console
          // instead of rendering "—" forever in silence. The banner is
          // the hero placement; "—" should be loud at the operator's
          // dev console even if it's quiet in the UI.
          if (!cancelled) {
            // eslint-disable-next-line no-console
            console.error("LifetimeBanner: /lifetime fetch failed", err);
          }
        });
    };
    load();
    const onVisibility = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Tick the local clock once per second so the uptime counter scrolls.
  // Browser throttles background tabs to ~1/min; on tab resume the
  // arithmetic in `liveUptimeSecs` (Date.now() - fetchedAtMs) catches
  // up automatically — no requestAnimationFrame loop needed.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Derive live uptime: anchor at the server's reported uptime_secs,
  // then add the wall-clock seconds elapsed since we fetched it.
  const liveUptimeSecs = (() => {
    if (!data || fetchedAtMs == null) return null;
    const drift = Math.max(0, Math.floor((nowMs - fetchedAtMs) / 1000));
    return data.uptime_secs + drift;
  })();

  const liveSinceDate = data ? formatLiveSinceDate(data.live_since_unix) : "—";
  const incidents = data?.incidents_resolved ?? 0;
  const t = liveUptimeSecs != null ? formatUptime(liveUptimeSecs) : null;

  return (
    <Card className="relative overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.03] via-transparent to-transparent dark:from-emerald-500/[0.05]">
      {/* Subtle top accent line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />

      <CardContent className="pt-6 pb-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            {/* rc21 audit (H3): respect prefers-reduced-motion. Tailwind's
                `motion-safe:` variant gates the animation on the OS-level
                accessibility setting; users who opt out of motion get the
                static dot only. */}
            <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-[10px] uppercase tracking-[0.18em] font-medium text-emerald-600 dark:text-emerald-400">
            Live on Solana mainnet
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <Stat
            label="Live since"
            value={liveSinceDate}
            sublabel={
              data
                ? new Intl.DateTimeFormat("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "UTC",
                    timeZoneName: "short",
                  }).format(new Date(data.live_since_unix * 1000))
                : null
            }
          />
          <Stat
            label="Uptime"
            value={
              t == null ? "—" : `${t.days}d ${t.hours}h ${t.minutes}m`
            }
            sublabel={t == null ? null : `${t.seconds}s · counting`}
            tabular
          />
          <Stat
            label="Incidents resolved"
            value={incidents.toString()}
            sublabel="Pinned with regression tests"
            tabular
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  sublabel,
  tabular = false,
}: {
  label: string;
  value: string;
  sublabel: string | null;
  tabular?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.15em] opacity-50 font-medium">
        {label}
      </div>
      <div
        className={`text-2xl sm:text-3xl font-semibold mt-1 ${
          tabular ? "tabular-nums" : ""
        }`}
      >
        {value}
      </div>
      {sublabel && (
        <div className="text-[11px] opacity-50 mt-0.5">{sublabel}</div>
      )}
    </div>
  );
}
