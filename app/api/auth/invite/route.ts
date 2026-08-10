import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  BETA_COOKIE,
  BETA_SESSION_LIFETIME_SECONDS,
  createAccessSession,
  SESSION_COOKIE_OPTIONS,
  validateAccessCode,
} from "@/lib/access-auth";
import { recordAnalyticsEvent } from "@/lib/analytics-store";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { redeemInviteCode } from "@/lib/invite-store";

export async function POST(request: Request) {
  let headers: Record<string, string> = {};
  try {
    headers = secureMutation(request, { key: "invite-auth", limit: 12, windowMs: 10 * 60_000 }, 1_024).headers;
    const body = await readJsonBody(request, 1_024);

    // The public gate is the front door for both beta users and operators. An
    // administrator should not need a separate login before opening the normal
    // terminal, so promote a valid admin code directly to an admin session.
    if (validateAccessCode(body.code, "admin")) {
      const response = NextResponse.json({ ok: true }, { headers: { ...headers, "cache-control": "no-store" } });
      response.cookies.set(ADMIN_COOKIE, createAccessSession("admin", 12 * 3_600), {
        ...SESSION_COOKIE_OPTIONS,
        maxAge: 12 * 3_600,
      });
      return response;
    }

    const invite = await redeemInviteCode(body.code);
    if (!invite.valid) {
      return NextResponse.json({ error: "That invite code is not valid." }, { status: 401, headers });
    }
    const response = NextResponse.json({ ok: true }, { headers: { ...headers, "cache-control": "no-store" } });
    if (!invite.inviteId || !invite.grantVersion) {
      throw new Error("Invite grant metadata is missing.");
    }
    response.cookies.set(BETA_COOKIE, createAccessSession(
      "beta",
      BETA_SESSION_LIFETIME_SECONDS,
      { id: invite.inviteId, version: invite.grantVersion },
    ), {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: BETA_SESSION_LIFETIME_SECONDS,
    });
    await recordAnalyticsEvent("invite_access_granted", randomUUID()).catch(() => undefined);
    return response;
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "The invite could not be verified." },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
