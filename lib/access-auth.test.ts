import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import {
  ADMIN_COOKIE,
  ACCESS_ATTESTATION_HEADER,
  BETA_COOKIE,
  BETA_SESSION_LIFETIME_SECONDS,
  createAccessAttestation,
  createAccessSession,
  hasAdminAccess,
  hasInviteAccess,
  readAccessSession,
  requireInviteAccess,
  safeLocalRedirectPath,
  validateAccessCode,
  verifyAccessSession,
} from "./access-auth";

const original = {
  auth: process.env.HEDGENTS_AUTH_SECRET,
  invite: process.env.HEDGENTS_INVITE_CODE_HASH,
  admin: process.env.HEDGENTS_ADMIN_CODE_HASH,
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test.before(() => {
  process.env.HEDGENTS_AUTH_SECRET = "a-test-secret-that-is-long-enough";
  process.env.HEDGENTS_INVITE_CODE_HASH = hash("beta-test-2026");
  process.env.HEDGENTS_ADMIN_CODE_HASH = hash("admin-test-2026");
});

test("keeps post-auth redirects on the terminal origin", () => {
  assert.equal(safeLocalRedirectPath("/scarcity?metal=gold#market"), "/scarcity?metal=gold#market");
  assert.equal(safeLocalRedirectPath("//attacker.example"), "/");
  assert.equal(safeLocalRedirectPath("/\\attacker.example"), "/");
  assert.equal(safeLocalRedirectPath("https://attacker.example"), "/");
});

test.after(() => {
  if (original.auth === undefined) delete process.env.HEDGENTS_AUTH_SECRET; else process.env.HEDGENTS_AUTH_SECRET = original.auth;
  if (original.invite === undefined) delete process.env.HEDGENTS_INVITE_CODE_HASH; else process.env.HEDGENTS_INVITE_CODE_HASH = original.invite;
  if (original.admin === undefined) delete process.env.HEDGENTS_ADMIN_CODE_HASH; else process.env.HEDGENTS_ADMIN_CODE_HASH = original.admin;
});

test("validates only the code assigned to each role", () => {
  assert.equal(validateAccessCode("beta-test-2026", "beta"), true);
  assert.equal(validateAccessCode("admin-test-2026", "beta"), false);
  assert.equal(validateAccessCode("admin-test-2026", "admin"), true);
});

test("signs role-scoped sessions and rejects tampering", () => {
  const beta = createAccessSession("beta", 60, { id: "ABCDEF123456", version: 7 });
  assert.equal(verifyAccessSession(beta, "beta"), true);
  assert.equal(verifyAccessSession(beta, "admin"), false);
  assert.equal(verifyAccessSession(`${beta}x`, "beta"), false);
  assert.deepEqual(readAccessSession(beta, "beta") && {
    grantId: readAccessSession(beta, "beta")?.grantId,
    grantVersion: readAccessSession(beta, "beta")?.grantVersion,
  }, { grantId: "ABCDEF123456", grantVersion: 7 });
});

test("admin sessions can enter the terminal but beta sessions cannot enter admin", () => {
  const admin = createAccessSession("admin", 60);
  const beta = createAccessSession("beta", 60);
  assert.equal(hasInviteAccess(new Request("https://terminal.test", { headers: { cookie: `${ADMIN_COOKIE}=${admin}` } })), true);
  assert.equal(hasAdminAccess(new Request("https://terminal.test", { headers: { cookie: `${BETA_COOKIE}=${beta}` } })), false);
});

test("beta sessions are bounded to twelve hours", () => {
  assert.throws(
    () => createAccessSession("beta", BETA_SESSION_LIFETIME_SECONDS + 1, { id: "ABCDEF123456", version: 1 }),
    /cannot exceed 12 hours/,
  );
});

test("route handlers require a request-bound Proxy attestation for beta sessions", () => {
  const session = createAccessSession("beta", 60, { id: "ABCDEF123456", version: 1 });
  const claims = readAccessSession(session, "beta");
  assert.ok(claims);
  const cookie = `${BETA_COOKIE}=${encodeURIComponent(session)}`;
  assert.throws(
    () => requireInviteAccess(new Request("https://terminal.test/api/scarcity/metals", { headers: { cookie } })),
    /valid beta invite/,
  );

  const attestation = createAccessAttestation(claims, "GET", "/api/scarcity/metals");
  const authorized = new Request("https://terminal.test/api/scarcity/metals?metal=Au", {
    headers: { cookie, [ACCESS_ATTESTATION_HEADER]: attestation },
  });
  assert.equal(requireInviteAccess(authorized).sessionId, claims.sessionId);

  const wrongPath = new Request("https://terminal.test/api/scarcity/signals", {
    headers: { cookie, [ACCESS_ATTESTATION_HEADER]: attestation },
  });
  assert.throws(() => requireInviteAccess(wrongPath), /valid beta invite/);
});

test("legacy beta cookies fail closed while existing administrator cookies remain valid", () => {
  const secret = process.env.HEDGENTS_AUTH_SECRET as string;
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  const sessionId = randomUUID();
  const legacy = (role: "beta" | "admin") => {
    const payload = `${role}.${expiresAt}.${sessionId}`;
    return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
  };
  assert.equal(verifyAccessSession(legacy("beta"), "beta"), false);
  assert.equal(verifyAccessSession(legacy("admin"), "admin"), true);
});
