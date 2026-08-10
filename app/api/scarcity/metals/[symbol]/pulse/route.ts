import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import {
  fetchWeeklyPositioningPulse,
  frequencyCoverageForMetal,
  getScarcityMetal,
  unavailableWeeklyPositioningPulse,
} from "@/lib/scarcity";

export const dynamic = "force-dynamic";

interface PulseRouteContext {
  params: Promise<{ symbol: string }>;
}

export async function GET(request: Request, context: PulseRouteContext) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, {
      key: "scarcity-metal-pulse",
      limit: 60,
      windowMs: 60_000,
    }).headers;
    const { symbol } = await context.params;
    const metal = getScarcityMetal(symbol);
    if (!metal) {
      return NextResponse.json(
        { error: "Metal is not in the scarcity registry." },
        { status: 404, headers: { ...headers, "cache-control": "no-store" } },
      );
    }
    const asOf = new Date().toISOString();
    const frequency = frequencyCoverageForMetal(metal.id);
    let weekly;
    try {
      weekly = await fetchWeeklyPositioningPulse(metal.id, { asOf });
    } catch {
      weekly = unavailableWeeklyPositioningPulse(
        metal.id,
        "The official weekly source is temporarily unreachable. No cached value is substituted as current.",
      );
    }
    return NextResponse.json({
      asOf,
      metal: { id: metal.id, symbol: metal.symbol, name: metal.name },
      frequency,
      weekly,
      separation: "Market pulse is context only. It does not alter the physical Metal State or become settlement evidence automatically.",
    }, { headers: { ...headers, "cache-control": "private, no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Metal pulse is unavailable." },
      {
        status: security?.status ?? 400,
        headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" },
      },
    );
  }
}
