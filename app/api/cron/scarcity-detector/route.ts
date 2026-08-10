import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runOnlineMetalDetector } from "@/lib/scarcity-detector-runner";
import { onlineDetectorStorageConfigured } from "@/lib/scarcity-detector-store";
import { onlineDetectorSummary } from "@/lib/scarcity/online-detector";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const actual = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!onlineDetectorStorageConfigured() && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Online detector storage is not configured." }, { status: 503 });
  }
  try {
    const result = await runOnlineMetalDetector();
    return NextResponse.json({
      ok: result.run.status !== "failed",
      run: result.run,
      summary: onlineDetectorSummary(result.state),
    }, { status: result.run.status === "failed" ? 503 : 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Online metal detector cron failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Online detector run failed." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
