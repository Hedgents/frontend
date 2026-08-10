import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/access-auth";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { replayMetalPulseHistory } from "@/lib/metal-pulse-replay";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = secureMutation(request, {
      key: "scarcity-pulse-replay",
      limit: 4,
      windowMs: 3_600_000,
    }, 16_000).headers;
    const body = await readJsonBody(request, 16_000);
    const fromStartUnix = Number(body.fromStartUnix);
    const roundCount = Number(body.roundCount);
    const nowInput = body.now === undefined ? new Date() : new Date(String(body.now));
    if (!Number.isFinite(nowInput.getTime())) throw new Error("Replay generation time is invalid.");
    const now = new Date(Math.floor(nowInput.getTime() / 1_000) * 1_000);
    const replay = await replayMetalPulseHistory({ fromStartUnix, roundCount, now });
    return NextResponse.json({
      ...replay,
      persisted: false,
      submitted: false,
      warning: "Replay only. Source artifacts are hashed in the result but are not persisted by this endpoint.",
    }, { headers: { ...headers, "cache-control": "private, no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Metal Pulse replay failed.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
