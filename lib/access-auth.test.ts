import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ADMIN_COOKIE,
  BETA_COOKIE,
  createAccessSession,
  hasAdminAccess,
  hasInviteAccess,
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
  const beta = createAccessSession("beta", 60);
  assert.equal(verifyAccessSession(beta, "beta"), true);
  assert.equal(verifyAccessSession(beta, "admin"), false);
  assert.equal(verifyAccessSession(`${beta}x`, "beta"), false);
});

test("admin sessions can enter the terminal but beta sessions cannot enter admin", () => {
  const admin = createAccessSession("admin", 60);
  const beta = createAccessSession("beta", 60);
  assert.equal(hasInviteAccess(new Request("https://terminal.test", { headers: { cookie: `${ADMIN_COOKIE}=${admin}` } })), true);
  assert.equal(hasAdminAccess(new Request("https://terminal.test", { headers: { cookie: `${BETA_COOKIE}=${beta}` } })), false);
});
