import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit, readJsonBody, secureMutation } from "@/lib/api-security";
import { createWalletLinkChallenge, WalletLinkError } from "@/lib/xp/wallet-link";
import { linkWallet } from "@/lib/xp/store";

export const dynamic = "force-dynamic";

function fail(error: unknown, headers: Record<string, string>) {
  const security = apiSecurityError(error);
  const status = security?.status ?? (error instanceof WalletLinkError ? error.status : 400);
  const message = security?.message
    ?? (error instanceof Error ? error.message : "The wallet link could not be completed.");
  return NextResponse.json({ error: message }, { status, headers: { ...headers, ...(security?.headers ?? {}) } });
}

/** Issue a challenge for the caller's own grant. The grant is never taken from the request body. */
export async function GET(request: Request) {
  let headers: Record<string, string> = {};
  try {
    const session = requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "xp-link-challenge", limit: 20, windowMs: 60_000 }).headers;
    const wallet = new URL(request.url).searchParams.get("wallet") ?? "";
    const challenge = createWalletLinkChallenge({ granteeId: session.grantId, wallet });
    return NextResponse.json(challenge, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    return fail(error, headers);
  }
}

export async function POST(request: Request) {
  let headers: Record<string, string> = {};
  try {
    const session = requireInviteAccess(request);
    // Same-origin, bounded body and rate limit in one, matching every other mutation route.
    headers = secureMutation(request, { key: "xp-link-submit", limit: 10, windowMs: 60_000 }).headers;
    const body = await readJsonBody(request);
    const link = await linkWallet({
      // Taken from the session, never the body: a caller must not be able to link a wallet to
      // someone else's invite by naming it.
      granteeId: session.grantId,
      wallet: String(body.wallet ?? ""),
      nonce: String(body.nonce ?? ""),
      expiresAt: String(body.expiresAt ?? ""),
      proof: String(body.proof ?? ""),
      signature: String(body.signature ?? ""),
    });
    return NextResponse.json({ linked: link }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    return fail(error, headers);
  }
}
