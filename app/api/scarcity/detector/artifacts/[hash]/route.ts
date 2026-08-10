import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { readOnlineDetectorArtifact } from "@/lib/scarcity-detector-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ hash: string }> }) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-detector-artifact", limit: 60, windowMs: 60_000 }).headers;
    const artifact = await readOnlineDetectorArtifact((await params).hash);
    if (!artifact) return NextResponse.json({ error: "Artifact not found." }, { status: 404, headers });
    return new Response(artifact.content, {
      headers: {
        ...headers,
        "cache-control": "private, max-age=31536000, immutable",
        "content-disposition": `attachment; filename="detector-${(await params).hash}.txt"`,
        "content-security-policy": "default-src 'none'; sandbox",
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "Artifact is unavailable." },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
