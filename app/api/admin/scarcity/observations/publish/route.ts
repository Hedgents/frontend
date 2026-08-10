import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/access-auth";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { publishScarcityObservationBatch } from "@/lib/scarcity-data-store";
import type { ScarcityObservationBatch } from "@/lib/scarcity";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = secureMutation(request, {
      key: "scarcity-observation-publish",
      limit: 12,
      windowMs: 3_600_000,
    }, 1_200_000).headers;
    const body = await readJsonBody(request, 1_200_000);
    const published = await publishScarcityObservationBatch(body.batch as unknown as ScarcityObservationBatch);
    return NextResponse.json(published, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Observation batch could not be published.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
