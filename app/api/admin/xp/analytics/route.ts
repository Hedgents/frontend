import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { getXpAnalytics } from "@/lib/xp/analytics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = enforceRateLimit(request, { key: "xp-analytics", limit: 30, windowMs: 60_000 }).headers;
    const requested = Number(new URL(request.url).searchParams.get("limit") ?? "25");
    const limit = Number.isInteger(requested) && requested > 0 && requested <= 200 ? requested : 25;
    return NextResponse.json(await getXpAnalytics({ limit }), {
      headers: { ...headers, "cache-control": "no-store" },
    });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "XP analytics are unavailable." },
      { status: security?.status ?? 503, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
