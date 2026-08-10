import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { METAL_PULSE_INTERVAL_SECONDS, parsePulseRoundId } from "@/lib/metal-pulse";
import { fetchMetalPulseRound, fetchMetalPulseSnapshot } from "@/lib/metal-pulse-source";

export const dynamic = "force-dynamic";

interface MetalPulseRouteContext {
  params: Promise<{ metal: string }>;
}

export async function GET(request: Request, context: MetalPulseRouteContext) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, {
      key: "scarcity-metal-pulse-rounds",
      limit: 120,
      windowMs: 60_000,
    }).headers;
    const { metal } = await context.params;
    if (metal.toLowerCase() !== "gold") {
      return NextResponse.json(
        { error: "Only Gold 15 is activated in the current paper milestone." },
        { status: 404, headers: { ...headers, "cache-control": "private, no-store" } },
      );
    }

    const url = new URL(request.url);
    const requestedRound = url.searchParams.get("round");
    if (requestedRound) {
      const startsAtUnix = parsePulseRoundId(requestedRound);
      const nowUnix = Math.floor(Date.now() / 1_000);
      if (startsAtUnix === null
        || startsAtUnix > nowUnix + METAL_PULSE_INTERVAL_SECONDS
        || startsAtUnix < nowUnix - 31 * 86_400) {
        return NextResponse.json(
          { error: "Round id is invalid or outside the 31-day paper-history window." },
          { status: 400, headers: { ...headers, "cache-control": "private, no-store" } },
        );
      }
      return NextResponse.json(
        await fetchMetalPulseRound({ startsAtUnix }),
        { headers: { ...headers, "cache-control": "private, no-store" } },
      );
    }

    return NextResponse.json(
      await fetchMetalPulseSnapshot(),
      { headers: { ...headers, "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Metal Pulse is unavailable." },
      {
        status: security?.status ?? 503,
        headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "private, no-store" },
      },
    );
  }
}
