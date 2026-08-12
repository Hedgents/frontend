import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { getXpProfile } from "@/lib/xp/profile";

export const dynamic = "force-dynamic";

/** A tester can only ever read their own profile; the grant comes from the session. */
export async function GET(request: Request) {
  let headers: Record<string, string> = {};
  try {
    const session = requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "xp-profile", limit: 60, windowMs: 60_000 }).headers;
    const profile = await getXpProfile(session.grantId);
    return NextResponse.json(profile, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "XP is unavailable." },
      { status: security?.status ?? 503, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
