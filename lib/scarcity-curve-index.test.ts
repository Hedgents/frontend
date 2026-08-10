import assert from "node:assert/strict";
import test from "node:test";
import { calculateCurvePositionClaimable } from "./scarcity-curve-payout";

const resolvedMarket = {
  status: "resolved" as const,
  bucketCount: 41,
  winningBucket: 20,
  curvePool: 2_394_000n,
  weightedStake: 122_000_000n,
  jackpotPool: 598_500n,
  exactStake: 2_000_000n,
};

test("computes the same floor-rounded curve and jackpot claims as the program", () => {
  assert.equal(calculateCurvePositionClaimable(resolvedMarket, {
    bucket: 20,
    stake: 2_000_000n,
    claimed: false,
  }), 2_207_581n);
  assert.equal(calculateCurvePositionClaimable(resolvedMarket, {
    bucket: 19,
    stake: 1_000_000n,
    claimed: false,
  }), 784_918n);
});

test("returns refunds for invalid markets and zero for unavailable claims", () => {
  assert.equal(calculateCurvePositionClaimable({ ...resolvedMarket, status: "invalid" }, {
    bucket: 3,
    stake: 750_000n,
    claimed: false,
  }), 750_000n);
  assert.equal(calculateCurvePositionClaimable({ ...resolvedMarket, status: "unresolved" }, {
    bucket: 3,
    stake: 750_000n,
    claimed: false,
  }), 0n);
  assert.equal(calculateCurvePositionClaimable(resolvedMarket, {
    bucket: 20,
    stake: 2_000_000n,
    claimed: true,
  }), 0n);
});
