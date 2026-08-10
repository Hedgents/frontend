export const CURVE_VALUE_SCALE = 1_000_000;
export const CURVE_BUCKET_COUNT = 41;

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function curveBucketToNormalized(bucket: number, bucketCount = CURVE_BUCKET_COUNT) {
  if (!Number.isInteger(bucket) || bucket < 0 || bucket >= bucketCount || bucketCount < 3 || bucketCount % 2 === 0) {
    throw new Error("Curve bucket is outside the committed range.");
  }
  return Math.round(-CURVE_VALUE_SCALE + (bucket * CURVE_VALUE_SCALE * 2) / (bucketCount - 1));
}

export function normalizedToCurveBucket(normalized: number, bucketCount = CURVE_BUCKET_COUNT) {
  if (!Number.isInteger(normalized) || normalized < -CURVE_VALUE_SCALE || normalized > CURVE_VALUE_SCALE) {
    throw new Error("Normalized curve value must be an integer from -1000000 through 1000000.");
  }
  if (bucketCount < 3 || bucketCount > 41 || bucketCount % 2 === 0) {
    throw new Error("Curve bucket count must be an odd integer from 3 through 41.");
  }
  const shifted = normalized + CURVE_VALUE_SCALE;
  const span = CURVE_VALUE_SCALE * 2;
  return Math.floor((shifted * (bucketCount - 1) * 2 + span) / (span * 2));
}

export function displayValueToNormalized(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value) || !Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) {
    throw new Error("Curve display range is invalid.");
  }
  const bounded = clamp(value, minimum, maximum);
  return Math.round(((bounded - minimum) / (maximum - minimum) * 2 - 1) * CURVE_VALUE_SCALE);
}

export function normalizedToDisplayValue(normalized: number, minimum: number, maximum: number) {
  if (!Number.isFinite(normalized) || normalized < -CURVE_VALUE_SCALE || normalized > CURVE_VALUE_SCALE || minimum >= maximum) {
    throw new Error("Curve normalization inputs are invalid.");
  }
  return minimum + ((normalized + CURVE_VALUE_SCALE) / (CURVE_VALUE_SCALE * 2)) * (maximum - minimum);
}

export function curveWeight(bucket: number, winningBucket: number, bucketCount = CURVE_BUCKET_COUNT) {
  if (
    !Number.isInteger(bucket)
    || !Number.isInteger(winningBucket)
    || bucket < 0
    || winningBucket < 0
    || bucket >= bucketCount
    || winningBucket >= bucketCount
  ) {
    throw new Error("Curve weight bucket is invalid.");
  }
  return bucketCount - Math.abs(bucket - winningBucket);
}

function floorMulDiv(left: bigint, right: bigint, denominator: bigint) {
  if (left < 0n || right < 0n || denominator <= 0n) throw new Error("Curve payout inputs are invalid.");
  return left * right / denominator;
}

export function curveScenarioPayout(input: {
  bucketStakes: readonly bigint[];
  positionBucket: number;
  positionStake: bigint;
  winningBucket: number;
  feeBps: number;
  jackpotBps: number;
  jackpotLeverageCap: number;
}) {
  const bucketCount = input.bucketStakes.length;
  if (
    bucketCount < 3
    || bucketCount > 41
    || bucketCount % 2 === 0
    || input.positionStake < 0n
    || !Number.isInteger(input.feeBps)
    || input.feeBps < 0
    || input.feeBps > 10_000
    || !Number.isInteger(input.jackpotBps)
    || input.jackpotBps < 0
    || input.jackpotBps > 10_000
    || !Number.isInteger(input.jackpotLeverageCap)
    || input.jackpotLeverageCap < 1
  ) {
    throw new Error("Curve payout configuration is invalid.");
  }
  curveWeight(input.positionBucket, input.winningBucket, bucketCount);
  const totalStaked = input.bucketStakes.reduce((total, stake) => {
    if (stake < 0n) throw new Error("Curve stake cannot be negative.");
    return total + stake;
  }, 0n);
  const protocolFee = floorMulDiv(totalStaked, BigInt(input.feeBps), 10_000n);
  const payoutPool = totalStaked - protocolFee;
  const exactStake = input.bucketStakes[input.winningBucket] ?? 0n;
  const targetJackpot = floorMulDiv(payoutPool, BigInt(input.jackpotBps), 10_000n);
  const jackpotPool = targetJackpot < exactStake * BigInt(input.jackpotLeverageCap)
    ? targetJackpot
    : exactStake * BigInt(input.jackpotLeverageCap);
  const curvePool = payoutPool - jackpotPool;
  const weightedStake = input.bucketStakes.reduce(
    (total, stake, bucket) => total + stake * BigInt(curveWeight(bucket, input.winningBucket, bucketCount)),
    0n,
  );
  const jackpotShare = input.positionBucket === input.winningBucket && exactStake > 0n
    ? floorMulDiv(jackpotPool, input.positionStake, exactStake)
    : 0n;
  const curveShare = weightedStake > 0n
    ? floorMulDiv(
      curvePool,
      input.positionStake * BigInt(curveWeight(input.positionBucket, input.winningBucket, bucketCount)),
      weightedStake,
    )
    : 0n;
  return { payout: jackpotShare + curveShare, protocolFee, payoutPool, jackpotPool, curvePool, exactStake, weightedStake };
}
