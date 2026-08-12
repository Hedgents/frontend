/**
 * Tester XP.
 *
 * WHAT THIS IS NOT, and the design enforces it rather than disclaiming it:
 *
 *   - There is no balance. XP is DERIVED from settled rounds and an operator award ledger, so
 *     there is nothing to hold, nothing to drain, and no state that can disagree with the chain.
 *   - It cannot be transferred. There is no send, no allowance, no account-to-account path.
 *   - It cannot be redeemed. No conversion rate exists anywhere in this module or downstream,
 *     because a stated rate is what turns a contribution record into a distribution mechanism.
 *   - No forward commitment is made or implied. Copy that promises future value would make this a
 *     sale of an expectation; see the rejected token-launch playbook.
 *
 * What it IS: a reproducible measure of how much someone actually helped test, computed from facts
 * a third party can check. Same standard as the index.
 *
 * WHAT IT REWARDS, and why volume is deliberately absent. Devnet collateral is a mint the operator
 * issues, so anyone can hold a billion of it. Any rule scaled by amount staked is therefore free to
 * farm and measures nothing. XP instead pays for the behaviours that make a test valuable: showing
 * up across separate rounds, forecasting with care, holding to settlement, completing the claim, and
 * reporting what broke.
 */
import { curveWeight } from "@/lib/scarcity-curve-math";

export const XP_RULES_VERSION = "xp.2026-08-12.v1";

export const XP_AWARDS = {
  /** Held a position to settlement. Flat, and deliberately not scaled by stake. */
  participation: 100,
  /** Maximum for a perfect forecast; scales down to zero at the furthest bucket. */
  accuracyMaximum: 200,
  /** Claimed the settlement. Proves the whole loop, which is the thing being tested. */
  settlementClaim: 50,
  /** One-time, the first round a tester ever completes. */
  firstRound: 150,
  /** Each further distinct round, up to `maximumReturningRounds`. */
  returningRound: 75,
  /** Held a binary YES/NO position through to resolution. */
  binaryParticipation: 100,
  /**
   * Held the winning side. Deliberately far below curve accuracy: picking one of two is a coin
   * flip, and paying it like a 1-in-41 forecast would reward luck at the same rate as skill.
   */
  binaryCorrect: 50,
  /** A settled metal trade in the terminal, counted once per product per day. */
  terminalTrade: 75,
  /**
   * Bought a product and later sold it back. The exit path is the half of the loop that breaks,
   * and the half a tester will not exercise unless it is worth something.
   */
  terminalRoundTrip: 150,
  /** Operator-awarded for a reproduced defect. The actual point of a testnet, priced accordingly. */
  verifiedReport: 500,
} as const;

/** A tester cannot earn terminal XP more than this many times in one day, whatever they trade. */
export const MAXIMUM_TERMINAL_TRADES_PER_DAY = 2;

export const MAXIMUM_RETURNING_ROUNDS = 9;

/** The most a single round can ever be worth, whatever a tester does inside it. */
export const MAXIMUM_ROUND_XP =
  XP_AWARDS.participation + XP_AWARDS.accuracyMaximum + XP_AWARDS.settlementClaim;

export type XpCluster = "devnet" | "mainnet-beta";

export interface XpPosition {
  bucket: number;
  /** Stake remaining at settlement. Withdrawn positions arrive here as 0 and earn nothing. */
  stake: bigint;
  claimed: boolean;
}

export interface XpRound {
  roundSlug: string;
  cluster: XpCluster;
  bucketCount: number;
  status: "unresolved" | "resolved" | "invalid";
  /** Null unless the round resolved to a bucket. */
  winningBucket: number | null;
  positions: readonly XpPosition[];
}

export interface XpBinaryPosition {
  marketSlug: string;
  cluster: XpCluster;
  /** Base units held at the time of reading. */
  yes: bigint;
  no: bigint;
  status: "unresolved" | "resolved-yes" | "resolved-no" | "invalid";
}

export interface XpTerminalTrade {
  /** Transaction signature, so the same trade can never be counted twice. */
  signature: string;
  cluster: XpCluster;
  productId: string;
  direction: "buy" | "sell";
  /** ISO date, used for the per-day cap. */
  settledAt: string;
}

export interface XpAward {
  id: string;
  /** Awards belong to the grant, like everything else here. */
  granteeId: string;
  kind: "verified-report";
  cluster: XpCluster;
  points: number;
  awardedAt: string;
  reason: string;
}

export interface XpRoundBreakdown {
  roundSlug: string;
  cluster: XpCluster;
  participation: number;
  accuracy: number;
  settlementClaim: number;
  total: number;
  /** Stake-weighted mean bucket. Display only; accuracy is scored on mean WEIGHT. */
  effectiveBucket: number | null;
  note: string | null;
}

export interface XpBinaryBreakdown {
  marketSlug: string;
  cluster: XpCluster;
  participation: number;
  correct: number;
  total: number;
  note: string | null;
}

