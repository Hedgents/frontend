/**
 * Turns on-chain curve positions into the rounds the XP rules score.
 *
 * Everything here is derived from chain state a third party can read, so a tester can recompute
 * their own XP and disagree with us in public if we get it wrong. Nothing is stored as a balance.
 *
 * One tester may connect several wallets, so positions are gathered per wallet and then FOLDED per
 * round before scoring. Folding first matters: scoring each wallet separately would let one person
 * split a spray across ten wallets and collect the focused score on whichever one happened to be
 * nearest, which is exactly the behaviour the stake-weighted mean exists to price correctly.
 */
import type { XpCluster, XpPosition, XpRound } from "./rules";

export interface ChainPosition {
  slug: string;
  bucket: number;
  /** Base units as a decimal string, as the portfolio reports them. */
  stake: string;
  claimed: boolean;
  status: "unresolved" | "resolved" | "invalid";
  winningBucket: number;
  bucketCount: number;
}

export interface WalletPortfolio {
  wallet: string;
  cluster: XpCluster;
  positions: readonly ChainPosition[];
}

function parseStake(value: string) {
  if (!/^\d+$/.test(value)) return 0n;
  return BigInt(value);
}

/**
 * Fold every linked wallet's positions into one round record per (cluster, round).
 *
 * A round is only scoreable when its bucket count and status agree across the positions that
 * reference it. They come from the same market account, so a disagreement means stale data rather
 * than a real difference, and the round is dropped rather than scored on a guess.
 */
export function deriveXpRounds(portfolios: readonly WalletPortfolio[]): XpRound[] {
  const byRound = new Map<string, {
    roundSlug: string;
    cluster: XpCluster;
    bucketCount: number;
    status: ChainPosition["status"];
    winningBucket: number;
    positions: XpPosition[];
    inconsistent: boolean;
  }>();

  for (const portfolio of portfolios) {
    for (const position of portfolio.positions) {
      const key = `${portfolio.cluster}::${position.slug}`;
      const existing = byRound.get(key);
      if (!existing) {
        byRound.set(key, {
          roundSlug: position.slug,
          cluster: portfolio.cluster,
          bucketCount: position.bucketCount,
          status: position.status,
          winningBucket: position.winningBucket,
          positions: [{ bucket: position.bucket, stake: parseStake(position.stake), claimed: position.claimed }],
          inconsistent: false,
        });
        continue;
      }
      if (
        existing.bucketCount !== position.bucketCount
        || existing.status !== position.status
        || existing.winningBucket !== position.winningBucket
      ) {
        existing.inconsistent = true;
      }
      existing.positions.push({
        bucket: position.bucket,
        stake: parseStake(position.stake),
        claimed: position.claimed,
      });
    }
  }

  return [...byRound.values()]
    .filter((round) => !round.inconsistent)
    .sort((left, right) => left.roundSlug.localeCompare(right.roundSlug))
    .map((round) => ({
      roundSlug: round.roundSlug,
      cluster: round.cluster,
      bucketCount: round.bucketCount,
      status: round.status,
      // The program reports a winning bucket even while unresolved, so only trust it once the round
      // has actually settled to an outcome.
      winningBucket: round.status === "resolved" ? round.winningBucket : null,
      positions: round.positions,
    }));
}
