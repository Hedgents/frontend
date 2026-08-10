import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { readMetalPulseResolution } from "@/lib/metal-pulse-evidence-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ hash: string }> }) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-pulse-resolution", limit: 60, windowMs: 60_000 }).headers;
    const { hash } = await context.params;
    const content = await readMetalPulseResolution(hash.toLowerCase());
    if (content === null) return NextResponse.json({ error: "Metal Pulse resolution report not found." }, { status: 404, headers: { ...headers, "cache-control": "no-store" } });
    return new NextResponse(content, {
      headers: {
        ...headers,
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, max-age=31536000, immutable",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Metal Pulse resolution report unavailable.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
