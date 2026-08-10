import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { listMetalIntelligence, loadScarcityDataset } from "@/lib/scarcity";

export const dynamic = "force-dynamic";

interface SignalRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: SignalRouteContext) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-signal-detail", limit: 120, windowMs: 60_000 }).headers;
    const { id } = await context.params;
    const url = new URL(request.url);
    const dataset = await loadScarcityDataset(url.searchParams.get("dataset"));
    const signal = listMetalIntelligence({ dataset }).flatMap((entry) => entry.signals).find((entry) => entry.id === id);
    if (!signal) return NextResponse.json({ error: "Signal was not found." }, { status: 404, headers });
    return NextResponse.json(signal, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scarcity signal is unavailable." },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
