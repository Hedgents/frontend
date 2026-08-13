import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { grantDevnetTestFunds, readDevnetTestBalances } from "@/lib/devnet-faucet";

export const dynamic = "force-dynamic";

/**
 * Devnet test funds for an invited tester.
 *
 * GET reports what a wallet holds so the button can say whether asking would do anything. POST
 * grants. Both are invite-gated and rate limited, and the grant itself is capped by balance rather
 * than by frequency, so the limit here is about protecting the RPC rather than the float.
 */
export async function GET(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "faucet-read", limit: 60, windowMs: 60_000 }).headers;
    const wallet = new URL(request.url).searchParams.get("wallet");
    const balances = await readDevnetTestBalances({ wallet: wallet ?? undefined });
    return NextResponse.json(
      balances ?? { cluster: null, unavailable: true },
      { headers: { ...headers, "cache-control": "no-store" } },
    );
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "Test balances are unavailable." },
      { status: security?.status ?? 503, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}

export async function POST(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "faucet-grant", limit: 12, windowMs: 60_000 }).headers;
    const body = (await request.json().catch(() => null)) as { wallet?: unknown } | null;
    const grant = await grantDevnetTestFunds({ wallet: body?.wallet });
    return NextResponse.json(grant, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "Test funds could not be sent." },
      { status: security?.status ?? 503, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
