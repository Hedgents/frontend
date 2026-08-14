import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { backupXpIndex } from "@/lib/xp/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const actual = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Daily immutable snapshot of the XP index.
 *
 * Wallet links are the only durable state in the system that cannot be recomputed from chain. The
 * live index is one object overwritten in place with no version history, so without this a single
 * bad write or an accidental delete is unrecoverable and every tester has to re-sign.
 *
 * A 200 with `written: false` is the normal result of the second run in a day, not a failure. A
 * response where `links` has fallen since the previous day is the thing to alarm on, because links
 * are only ever appended.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const result = await backupXpIndex();
    return NextResponse.json(result, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    // A refusal from the store is the corruption guard firing, and it means the live index is
    // already unreadable. Surface it loudly: this is the one alert worth waking up for.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "XP backup failed." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
