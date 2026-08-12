import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/access-auth";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { recordAward } from "@/lib/xp/store";
import { XP_AWARDS } from "@/lib/xp/rules";

export const dynamic = "force-dynamic";

/**
 * Operator award for a contribution with no on-chain trace, principally a reproduced defect.
 * Deliberately the only way XP enters the system that is not derived from the chain, and it is
 * admin-gated, idempotent by id, and always carries a stated reason.
 */
export async function POST(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = secureMutation(request, { key: "xp-award", limit: 30, windowMs: 60_000 }).headers;
    const body = await readJsonBody(request);
    const cluster = body.cluster === "mainnet-beta" ? "mainnet-beta" : "devnet";
    const award = await recordAward({
      id: typeof body.id === "string" && body.id.trim() ? body.id.trim() : randomUUID(),
      granteeId: String(body.granteeId ?? ""),
      cluster,
      points: Number.isInteger(body.points) ? Number(body.points) : XP_AWARDS.verifiedReport,
      reason: String(body.reason ?? ""),
    });
    return NextResponse.json({ award }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "The award could not be recorded.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
