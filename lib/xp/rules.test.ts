import assert from "node:assert/strict";
import test from "node:test";
import {
  buildXpProfile,
  effectiveBucket,
  MAXIMUM_RETURNING_ROUNDS,
  MAXIMUM_ROUND_XP,
  scoreRound,
  XP_AWARDS,
  XP_DISCLOSURE,
  type XpRound,
} from "./rules";

function round(overrides: Partial<XpRound> = {}): XpRound {
  return {
    roundSlug: "lithium-tightness-2026-09-curve-v1",
    cluster: "devnet",
    bucketCount: 41,
    status: "resolved",
    winningBucket: 20,
    positions: [{ bucket: 20, stake: 100n, claimed: true }],
    ...overrides,
  } as XpRound;
}

test("a perfect forecast held to settlement and claimed earns the round maximum", () => {
  const scored = scoreRound(round());
  assert.equal(scored.participation, XP_AWARDS.participation);
  assert.equal(scored.accuracy, XP_AWARDS.accuracyMaximum);
  assert.equal(scored.settlementClaim, XP_AWARDS.settlementClaim);
  assert.equal(scored.total, MAXIMUM_ROUND_XP);
});

test("accuracy falls to zero at the furthest bucket and never goes negative", () => {
  const far = scoreRound(round({ positions: [{ bucket: 40, stake: 100n, claimed: false }], winningBucket: 0 }));
  assert.equal(far.accuracy, 0);
  assert.equal(far.participation, XP_AWARDS.participation);
  assert.equal(far.settlementClaim, 0);
  assert.equal(far.total, XP_AWARDS.participation);
});

test("spraying the whole grid scores like the middle, not like the winner", () => {
  // Devnet collateral is free, so without this a tester covers every bucket and collects the
  // maximum every round. The stake-weighted mean lands them in the centre instead.
  const everywhere = Array.from({ length: 41 }, (_, bucket) => ({ bucket, stake: 10n, claimed: true }));
  const sprayed = scoreRound(round({ positions: everywhere, winningBucket: 40 }));
  const focused = scoreRound(round({ positions: [{ bucket: 40, stake: 410n, claimed: true }], winningBucket: 40 }));
  assert.equal(sprayed.effectiveBucket, 20);
  assert.ok(sprayed.accuracy < focused.accuracy);
  // Half credit at the midpoint, not full.
  assert.ok(sprayed.accuracy > 0 && sprayed.accuracy < XP_AWARDS.accuracyMaximum / 2 + 1);
});

test("stake size cannot buy XP", () => {
  const small = scoreRound(round({ positions: [{ bucket: 20, stake: 1n, claimed: true }] }));
  const enormous = scoreRound(round({ positions: [{ bucket: 20, stake: 10n ** 18n, claimed: true }] }));
  assert.deepEqual(small, enormous);
});

test("a withdrawn position earns nothing", () => {
  const scored = scoreRound(round({ positions: [{ bucket: 20, stake: 0n, claimed: false }] }));
  assert.equal(scored.total, 0);
  assert.match(scored.note ?? "", /No stake held/);
});

test("an unsettled round pays nothing yet", () => {
  const scored = scoreRound(round({ status: "unresolved", winningBucket: null }));
  assert.equal(scored.total, 0);
  assert.match(scored.note ?? "", /has not settled/);
});

test("an invalid round still counts as a completed test but cannot earn accuracy", () => {
  const scored = scoreRound(round({ status: "invalid", winningBucket: null }));
  assert.equal(scored.participation, XP_AWARDS.participation);
  assert.equal(scored.settlementClaim, XP_AWARDS.settlementClaim);
  assert.equal(scored.accuracy, 0);
  assert.match(scored.note ?? "", /accuracy does not apply/);
});

test("a round can never exceed its cap however many positions are held", () => {
  const many = Array.from({ length: 41 }, () => ({ bucket: 20, stake: 1_000n, claimed: true }));
  const scored = scoreRound(round({ positions: many }));
  assert.ok(scored.total <= MAXIMUM_ROUND_XP);
});

test("breadth rewards distinct rounds and stops at the cap", () => {
  const rounds = Array.from({ length: 20 }, (_, index) => round({ roundSlug: `round-${index}` }));
  const profile = buildXpProfile({ granteeId: "invite-1", rounds, awards: [] });
  assert.equal(profile.roundsCompleted, 20);
  assert.equal(profile.breadth.firstRound, XP_AWARDS.firstRound);
  assert.equal(profile.breadth.returningRounds, MAXIMUM_RETURNING_ROUNDS * XP_AWARDS.returningRound);
});

test("a single round earns the first-round bonus but no returning bonus", () => {
  const profile = buildXpProfile({ granteeId: "invite-1", rounds: [round()], awards: [] });
  assert.equal(profile.breadth.firstRound, XP_AWARDS.firstRound);
  assert.equal(profile.breadth.returningRounds, 0);
});

test("unsettled rounds do not count toward breadth", () => {
  const profile = buildXpProfile({
    granteeId: "invite-1",
    rounds: [round({ status: "unresolved", winningBucket: null })],
    awards: [],
  });
  assert.equal(profile.roundsCompleted, 0);
  assert.equal(profile.breadth.total, 0);
});

test("devnet and mainnet totals stay separable", () => {
  const profile = buildXpProfile({
    granteeId: "invite-1",
    rounds: [round(), round({ roundSlug: "r2", cluster: "mainnet-beta" })],
    awards: [{ id: "a1", kind: "verified-report", cluster: "devnet", points: XP_AWARDS.verifiedReport, awardedAt: "2026-08-12T00:00:00.000Z", reason: "reproduced a settlement defect" }],
  });
  assert.ok(profile.byCluster.devnet > 0);
  assert.ok(profile.byCluster["mainnet-beta"] > 0);
  assert.equal(profile.total, profile.byCluster.devnet + profile.byCluster["mainnet-beta"]);
  assert.equal(profile.awards.total, XP_AWARDS.verifiedReport);
});

test("every profile carries the disclosure, so no surface can render XP without it", () => {
  const profile = buildXpProfile({ granteeId: "invite-1", rounds: [], awards: [] });
  assert.equal(profile.disclosure, XP_DISCLOSURE);
  assert.match(profile.disclosure, /not a token/);
  assert.match(profile.disclosure, /cannot be\s+redeemed|cannot be redeemed/);
  assert.match(profile.disclosure, /no future benefit is promised/);
});

test("the rules expose no conversion rate or redemption path", () => {
  // A stated rate is what turns a contribution record into a distribution mechanism, so assert the
  // module surface stays free of one rather than relying on nobody adding it later.
  const surface = Object.keys(XP_AWARDS).join(" ");
  assert.ok(!/token|redeem|convert|rate|claimable|allocation/i.test(surface));
});

test("the effective bucket is the stake-weighted mean", () => {
  assert.equal(effectiveBucket([{ bucket: 0, stake: 1n, claimed: false }, { bucket: 40, stake: 1n, claimed: false }]), 20);
  assert.equal(effectiveBucket([{ bucket: 0, stake: 3n, claimed: false }, { bucket: 40, stake: 1n, claimed: false }]), 10);
  assert.equal(effectiveBucket([]), null);
  assert.equal(effectiveBucket([{ bucket: 5, stake: 0n, claimed: false }]), null);
});
