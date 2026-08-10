import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { getScarcityCurveMarketChainState } from "@/lib/scarcity-curve-index";
import { resolveStoredCurveMarket } from "@/lib/scarcity-deployment";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-curve-chain-state", limit: 120, windowMs: 60_000 }).headers;
    const { slug } = await params;
    const resolved = await resolveStoredCurveMarket(slug);
    if (!resolved) return NextResponse.json({ error: "Canonical scarcity curve not found." }, { status: 404, headers });
    const state = await getScarcityCurveMarketChainState(resolved.compiled.slug);
    return NextResponse.json({ deployed: Boolean(state), state }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Scarcity curve state is unavailable.") },
      { status: security?.status ?? 503, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
