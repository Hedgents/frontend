import assert from "node:assert/strict";
import test from "node:test";
import { createAccessSession, readAccessSession, verifyAccessSession } from "./access-auth";
import {
  isInviteGrantCurrent,
  revokeInviteInIndex,
  validateInviteIndex,
} from "./invite-registry";

const legacyInvite = {
  id: "ABCDEF123456",
  hash: "a".repeat(64),
  createdAt: "2026-08-10T10:00:00.000Z",
  redemptions: 2,
  lastRedeemedAt: "2026-08-10T11:00:00.000Z",
  active: true,
};

test("migrates a valid v1 invite index to revocable v2 grants", () => {
  const migrated = validateInviteIndex({ version: 1, invites: [legacyInvite] });
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.invites[0], {
    ...legacyInvite,
    revokedAt: null,
    sessionVersion: 1,
  });
  assert.equal(isInviteGrantCurrent(migrated, legacyInvite.id, 1), true);
});

test("revocation is one-way, invalidates the issued version, and is idempotent", () => {
  const index = validateInviteIndex({ version: 1, invites: [legacyInvite] });
  const session = createAccessSession("beta", 60, { id: legacyInvite.id, version: 1 });
  const claims = readAccessSession(session, "beta");
  assert.ok(claims);
  assert.equal(isInviteGrantCurrent(index, claims.grantId, claims.grantVersion), true);
  const first = revokeInviteInIndex(index, legacyInvite.id, "2026-08-10T12:00:00.000Z");
  assert.equal(first?.active, false);
  assert.equal(first?.sessionVersion, 2);
  assert.equal(first?.revokedAt, "2026-08-10T12:00:00.000Z");
  assert.equal(isInviteGrantCurrent(index, legacyInvite.id, 1), false);
  assert.equal(isInviteGrantCurrent(index, legacyInvite.id, 2), false);
  // The signed cookie remains cryptographically intact, but its durable grant
  // is invalid on the very next active/version check.
  assert.equal(verifyAccessSession(session, "beta"), true);
  assert.equal(isInviteGrantCurrent(index, claims.grantId, claims.grantVersion), false);

  const repeated = revokeInviteInIndex(index, legacyInvite.id, "2026-08-10T13:00:00.000Z");
  assert.equal(repeated?.active, false);
  assert.equal(repeated?.sessionVersion, 2);
  assert.equal(repeated?.revokedAt, "2026-08-10T12:00:00.000Z");
});

test("rejects malformed v2 records instead of silently reactivating them", () => {
  assert.throws(() => validateInviteIndex({
    version: 2,
    invites: [{ ...legacyInvite, active: false, revokedAt: null, sessionVersion: 2 }],
  }), /v2 integrity/);
});
