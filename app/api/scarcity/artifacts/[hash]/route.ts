import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { readScarcityArtifact } from "@/lib/scarcity-data-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ hash: string }> }) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-artifact", limit: 60, windowMs: 60_000 }).headers;
    const { hash } = await context.params;
    const artifact = await readScarcityArtifact(hash.toLowerCase());
    if (!artifact) {
      return NextResponse.json({ error: "Source artifact not found." }, { status: 404, headers: { ...headers, "cache-control": "no-store" } });
    }
    return new NextResponse(artifact.content, {
      headers: {
        ...headers,
        "content-disposition": `attachment; filename="scarcity-${hash}.txt"`,
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "private, max-age=31536000, immutable",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Source artifact unavailable.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
