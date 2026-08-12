import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAward,
  applyWalletLink,
  emptyXpIndex,
  MAX_WALLETS_PER_GRANT,
  pruneConsumedNonces,
  validateXpIndex,
} from "./index-ops";
import { WalletLinkError, type VerifiedWalletLink } from "./wallet-link";

const NOW = new Date("2026-08-12T12:00:00.000Z");
let counter = 0;
function verified(granteeId: string, wallet: string): VerifiedWalletLink {
  counter += 1;
  return { granteeId, wallet, nonce: `nonce-${counter}`, linkedAt: NOW.toISOString() };
}

test("a verified link is recorded and its nonce is burned", () => {
  const index = emptyXpIndex();
  const link = applyWalletLink(index, verified("invite-1", "wallet-A"), NOW);
  assert.equal(link.granteeId, "invite-1");
  assert.equal(index.links.length, 1);
  assert.equal(index.consumedNonces.length, 1);
});

test("a captured signature cannot be replayed", () => {
  const index = emptyXpIndex();
  const attempt = verified("invite-1", "wallet-A");
  applyWalletLink(index, attempt, NOW);
  assert.throws(
    () => applyWalletLink(index, attempt, NOW),
    (error: WalletLinkError) => error.status === 409 && /already been used/.test(error.message),
  );
  assert.equal(index.links.length, 1);
});

test("a wallet cannot be claimed by a second invite", () => {
  // A wallet counted under two invites would have its positions scored twice, which is exactly the
  // attack a future distribution invites.
  const index = emptyXpIndex();
  applyWalletLink(index, verified("invite-1", "wallet-A"), NOW);
  assert.throws(
    () => applyWalletLink(index, verified("invite-2", "wallet-A"), NOW),
    (error: WalletLinkError) => error.status === 409 && /another invite/.test(error.message),
  );
  assert.equal(index.links.filter((link) => link.granteeId === "invite-2").length, 0);
});

test("re-linking a wallet the invite already holds is a no-op that still burns the nonce", () => {
  const index = emptyXpIndex();
  applyWalletLink(index, verified("invite-1", "wallet-A"), NOW);
  const again = verified("invite-1", "wallet-A");
  applyWalletLink(index, again, NOW);
  assert.equal(index.links.length, 1);
  assert.throws(() => applyWalletLink(index, again, NOW), WalletLinkError);
});

test("an invite links several wallets up to a cap", () => {
  const index = emptyXpIndex();
  for (let n = 0; n < MAX_WALLETS_PER_GRANT; n += 1) {
    applyWalletLink(index, verified("invite-1", `wallet-${n}`), NOW);
  }
  assert.equal(index.links.length, MAX_WALLETS_PER_GRANT);
  assert.throws(
    () => applyWalletLink(index, verified("invite-1", "one-too-many"), NOW),
    (error: WalletLinkError) => error.status === 409 && /at most/.test(error.message),
  );
});

test("the cap is per invite, not global", () => {
  const index = emptyXpIndex();
  for (let n = 0; n < MAX_WALLETS_PER_GRANT; n += 1) {
    applyWalletLink(index, verified("invite-1", `a-${n}`), NOW);
  }
  assert.doesNotThrow(() => applyWalletLink(index, verified("invite-2", "b-0"), NOW));
});

test("consumed nonces are pruned once they can no longer be replayed", () => {
  const index = emptyXpIndex();
  applyWalletLink(index, verified("invite-1", "wallet-A"), NOW);
  const muchLater = new Date(NOW.getTime() + 48 * 3_600_000);
  pruneConsumedNonces(index, muchLater);
  assert.equal(index.consumedNonces.length, 0);
  // Pruning must not drop the links themselves.
  assert.equal(index.links.length, 1);
});

test("awards are idempotent by id and require an invite, points and a reason", () => {
  const index = emptyXpIndex();
  const base = { granteeId: "invite-1", cluster: "devnet" as const, reason: "reproduced a defect", now: NOW };
  applyAward(index, { ...base, id: "report-1", points: 500 });
  assert.equal(index.awards.length, 1);
  assert.throws(() => applyAward(index, { ...base, id: "report-1", points: 500 }), WalletLinkError);
  assert.throws(() => applyAward(index, { ...base, id: "a", points: 0 }), WalletLinkError);
  assert.throws(() => applyAward(index, { ...base, id: "b", points: -5 }), WalletLinkError);
  assert.throws(() => applyAward(index, { ...base, id: "c", points: 1.5 }), WalletLinkError);
  assert.throws(() => applyAward(index, { ...base, id: "d", points: 99_999 }), WalletLinkError);
  assert.throws(() => applyAward(index, { ...base, id: "e", points: 100, reason: "  " }), WalletLinkError);
  assert.throws(() => applyAward(index, { ...base, id: "f", points: 100, granteeId: "" }), WalletLinkError);
  assert.equal(index.awards.length, 1);
});

test("a corrupt or unknown-version index reads as empty rather than throwing", () => {
  assert.deepEqual(validateXpIndex(null), emptyXpIndex());
  assert.deepEqual(validateXpIndex({ version: 99 }), emptyXpIndex());
  assert.deepEqual(validateXpIndex([1, 2, 3]), emptyXpIndex());
  const partial = validateXpIndex({ version: 1, links: [{ wallet: "A" }, { wallet: "B", granteeId: "i", linkedAt: "t" }] });
  assert.equal(partial.links.length, 1);
});
