import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { getScarcityMetal, listMetalStateHistory, loadScarcityDataset } from "@/lib/scarcity";

export const dynamic = "force-dynamic";

interface MetalHistoryContext {
  params: Promise<{ symbol: string }>;
}

export async function GET(request: Request, context: MetalHistoryContext) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-metal-history", limit: 120, windowMs: 60_000 }).headers;
    const { symbol } = await context.params;
    const metal = getScarcityMetal(symbol);
    if (!metal) return NextResponse.json({ error: "Metal is not in the scarcity registry." }, { status: 404, headers });
    const url = new URL(request.url);
    const asOfValue = url.searchParams.get("asOf");
    if (asOfValue && !Number.isFinite(Date.parse(asOfValue))) throw new Error("The asOf query must be an ISO timestamp.");
    const limitValue = url.searchParams.get("limit");
    const limit = limitValue ? Number(limitValue) : 120;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("The limit must be an integer between 1 and 500.");
    const dataset = await loadScarcityDataset(url.searchParams.get("dataset"));
    const asOf = asOfValue ? new Date(asOfValue).toISOString() : new Date().toISOString();
    const states = listMetalStateHistory({ dataset, metalId: metal.id, asOf, limit });
    return NextResponse.json({ metal, dataset: { id: dataset.id, kind: dataset.kind, label: dataset.label }, asOf, count: states.length, states }, {
      headers: { ...headers, "cache-control": "no-store" },
    });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scarcity history is unavailable." },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
