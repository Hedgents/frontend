import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/access-auth";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { publishResolutionReport } from "@/lib/scarcity-resolution-store";
import type { ResolutionReport } from "@/lib/scarcity-markets";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = secureMutation(request, { key: "scarcity-resolution-publish", limit: 12, windowMs: 3_600_000 }, 128_000).headers;
    const body = await readJsonBody(request, 128_000);
    const published = await publishResolutionReport(body.report as unknown as ResolutionReport);
    return NextResponse.json(published, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Resolution report could not be published.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
