"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { SHIPS } from "@/lib/ships";

/**
 * Home-page surfacing of the shipping log. Shows only the latest entry;
 * the full devlog lives at `/devlog`.
 */
export function RecentShipsCard() {
  const latest = SHIPS[0];
  if (!latest) return null;
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-60">
              Latest update
            </div>
            <div className="text-[11px] opacity-50 mt-0.5">
              Most recent mainnet ship
            </div>
          </div>
          <Link
            href="/devlog"
            className="text-[10px] uppercase tracking-wide opacity-60 hover:opacity-100 hover:underline"
          >
            full devlog →
          </Link>
        </div>
        <div className="flex items-baseline gap-3 text-sm leading-snug">
          <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 w-14 shrink-0">
            {latest.version}
          </span>
          <span className="opacity-40 tabular-nums text-[11px] w-20 shrink-0">
            {latest.date}
          </span>
          <span className="min-w-0">
            <span className="font-medium">{latest.headline}</span>
            <span className="opacity-60 ml-2">— {latest.detail}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
