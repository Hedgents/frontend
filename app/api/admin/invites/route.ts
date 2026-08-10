import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/access-auth";
import { ApiSecurityError } from "@/lib/api-security";
import { apiSecurityError, enforceRateLimit, readJsonBody, secureMutation } from "@/lib/api-security";
import { createInviteCode, listInviteCodes, revokeInviteCode } from "@/lib/invite-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = enforceRateLimit(request, { key: "admin-invites-list", limit: 60, windowMs: 60_000 }).headers;
    const invites = await listInviteCodes();
    return NextResponse.json({ invites }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "Invite codes could not be loaded." },
      { status: security?.status ?? 500, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}

export async function POST(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = secureMutation(request, { key: "admin-invites-create", limit: 20, windowMs: 3_600_000 }, 256).headers;
    await readJsonBody(request, 256);
    const generated = await createInviteCode();
    return NextResponse.json(generated, { status: 201, headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "A new invite code could not be generated." },
      { status: security?.status ?? 500, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}

export async function PATCH(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = secureMutation(request, { key: "admin-invites-revoke", limit: 40, windowMs: 3_600_000 }, 512).headers;
    const body = await readJsonBody(request, 512);
    if (typeof body.id !== "string") throw new ApiSecurityError("Invite identifier is required.", 400);
    const invite = await revokeInviteCode(body.id);
    return NextResponse.json({ invite }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "The invite code could not be revoked." },
      { status: security?.status ?? 500, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