export interface XpTerminalBreakdown {
  cluster: XpCluster;
  countedTrades: number;
  roundTripProducts: string[];
  trades: number;
  roundTrips: number;
  total: number;
}

export interface XpProfile {
  rulesVersion: typeof XP_RULES_VERSION;
  /** Keyed to the invite grant, never the wallet: ten wallets is still one tester. */
  granteeId: string;
  byCluster: Record<XpCluster, number>;
  total: number;
  roundsCompleted: number;
  rounds: XpRoundBreakdown[];
  binary: XpBinaryBreakdown[];
  terminal: XpTerminalBreakdown[];
  breadth: { firstRound: number; returningRounds: number; total: number };
  awards: { count: number; total: number };
  /** Present on every profile so no surface can render XP without it. */
  disclosure: string;
}

export const XP_DISCLOSURE =
  "XP records testing contribution. It is not a token, it is not transferable, it cannot be "
  + "redeemed, it has no conversion rate, and no future benefit is promised or implied.";

/**
 * The stake-weighted mean bucket. Reported for display only; accuracy is NOT scored on it.
 *
 * Scoring the weight of the mean bucket would be straddleable: stake equally at buckets 0 and 40
 * with the winner at 20 and the mean lands exactly on the winner, collecting full marks for two
 * positions the payout punishes. Accuracy uses the mean of the WEIGHTS instead (see scoreRound),
 * which is the same quantity the payout divides by, so XP and payout can never disagree about who
 * forecast well.
 */
export function effectiveBucket(positions: readonly XpPosition[]) {
  const staked = positions.filter((position) => position.stake > 0n);
  if (!staked.length) return null;
  const total = staked.reduce((sum, position) => sum + position.stake, 0n);
  if (total === 0n) return null;
  // Scaled integer arithmetic so the mean does not drift with bigint division.
  const weighted = staked.reduce(
    (sum, position) => sum + position.stake * BigInt(position.bucket) * 1_000_000n,
    0n,
  );
  return Number(weighted / total) / 1_000_000;
}

export function scoreRound(round: XpRound): XpRoundBreakdown {
  const base: XpRoundBreakdown = {
    roundSlug: round.roundSlug,
    cluster: round.cluster,
    participation: 0,
    accuracy: 0,
    settlementClaim: 0,
    total: 0,
    effectiveBucket: null,
    note: null,
  };

  const held = round.positions.filter((position) => position.stake > 0n);
  if (!held.length) {
    return { ...base, note: "No stake held to settlement." };
  }
  if (round.status === "unresolved") {
    return { ...base, effectiveBucket: effectiveBucket(held), note: "Round has not settled yet." };
  }

  const participation = XP_AWARDS.participation;
  const settlementClaim = held.some((position) => position.claimed) ? XP_AWARDS.settlementClaim : 0;

  // An invalid round is still a completed test, so participation stands. There is no outcome to be
  // close to, so accuracy cannot be earned and is not silently treated as a miss either.
  if (round.status === "invalid" || round.winningBucket === null) {
    const total = participation + settlementClaim;
    return {
      ...base,
      participation,
      settlementClaim,
      total,
      effectiveBucket: effectiveBucket(held),
      note: "Round settled invalid; participation counts, accuracy does not apply.",
    };
  }

  // Stake-weighted mean proximity, the same quantity the curve pool is divided by. Spraying the
  // grid averages to the middle weight and scores like the middle; straddling the winner does too,
  // because both legs are genuinely far from it.
  const totalStake = held.reduce((sum, position) => sum + position.stake, 0n);
  const weightedSum = held.reduce(
    (sum, position) =>
      sum + position.stake * BigInt(curveWeight(position.bucket, round.winningBucket!, round.bucketCount)),
    0n,
  );
  const meanWeight = Number(weightedSum * 1_000_000n / totalStake) / 1_000_000;
  // meanWeight runs 1..bucketCount, so this runs 0..accuracyMaximum.
  const accuracy = Math.round(
    XP_AWARDS.accuracyMaximum * (meanWeight - 1) / (round.bucketCount - 1),
  );
  const mean = effectiveBucket(held);
  const total = Math.min(MAXIMUM_ROUND_XP, participation + accuracy + settlementClaim);
  return { ...base, participation, accuracy, settlementClaim, total, effectiveBucket: mean };
}

/**
 * Binary markets are scored on what can actually be observed, which is less than one would like.
 *
 * Redeeming BURNS the YES/NO tokens, so a wallet that completed the loop and a wallet that never
 * played both read as a zero balance. There is therefore no redemption bonus here: it would be
 * unobservable and would silently never pay, which is worse than not offering it. Participation is
 * credited on holding a position in a market that has resolved.
 */
