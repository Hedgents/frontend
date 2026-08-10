import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/access-auth";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { reviewOnlineDetectorEvidence } from "@/lib/scarcity-detector-store";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = secureMutation(request, { key: "scarcity-detector-evidence-review", limit: 60, windowMs: 3_600_000 }).headers;
    const body = await readJsonBody(request);
    const decision = body.decision;
    if (decision !== "approved" && decision !== "rejected") throw new Error("Decision must be approved or rejected.");
    const result = await reviewOnlineDetectorEvidence({
      evidenceId: (await params).id,
      decision,
      reviewer: typeof body.reviewer === "string" ? body.reviewer : "",
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    return NextResponse.json(result, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Evidence review failed.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
