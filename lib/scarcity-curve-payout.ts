import { curveWeight } from "@/lib/scarcity-curve-math";

interface CurvePayoutMarket {
  status: "unresolved" | "resolved" | "invalid";
  bucketCount: number;
  winningBucket: number;
  curvePool: bigint;
  weightedStake: bigint;
  jackpotPool: bigint;
  exactStake: bigint;
}

interface CurvePayoutPosition {
  bucket: number;
  stake: bigint;
  claimed: boolean;
}

export function calculateCurvePositionClaimable(
  market: CurvePayoutMarket,
  position: CurvePayoutPosition,
) {
  if (position.claimed || market.status === "unresolved" || position.stake === 0n) return 0n;
  if (market.status === "invalid") return position.stake;
  if (position.bucket >= market.bucketCount || market.winningBucket >= market.bucketCount || market.weightedStake === 0n) {
    throw new Error("Curve position payout inputs are inconsistent.");
  }
  const weight = BigInt(curveWeight(position.bucket, market.winningBucket, market.bucketCount));
  const curvePayout = position.stake * weight * market.curvePool / market.weightedStake;
  const jackpotPayout = position.bucket === market.winningBucket && market.jackpotPool > 0n
    ? (() => {
      if (market.exactStake === 0n) throw new Error("Curve jackpot denominator is zero.");
      return position.stake * market.jackpotPool / market.exactStake;
    })()
    : 0n;
  return curvePayout + jackpotPayout;
}
