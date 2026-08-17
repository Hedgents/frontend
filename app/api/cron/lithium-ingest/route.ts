import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ingestLithiumDays, lithiumStorageConfigured } from "@/lib/scarcity/lithium-store";

export const dynamic = "force-dynamic";
/** Twelve candidate days, each two sequential HTTP round trips to an exchange on the other side of
 * the world, with up to four attempts apiece. A normal run fetches one day and finishes in seconds;
 * the ceiling only matters on the first run after an outage. */
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const actual = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!lithiumStorageConfigured() && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Lithium series storage is not configured." }, { status: 503 });
  }
  try {
    const report = await ingestLithiumDays();
    // Days the exchange never published are not failures, so the run is only unhealthy when every
    // day it actually tried to fetch failed. A quiet partial failure still surfaces in `failed`.
    const attempted = report.fetched.length + report.failed.length;
    const ok = attempted === 0 || report.failed.length < attempted;
    return NextResponse.json({ ok, report }, {
      status: ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("Lithium GFEX ingest cron failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lithium ingest failed." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
