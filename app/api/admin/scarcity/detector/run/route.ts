import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/access-auth";
import { apiSecurityError, secureMutation } from "@/lib/api-security";
import { runOnlineMetalDetector } from "@/lib/scarcity-detector-runner";
import { onlineDetectorSummary } from "@/lib/scarcity/online-detector";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = secureMutation(request, { key: "scarcity-detector-manual-run", limit: 4, windowMs: 3_600_000 }).headers;
    const result = await runOnlineMetalDetector();
    return NextResponse.json({ run: result.run, summary: onlineDetectorSummary(result.state) }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Online detector run failed.") },
      { status: security?.status ?? 500, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
