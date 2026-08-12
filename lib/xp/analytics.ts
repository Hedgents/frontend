import "server-only";
import { getScarcityCurvePortfolio } from "@/lib/scarcity-curve-index";
import { deriveXpRounds, type WalletPortfolio } from "./derive";
import { buildXpProfile, type XpCluster } from "./rules";
import { readXpIndexForAnalytics } from "./store";

/**
 * Operator view of tester XP.
 *
 * The whole point of the programme is to learn whether testers actually exercise the product, so
 * the numbers here are the ones that answer that: how many invites linked a wallet at all, how many
 * got as far as a settled round, and how the effort is distributed. A leaderboard alone would
 * flatter us, because it shows the top and hides the tail where the answer usually is.
 *
 * Grant identifiers are not names. They are shown truncated so an operator can act on a row without
 * the page becoming a roster.
 */
export interface XpLeaderboardRow {
  granteeId: string;
  total: number;
  byCluster: Record<XpCluster, number>;
  roundsCompleted: number;
  wallets: number;
  awards: number;
}

export interface XpAnalytics {
  generatedAt: string;
  totals: {
    grantsWithLinks: number;
    grantsWithCompletedRounds: number;
    linkedWallets: number;
    xpAwarded: number;
    awardsRecorded: number;
  };
  engagement: {
    /** Linked a wallet but never held a position to settlement. The drop-off that matters most. */
    linkedButNeverPlayed: number;
    /** Completed exactly one round and did not return. */
    playedOnce: number;
    /** Completed three or more rounds. */
    returning: number;
    medianRoundsCompleted: number;
  };
  distribution: {
    /** Share of all XP held by the top decile of grants, so concentration is visible. */
    topDecileShare: number;
    /** Wallets per grant, to make multi-wallet use visible without naming anyone. */
    maximumWalletsOnOneGrant: number;
  };
  leaderboard: XpLeaderboardRow[];
  note: string;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export async function getXpAnalytics(options: { limit?: number } = {}): Promise<XpAnalytics> {
  const index = await readXpIndexForAnalytics();
  const grants = new Set<string>([
    ...index.links.map((link) => link.granteeId),
    ...index.awards.map((award) => award.granteeId),
  ]);

  // Chain reads are per wallet, so cache them: several grants never share a wallet, but a grant
  // with five wallets should not re-read a portfolio it already has.
  const portfolioByWallet = new Map<string, WalletPortfolio | null>();
  for (const link of index.links) {
    if (portfolioByWallet.has(link.wallet)) continue;
    const portfolio = await getScarcityCurvePortfolio(link.wallet).catch(() => null);
    portfolioByWallet.set(
      link.wallet,
      portfolio?.deployment
        ? {
          wallet: link.wallet,
          cluster: portfolio.deployment.cluster,
          positions: portfolio.positions.map((position) => ({
            slug: position.slug,
            bucket: position.bucket,
            stake: position.stake,
            claimed: position.claimed,
            status: position.status,
            winningBucket: position.winningBucket,
            bucketCount: position.bucketCount,
          })),
        }
        : null,
    );
  }

  const rows: XpLeaderboardRow[] = [];
  for (const granteeId of grants) {
    const links = index.links.filter((link) => link.granteeId === granteeId);
    const portfolios = links
      .map((link) => portfolioByWallet.get(link.wallet))
      .filter((portfolio): portfolio is WalletPortfolio => Boolean(portfolio));
    const profile = buildXpProfile({
      granteeId,
      rounds: deriveXpRounds(portfolios),
      awards: index.awards.filter((award) => award.granteeId === granteeId),
    });
    rows.push({
      granteeId,
      total: profile.total,
      byCluster: profile.byCluster,
      roundsCompleted: profile.roundsCompleted,
      wallets: links.length,
      awards: profile.awards.count,
    });
  }

  rows.sort((left, right) => right.total - left.total || right.roundsCompleted - left.roundsCompleted);

  const completed = rows.map((row) => row.roundsCompleted);
  const xpAwarded = rows.reduce((sum, row) => sum + row.total, 0);
  const decile = Math.max(1, Math.ceil(rows.length / 10));
  const topDecileTotal = rows.slice(0, decile).reduce((sum, row) => sum + row.total, 0);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      grantsWithLinks: new Set(index.links.map((link) => link.granteeId)).size,
      grantsWithCompletedRounds: rows.filter((row) => row.roundsCompleted > 0).length,
      linkedWallets: index.links.length,
      xpAwarded,
      awardsRecorded: index.awards.length,
    },
    engagement: {
      linkedButNeverPlayed: rows.filter((row) => row.wallets > 0 && row.roundsCompleted === 0).length,
      playedOnce: rows.filter((row) => row.roundsCompleted === 1).length,
      returning: rows.filter((row) => row.roundsCompleted >= 3).length,
      medianRoundsCompleted: median(completed),
    },
    distribution: {
      topDecileShare: xpAwarded > 0 ? Number((topDecileTotal / xpAwarded).toFixed(3)) : 0,
      maximumWalletsOnOneGrant: rows.reduce((most, row) => Math.max(most, row.wallets), 0),
    },
    leaderboard: rows.slice(0, options.limit ?? 25),
    note: "XP is a contribution record. It is not a token, is not transferable, cannot be redeemed, "
      + "and carries no conversion rate or promised benefit.",
  };
}
