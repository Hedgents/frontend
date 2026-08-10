import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { loadScarcityMarketCatalog } from "@/lib/scarcity-market-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, {
      key: "scarcity-markets",
      limit: 120,
      windowMs: 60_000,
    }).headers;
    const catalog = await loadScarcityMarketCatalog();
    return NextResponse.json({
      count: catalog.length,
      warning: "Specifications are listed independently of deployment state. Check lifecycle and onchain fields before trading.",
      markets: catalog.map((market) => ({
        marketId: market.marketId,
        questionHash: market.questionHash,
        rulesHash: market.rulesHash,
        lifecycle: market.lifecycle,
        publication: market.publication,
        warning: market.warning,
        onchain: market.onchain,
        question: market.question,
        rules: market.rules,
      })),
    }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "Scarcity markets could not be loaded." },
      { status: security?.status ?? 500, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
