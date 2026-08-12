import assert from "node:assert/strict";
import test from "node:test";
import { deriveXpRounds, type WalletPortfolio } from "./derive";
import { buildXpProfile, scoreRound } from "./rules";

function position(overrides: Partial<WalletPortfolio["positions"][number]> = {}) {
  return {
    slug: "lithium-tightness-2026-09-curve-v1",
    bucket: 20,
    stake: "100000000",
    claimed: false,
    status: "resolved" as const,
    winningBucket: 20,
    bucketCount: 41,
    ...overrides,
  };
}

test("positions from several wallets fold into one round before scoring", () => {
  // Splitting a spray across wallets must not let someone collect the focused score on whichever
  // wallet landed nearest. Folding first is what prevents that.
  const rounds = deriveXpRounds([
    { wallet: "A", cluster: "devnet", positions: [position({ bucket: 0 })] },
    { wallet: "B", cluster: "devnet", positions: [position({ bucket: 40 })] },
  ]);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].positions.length, 2);
  const scored = scoreRound(rounds[0]);
  assert.equal(scored.effectiveBucket, 20);

  // Both legs sit twenty buckets from the winner, so straddling must not score like a direct hit.
  const focused = scoreRound(
    deriveXpRounds([{ wallet: "A", cluster: "devnet", positions: [position({ bucket: 20 })] }])[0],
  );
  assert.ok(scored.accuracy < focused.accuracy, `${scored.accuracy} should be under ${focused.accuracy}`);
  assert.equal(focused.accuracy, 200);
  assert.equal(scored.accuracy, 100);
});

test("the same round on different clusters stays separate", () => {
  const rounds = deriveXpRounds([
    { wallet: "A", cluster: "devnet", positions: [position()] },
    { wallet: "A", cluster: "mainnet-beta", positions: [position()] },
  ]);
  assert.equal(rounds.length, 2);
  const profile = buildXpProfile({ granteeId: "invite-1", rounds, awards: [] });
  assert.ok(profile.byCluster.devnet > 0);
  assert.ok(profile.byCluster["mainnet-beta"] > 0);
});

test("an unresolved round carries no winning bucket even though the account reports one", () => {
  const rounds = deriveXpRounds([
    { wallet: "A", cluster: "devnet", positions: [position({ status: "unresolved", winningBucket: 7 })] },
  ]);
  assert.equal(rounds[0].winningBucket, null);
  assert.equal(scoreRound(rounds[0]).total, 0);
});

test("an invalid round carries no winning bucket and earns participation only", () => {
  const rounds = deriveXpRounds([
    { wallet: "A", cluster: "devnet", positions: [position({ status: "invalid", winningBucket: 3, claimed: true })] },
  ]);
  assert.equal(rounds[0].winningBucket, null);
  const scored = scoreRound(rounds[0]);
  assert.equal(scored.accuracy, 0);
  assert.ok(scored.participation > 0);
});

test("a round whose positions disagree about its state is dropped rather than guessed at", () => {
  const rounds = deriveXpRounds([
    { wallet: "A", cluster: "devnet", positions: [position({ winningBucket: 20 })] },
    { wallet: "B", cluster: "devnet", positions: [position({ winningBucket: 31 })] },
  ]);
  assert.equal(rounds.length, 0);
});

test("a malformed stake is treated as zero rather than throwing", () => {
  const rounds = deriveXpRounds([
    { wallet: "A", cluster: "devnet", positions: [position({ stake: "not-a-number" })] },
  ]);
  assert.equal(rounds[0].positions[0].stake, 0n);
  assert.equal(scoreRound(rounds[0]).total, 0);
});

test("no positions produces no rounds and an empty profile that still discloses", () => {
  const rounds = deriveXpRounds([{ wallet: "A", cluster: "devnet", positions: [] }]);
  assert.equal(rounds.length, 0);
  const profile = buildXpProfile({ granteeId: "invite-1", rounds, awards: [] });
  assert.equal(profile.total, 0);
  assert.match(profile.disclosure, /not a token/);
});
