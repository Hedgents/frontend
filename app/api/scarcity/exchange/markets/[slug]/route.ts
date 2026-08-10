import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { getScarcityMarketChainState } from "@/lib/scarcity-exchange-index";
import { getStoredScarcityMarket } from "@/lib/scarcity-market-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-chain-state", limit: 120, windowMs: 60_000 }).headers;
    const { slug } = await params;
    if (!await getStoredScarcityMarket(slug)) return NextResponse.json({ error: "Scarcity market not found." }, { status: 404, headers });
    const state = await getScarcityMarketChainState(slug);
    return NextResponse.json({ deployed: Boolean(state), state }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Scarcity chain state is unavailable.") },
      { status: security?.status ?? 503, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
