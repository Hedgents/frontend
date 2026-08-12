import "server-only";
import { getScarcityCurvePortfolio } from "@/lib/scarcity-curve-index";
import { deriveXpRounds, type WalletPortfolio } from "./derive";
import { buildXpProfile, type XpProfile } from "./rules";
import { listAwards, listLinkedWallets } from "./store";

/**
 * Assemble a tester's XP from their linked wallets, the chain, and the award ledger.
 *
 * Nothing is cached and no total is stored. Every read recomputes from current chain state, so the
 * number a tester sees is one they can reproduce themselves from the same public data, and a stale
 * write can never inflate it.
 */
export async function getXpProfile(granteeId: string): Promise<XpProfile & {
  wallets: Array<{ wallet: string; linkedAt: string }>;
}> {
  const links = await listLinkedWallets(granteeId);
  const awards = await listAwards(granteeId);

  const portfolios: WalletPortfolio[] = [];
  for (const link of links) {
    // A wallet with no positions, or a deployment that is not configured, contributes nothing
    // rather than failing the whole profile. One unreadable wallet should not hide the others.
    const portfolio = await getScarcityCurvePortfolio(link.wallet).catch(() => null);
    if (!portfolio?.deployment) continue;
    portfolios.push({
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
    });
  }

  const profile = buildXpProfile({
    granteeId,
    rounds: deriveXpRounds(portfolios),
    awards,
  });
  return {
    ...profile,
    wallets: links.map((link) => ({ wallet: link.wallet, linkedAt: link.linkedAt })),
  };
}
