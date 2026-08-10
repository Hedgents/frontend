import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { getMetalIntelligence, getMetalReferenceMarket, loadScarcityDataset } from "@/lib/scarcity";

export const dynamic = "force-dynamic";

interface MetalRouteContext {
  params: Promise<{ symbol: string }>;
}

export async function GET(request: Request, context: MetalRouteContext) {
  let responseHeaders: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    responseHeaders = enforceRateLimit(request, {
      key: "scarcity-metal-detail",
      limit: 120,
      windowMs: 60_000,
    }).headers;
    const { symbol } = await context.params;
    const url = new URL(request.url);
    const asOfValue = url.searchParams.get("asOf");
    if (asOfValue && !Number.isFinite(Date.parse(asOfValue))) {
      return NextResponse.json(
        { error: "The asOf query must be an ISO timestamp." },
        { status: 400, headers: { ...responseHeaders, "cache-control": "no-store" } },
      );
    }
    const dataset = await loadScarcityDataset(url.searchParams.get("dataset"));
    const intelligence = getMetalIntelligence({
      identifier: symbol,
      dataset,
      asOf: asOfValue ? new Date(asOfValue).toISOString() : new Date().toISOString(),
    });
    if (!intelligence) {
      return NextResponse.json(
        { error: "Metal is not in the scarcity registry." },
        { status: 404, headers: { ...responseHeaders, "cache-control": "no-store" } },
      );
    }
    return NextResponse.json({
      ...intelligence.snapshot,
      reference: getMetalReferenceMarket(intelligence.snapshot.metal.id),
      state: intelligence.state,
      history: intelligence.history,
      signals: intelligence.signals,
      candidates: intelligence.candidates,
    }, {
      headers: { ...responseHeaders, "cache-control": "no-store" },
    });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scarcity data is unavailable." },
      {
        status: security?.status ?? 400,
        headers: {
          ...responseHeaders,
          ...(security?.headers ?? {}),
          "cache-control": "no-store",
        },
      },
    );
  }
}
