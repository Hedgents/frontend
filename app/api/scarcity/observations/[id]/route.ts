import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { getScarcityObservation } from "@/lib/scarcity-data-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-observation", limit: 120, windowMs: 60_000 }).headers;
    const { id } = await context.params;
    const observation = await getScarcityObservation(decodeURIComponent(id));
    if (!observation) {
      return NextResponse.json({ error: "Observation not found." }, { status: 404, headers: { ...headers, "cache-control": "no-store" } });
    }
    return NextResponse.json({ observation }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Observation unavailable.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
