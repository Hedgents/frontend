import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  BETA_COOKIE,
  verifyAccessSession,
} from "@/lib/access-auth";

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

function continueWithPageSecurity(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const connectOrigins = [...new Set([
    "https://api.mainnet-beta.solana.com",
    "https://api.devnet.solana.com",
    "https://eth.merkle.io",
    "https://mainnet.base.org",
    "https://bsc-dataseed1.binance.org",
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
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const beta = verifyAccessSession(request.cookies.get(BETA_COOKIE)?.value, "beta");
  const admin = verifyAccessSession(request.cookies.get(ADMIN_COOKIE)?.value, "admin");

  if (pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    if (pathname.startsWith("/api/admin/") && !admin) {
      return NextResponse.json({ error: "Administrator access is required." }, { status: 401 });
    }
    if (!beta && !admin) {
      return NextResponse.json({ error: "A valid beta invite is required." }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (publicPaths.has(pathname)) {
    if (pathname === "/access" && (beta || admin)) return NextResponse.redirect(new URL("/", request.url));
    if (pathname === "/admin/login" && admin) return NextResponse.redirect(new URL("/admin", request.url));
    return continueWithPageSecurity(request);
  }
  if (pathname.startsWith("/admin") && !admin) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  if (!beta && !admin) {
    const access = new URL("/access", request.url);
    access.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(access);
  }
  return continueWithPageSecurity(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
