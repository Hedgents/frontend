import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_ATTESTATION_HEADER,
  ADMIN_COOKIE,
  BETA_COOKIE,
  createAccessAttestation,
  readAccessSession,
  type AccessSessionClaims,
} from "@/lib/access-auth";
import { CCTP_ATTESTATION_ORIGIN } from "@/lib/rail-cctp";
import { isInviteGrantActive } from "@/lib/invite-store";

const publicPaths = new Set(["/access", "/admin/login"]);

function configuredConnectOrigins() {
  const values = [
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL,
  ];
  return values.flatMap((value) => {
    if (!value) return [];
    try {
      return [new URL(value).origin];
    } catch {
      return [];
    }
  });
}

function forwardedHeaders(request: NextRequest, claims?: AccessSessionClaims | null) {
  const headers = new Headers(request.headers);
  // Never trust a browser-supplied internal proof. Proxy is the only component
  // allowed to mint this short-lived, request-bound attestation after checking
  // the durable invite grant.
  headers.delete(ACCESS_ATTESTATION_HEADER);
  if (claims?.role === "beta") {
    headers.set(
      ACCESS_ATTESTATION_HEADER,
      createAccessAttestation(claims, request.method, request.nextUrl.pathname),
    );
  }
  return headers;
}

function continueRequest(request: NextRequest, claims?: AccessSessionClaims | null) {
  return NextResponse.next({ request: { headers: forwardedHeaders(request, claims) } });
}

function continueWithPageSecurity(request: NextRequest, claims?: AccessSessionClaims | null) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const connectOrigins = [...new Set([
    "https://api.mainnet-beta.solana.com",
    "https://api.devnet.solana.com",
    "https://eth.merkle.io",
    "https://mainnet.base.org",
    "https://bsc-dataseed1.binance.org",
    // Circle's attestation service. Required even while HEDGENTS_RAIL_FUNDING_ENABLED is false:
    // verifying a source burn that was already broadcast is deliberately not gated by the flag.
    CCTP_ATTESTATION_ORIGIN,
    ...configuredConnectOrigins(),
  ])].join(" ");
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self' ${connectOrigins}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    isDev ? "" : "upgrade-insecure-requests",
  ].filter(Boolean).join("; ");
  const requestHeaders = forwardedHeaders(request, claims);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

function inviteStoreUnavailable(pathname: string) {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Beta access could not be verified because the invite registry is unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  return new NextResponse("Beta access could not be verified. Please try again shortly.", {
    status: 503,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
}

const cacheSafeProtectedPosts = new Set([
  "/api/execution/compare",
  "/api/telemetry",
]);

function requiresFreshInviteGrant(request: NextRequest, claims: AccessSessionClaims) {
  // Read-only terminal traffic may use the private Blob CDN's one-minute
  // cache. New sessions and every present/future mutation are origin-fresh by
  // default; only two explicitly non-funds, non-privileged POST routes are
  // exceptions.
  // This prevents a later write route from silently inheriting a revocation
  // delay while avoiding origin reads for every quote poll or page request.
  const now = Math.floor(Date.now() / 1_000);
  if (now - claims.issuedAt < 60) return true;
  if (request.method === "GET" || request.method === "HEAD") return false;
  return !cacheSafeProtectedPosts.has(request.nextUrl.pathname);
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const beta = readAccessSession(request.cookies.get(BETA_COOKIE)?.value, "beta");
  const admin = readAccessSession(request.cookies.get(ADMIN_COOKIE)?.value, "admin");

  if (pathname.startsWith("/api/auth/")) return continueRequest(request);
  if (pathname.startsWith("/api/cron/")) return continueRequest(request);
  // Recovery is a possession-based capability. Keep this exact route usable
  // after logout/revocation while its handler independently enforces origin,
  // body/rate limits, a signed recovery token, and finalized chain settlement.
  if (pathname === "/api/execution/status") return continueRequest(request);
  // Operator login must remain reachable even if a stale beta cookie is
  // present while invite storage is unavailable.
  if (pathname === "/admin/login") {
    if (admin) return NextResponse.redirect(new URL("/admin", request.url));
    return continueWithPageSecurity(request);
  }

  let activeBeta: AccessSessionClaims | null = null;
  if (!admin && beta) {
    try {
      if (await isInviteGrantActive(beta.grantId, beta.grantVersion, {
        useCache: !requiresFreshInviteGrant(request, beta),
      })) activeBeta = beta;
    } catch {
      return inviteStoreUnavailable(pathname);
    }
  }

  if (pathname.startsWith("/api/")) {
    if (pathname.startsWith("/api/admin/") && !admin) {
      return NextResponse.json({ error: "Administrator access is required." }, { status: 401 });
    }
    if (!activeBeta && !admin) {
      return NextResponse.json({ error: "A valid beta invite is required." }, { status: 401 });
    }
    return continueRequest(request, activeBeta ?? admin);
  }

  if (publicPaths.has(pathname)) {
    if (pathname === "/access" && (activeBeta || admin)) return NextResponse.redirect(new URL("/", request.url));
    return continueWithPageSecurity(request);
  }
  if (pathname.startsWith("/admin") && !admin) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  if (!activeBeta && !admin) {
    const access = new URL("/access", request.url);
    access.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(access);
  }
  return continueWithPageSecurity(request, activeBeta ?? admin);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
