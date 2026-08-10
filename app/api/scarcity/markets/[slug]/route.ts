import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { getStoredScarcityMarket } from "@/lib/scarcity-market-store";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, {
      key: "scarcity-market-detail",
      limit: 120,
      windowMs: 60_000,
    }).headers;
    const { slug } = await params;
    const market = await getStoredScarcityMarket(slug);
    if (!market) {
      return NextResponse.json({ error: "Scarcity market not found." }, { status: 404, headers });
    }
    return NextResponse.json(market, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "Scarcity market could not be loaded." },
      { status: security?.status ?? 500, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
