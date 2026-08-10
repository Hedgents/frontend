import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { readResolutionReport } from "@/lib/scarcity-resolution-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ hash: string }> }) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-resolution-read", limit: 120, windowMs: 60_000 }).headers;
    const { hash } = await params;
    const report = await readResolutionReport(hash);
    if (!report) return NextResponse.json({ error: "Resolution report not found." }, { status: 404, headers });
    return new NextResponse(report, { headers: { ...headers, "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=60" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "Resolution report is unavailable." },
      { status: security?.status ?? 500, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