export function scoreBinaryPosition(position: XpBinaryPosition): XpBinaryBreakdown {
  const base: XpBinaryBreakdown = {
    marketSlug: position.marketSlug,
    cluster: position.cluster,
    participation: 0,
    correct: 0,
    total: 0,
    note: null,
  };
  const held = position.yes > 0n || position.no > 0n;
  if (!held) return { ...base, note: "No position held." };
  if (position.status === "unresolved") return { ...base, note: "Market has not resolved yet." };

  const participation = XP_AWARDS.binaryParticipation;
  if (position.status === "invalid") {
    return { ...base, participation, total: participation, note: "Market resolved invalid; no side was correct." };
  }
  const onWinningSide = position.status === "resolved-yes" ? position.yes > 0n : position.no > 0n;
  const correct = onWinningSide ? XP_AWARDS.binaryCorrect : 0;
  return { ...base, participation, correct, total: participation + correct };
}

/**
 * Terminal trades are real money on mainnet, so unlike devnet collateral they cannot be conjured.
 * They can still be spammed cheaply in small sizes, so the credit is per product per day and capped,
 * and size is ignored entirely: a $10 round trip tests the same code path as a $100 one.
 */
export function scoreTerminalTrades(trades: readonly XpTerminalTrade[]): XpTerminalBreakdown[] {
  const byCluster = new Map<XpCluster, XpTerminalTrade[]>();
  for (const trade of trades) {
    byCluster.set(trade.cluster, [...(byCluster.get(trade.cluster) ?? []), trade]);
  }
  return [...byCluster.entries()].map(([cluster, clusterTrades]) => {
    const seenSignatures = new Set<string>();
    const perDay = new Map<string, number>();
    let countedTrades = 0;
    const boughtProducts = new Set<string>();
    const soldProducts = new Set<string>();
    for (const trade of [...clusterTrades].sort((left, right) => left.settledAt.localeCompare(right.settledAt))) {
      // A signature is a trade exactly once, however many times it is reported.
      if (seenSignatures.has(trade.signature)) continue;
      seenSignatures.add(trade.signature);
      (trade.direction === "buy" ? boughtProducts : soldProducts).add(trade.productId);
      const day = trade.settledAt.slice(0, 10);
      const used = perDay.get(day) ?? 0;
      if (used >= MAXIMUM_TERMINAL_TRADES_PER_DAY) continue;
      perDay.set(day, used + 1);
      countedTrades += 1;
    }
    const roundTripProducts = [...boughtProducts].filter((product) => soldProducts.has(product)).sort();
    const total = countedTrades * XP_AWARDS.terminalTrade
      + roundTripProducts.length * XP_AWARDS.terminalRoundTrip;
    return {
      cluster,
      countedTrades,
      roundTripProducts,
      trades: seenSignatures.size,
      roundTrips: roundTripProducts.length,
      total,
    };
  });
}

export function buildXpProfile(input: {
  granteeId: string;
  rounds: readonly XpRound[];
  awards: readonly XpAward[];
  binary?: readonly XpBinaryPosition[];
  terminalTrades?: readonly XpTerminalTrade[];
}): XpProfile {
  const rounds = input.rounds.map(scoreRound);
  const binary = (input.binary ?? []).map(scoreBinaryPosition);
  const terminal = scoreTerminalTrades(input.terminalTrades ?? []);
  // A round counts toward breadth only once it has actually settled and paid participation.
  const completed = rounds.filter((round) => round.participation > 0);
  const returningRounds = Math.min(MAXIMUM_RETURNING_ROUNDS, Math.max(0, completed.length - 1));
  const breadth = {
    firstRound: completed.length > 0 ? XP_AWARDS.firstRound : 0,
    returningRounds: returningRounds * XP_AWARDS.returningRound,
    total: 0,
  };
  breadth.total = breadth.firstRound + breadth.returningRounds;

  const byCluster: Record<XpCluster, number> = { devnet: 0, "mainnet-beta": 0 };
  for (const round of rounds) byCluster[round.cluster] += round.total;
  for (const position of binary) byCluster[position.cluster] += position.total;
  for (const entry of terminal) byCluster[entry.cluster] += entry.total;
  for (const award of input.awards) byCluster[award.cluster] += award.points;
  // Breadth is earned across rounds rather than inside one, so it is attributed to the cluster the
  // tester actually completed rounds on. Devnet and mainnet totals stay separable on purpose.
  const breadthCluster: XpCluster = completed.some((round) => round.cluster === "mainnet-beta")
    ? "mainnet-beta"
    : "devnet";
  byCluster[breadthCluster] += breadth.total;

  const awardsTotal = input.awards.reduce((sum, award) => sum + award.points, 0);
  return {
    rulesVersion: XP_RULES_VERSION,
    granteeId: input.granteeId,
    byCluster,
    total: byCluster.devnet + byCluster["mainnet-beta"],
    roundsCompleted: completed.length,
    rounds,
    binary,
    terminal,
    breadth,
    awards: { count: input.awards.length, total: awardsTotal },
    disclosure: XP_DISCLOSURE,
  };
}
