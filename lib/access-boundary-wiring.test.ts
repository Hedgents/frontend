import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function routeFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return routeFiles(child);
    return entry.name === "route.ts" ? [child] : [];
  });
}

test("Proxy strips caller attestations, rechecks durable grants, and mints a request-bound proof", () => {
  const proxySource = source("../proxy.ts");
  assert.match(proxySource, /headers\.delete\(ACCESS_ATTESTATION_HEADER\)/);
  assert.match(proxySource, /createAccessAttestation\(claims, request\.method, request\.nextUrl\.pathname\)/);
  assert.match(proxySource, /await isInviteGrantActive\(beta\.grantId, beta\.grantVersion, \{/);
  assert.match(proxySource, /now - claims\.issuedAt < 60/);
  assert.match(proxySource, /request\.method === "GET" \|\| request\.method === "HEAD"/);
  assert.match(proxySource, /cacheSafeProtectedPosts\.has\(request\.nextUrl\.pathname\)/);
  assert.match(proxySource, /useCache: !requiresFreshInviteGrant\(request, beta\)/);
  assert.match(proxySource, /export async function proxy/);
});

test("every protected API retains a handler-level access check", () => {
  const apiRoot = new URL("../app/api/", import.meta.url);
  for (const file of routeFiles(apiRoot)) {
    const pathname = file.pathname.slice(apiRoot.pathname.length);
    if (pathname.startsWith("auth/") || pathname.startsWith("cron/") || pathname === "execution/status/route.ts") continue;
    const route = readFileSync(file, "utf8");
    if (pathname.startsWith("admin/")) {
      assert.match(route, /requireAdminAccess\(request\)/, pathname);
    } else {
      assert.match(route, /requireInviteAccess\(request\)/, pathname);
    }
  }
});

test("the exact recovery capability bypasses invite state without weakening its handler", () => {
  const proxySource = source("../proxy.ts");
  assert.match(proxySource, /pathname === "\/api\/execution\/status"/);
  assert.doesNotMatch(proxySource, /pathname\.startsWith\("\/api\/execution\/status"\)/);

  const statusRoute = source("../app/api/execution/status/route.ts");
  assert.doesNotMatch(statusRoute, /requireInviteAccess/);
  assert.match(statusRoute, /secureMutation\(/);
  assert.match(statusRoute, /readJsonBody\(/);
  assert.match(statusRoute, /validateRecoveryAuthorization\(/);
  assert.match(statusRoute, /verifySolanaSettlement\([^)]*"finalized"\)/s);
});

test("production beta login issues only a twelve-hour stored grant session", () => {
  const authRoute = source("../app/api/auth/invite/route.ts");
  assert.match(authRoute, /redeemInviteCode\(body\.code\)/);
  assert.match(authRoute, /BETA_SESSION_LIFETIME_SECONDS/);
  assert.match(authRoute, /\{ id: invite\.inviteId, version: invite\.grantVersion \}/);

  const store = source("./invite-store.ts");
  assert.match(store, /process\.env\.NODE_ENV !== "production" && validateAccessCode\(code, "beta"\)/);
  assert.doesNotMatch(store, /inviteId: "legacy"/);
  assert.match(store, /useCache: options\.useCache \?\? false/);
  assert.match(store, /isInviteGrantCurrent\(index, id, sessionVersion\)/);
});

test("admin revocation is persisted before the API and UI report it", () => {
  const route = source("../app/api/admin/invites/route.ts");
  assert.match(route, /export async function PATCH/);
  assert.match(route, /secureMutation\(/);
  assert.match(route, /await revokeInviteCode\(body\.id\)/);

  const manager = source("../app/admin/InviteManager.tsx");
  const request = manager.indexOf('method: "PATCH"');
  const responseGuard = manager.indexOf("if (!response.ok || !payload.invite)", request);
  const update = manager.indexOf("setInvites((current)", responseGuard);
  assert.ok(request >= 0 && responseGuard > request && update > responseGuard);
  assert.match(manager.slice(responseGuard, update), /const durableInvite = payload\.invite/);
});
