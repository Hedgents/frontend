import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/access-auth";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { publishReviewedDetectorCandidate } from "@/lib/scarcity-market-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = secureMutation(request, { key: "scarcity-candidate-publication", limit: 20, windowMs: 3_600_000 }).headers;
    const body = await readJsonBody(request);
    const result = await publishReviewedDetectorCandidate({
      candidateId: (await params).id,
      reviewer: typeof body.reviewer === "string" ? body.reviewer : "",
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200, headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Candidate publication failed.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
