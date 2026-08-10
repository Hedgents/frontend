import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { getScarcityCurvePortfolio } from "@/lib/scarcity-curve-index";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-curve-portfolio", limit: 60, windowMs: 60_000 }).headers;
    const owner = new URL(request.url).searchParams.get("owner") ?? "";
    const portfolio = await getScarcityCurvePortfolio(owner);
    return NextResponse.json(portfolio, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Scarcity curve portfolio is unavailable.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
