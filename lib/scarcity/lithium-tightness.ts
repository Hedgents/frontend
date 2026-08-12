/**
 * Lithium carbonate market-tightness index, v1.
 *
 * ONE parameter: the annualised front-to-third settlement slope of the GFEX lithium carbonate
 * curve. Backwardation (front above deferred) means the spot market is paying up for metal now,
 * which is the textbook physical-tightness signal and is scale-free, so it says nothing about the
 * price level. A market on this is a bet on physical tightness, not a bet on price.
 *
 * WHY ONLY ONE PARAMETER. The spec originally paired this with two warehouse-warrant parameters,
 * and measurement killed both. GFEX force-deregisters every lithium warrant registered on or before
 * the last trading day of March, July and November. The warrant total hit literally zero on
 * 2024-03-29 and 2024-07-31 and rebuilt within twenty trading days, so the same metal was simply
 * re-papered. Warrant momentum read those wipes as the most extreme tightening in the sample.
 * Removing the 21 trading days after each wipe cut the composite's forward correlation with price
 * from +0.282 to +0.066. Cancellation pressure is contaminated too and could not be cleaned: holders
 * cancel on their own schedule in the run-up to a forced deregistration, so the whole preceding month
 * is affected, and the seasonality only fell from 35x to 15x after dropping the scheduled sessions.
 * Neither belongs in a number that settles money. The warrant series is still published as context.
 *
 * Anchors are set once, in public, and frozen. They are symmetric around a flat curve because a flat
 * curve is the economically meaningful neutral, not because the sample happened to sit there. The
 * observed 2.7-year range is -0.345 to +0.332, so +/-0.30 spans it with roughly 1% railing at each
 * end rather than the 22% the first table produced.
 */
export const LITHIUM_TIGHTNESS_VERSION = "lithium-tightness.2026-08-12.v1";

export const CURVE_SLOPE_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [-0.30, 0],
  [-0.15, 25],
  [0, 50],
  [0.15, 75],
  [0.30, 100],
];

/** A contract must clear this to be designated front or third. */
export const LIQUIDITY_ENTRY = { openInterest: 5_000, volume: 1_000 } as const;
/**
 * ...and only loses the designation when it falls well below it. Without hysteresis the front
 * contract flipped backward nine times in 2.7 years as contracts crossed the threshold, which
 * changed the (front, third) pair on 15.9% of day-pairs and roughly doubled the parameter's daily
 * volatility on those days.
 */
export const LIQUIDITY_EXIT = { openInterest: 2_500, volume: 500 } as const;

export const TRAILING_MEDIAN_DAYS = 5;

export interface CurveQuote {
  /** GFEX delivery code, "YYMM". */
  deliveryMonth: string;
  settlement: number;
  openInterest: number;
  volume: number;
}

export interface TightnessObservation {
  date: string;
  curve: readonly CurveQuote[];
}

export interface TightnessPoint {
  date: string;
  /** Null when the day could not be scored; never silently filled. */
  score: number | null;
  rawSlope: number | null;
  medianSlope: number | null;
  frontMonth: string | null;
  thirdMonth: string | null;
  unavailableReason: string | null;
}

function deliveryIndex(code: string) {
  return (2000 + Number(code.slice(0, 2))) * 12 + Number(code.slice(2, 4)) - 1;
}

export function normalizeCurveSlope(value: number) {
  const anchors = CURVE_SLOPE_ANCHORS;
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let index = 1; index < anchors.length; index += 1) {
    const [rightValue, rightScore] = anchors[index];
    const [leftValue, leftScore] = anchors[index - 1];
    if (value <= rightValue) {
      return leftScore + ((value - leftValue) / (rightValue - leftValue)) * (rightScore - leftScore);
    }
  }
  return last[1];
}

/**
 * Designate the front contract with hysteresis and a no-going-backward rule. Once a delivery month
 * has been front, the series never returns to an earlier one, which is what a real roll does.
 */
function eligibleContracts(curve: readonly CurveQuote[], previousFront: string | null) {
  const sorted = [...curve]
    .filter((quote) => /^\d{4}$/.test(quote.deliveryMonth) && quote.settlement > 0)
    .sort((left, right) => deliveryIndex(left.deliveryMonth) - deliveryIndex(right.deliveryMonth));
  const floor = previousFront === null ? -Infinity : deliveryIndex(previousFront);
  return sorted.filter((quote) => {
    if (deliveryIndex(quote.deliveryMonth) < floor) return false;
    const held = previousFront !== null && quote.deliveryMonth === previousFront;
    const gate = held ? LIQUIDITY_EXIT : LIQUIDITY_ENTRY;
    return quote.openInterest >= gate.openInterest && quote.volume >= gate.volume;
  });
}

export function annualisedCurveSlope(curve: readonly CurveQuote[], previousFront: string | null) {
  const eligible = eligibleContracts(curve, previousFront);
  if (eligible.length < 3) return { slope: null, front: null, third: null } as const;
  const front = eligible[0];
  const third = eligible[2];
  const months = deliveryIndex(third.deliveryMonth) - deliveryIndex(front.deliveryMonth);
  if (months <= 0) return { slope: null, front: null, third: null } as const;
  // 30.4375 = 365/12. The two contracts share a delivery-day convention, so the gap is exactly
  // `months` calendar months and the annualisation error is a fraction of a percent.
  const slope = (front.settlement / third.settlement - 1) * (365 / (months * 30.4375));
  return { slope, front: front.deliveryMonth, third: third.deliveryMonth } as const;
}

function trailingMedian(values: readonly (number | null)[], index: number, window: number) {
  const slice: number[] = [];
  for (let offset = 0; offset < window && index - offset >= 0; offset += 1) {
    const value = values[index - offset];
    if (value !== null && Number.isFinite(value)) slice.push(value);
  }
  if (slice.length < Math.ceil(window / 2)) return null;
  slice.sort((left, right) => left - right);
  const middle = Math.floor(slice.length / 2);
  return slice.length % 2 ? slice[middle] : (slice[middle - 1] + slice[middle]) / 2;
}

/**
 * Score an ordered run of trading days. Days that cannot be scored return `score: null` with a
 * stated reason rather than a filled value, because a settlement series must never invent a number.
 */
export function computeLithiumTightness(observations: readonly TightnessObservation[]): TightnessPoint[] {
  const raw: (number | null)[] = [];
  const fronts: (string | null)[] = [];
  const thirds: (string | null)[] = [];
  let previousFront: string | null = null;

  for (const observation of observations) {
    const { slope, front, third } = annualisedCurveSlope(observation.curve, previousFront);
    if (front !== null) previousFront = front;
    raw.push(slope);
    fronts.push(front);
    thirds.push(third);
  }

  return observations.map((observation, index) => {
    const median = trailingMedian(raw, index, TRAILING_MEDIAN_DAYS);
    if (median === null) {
      return {
        date: observation.date,
        score: null,
        rawSlope: raw[index],
        medianSlope: null,
        frontMonth: fronts[index],
        thirdMonth: thirds[index],
        unavailableReason: index < TRAILING_MEDIAN_DAYS - 1
          ? "insufficient history for the trailing median"
          : "too few liquid contracts in the median window",
      };
    }
    return {
      date: observation.date,
      score: normalizeCurveSlope(median),
      rawSlope: raw[index],
      medianSlope: median,
      frontMonth: fronts[index],
      thirdMonth: thirds[index],
      unavailableReason: null,
    };
  });
}
