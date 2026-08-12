import "server-only";
import { getScarcityCurvePortfolio } from "@/lib/scarcity-curve-index";
import { getScarcityPortfolio } from "@/lib/scarcity-exchange-index";

/** The terminal's own mainnet endpoints, not the scarcity exchange's. */
function terminalRpcEndpoints() {
  return [
    ...(process.env.HEDGENTS_SOLANA_MAINNET_RPC_URLS ?? "").split(","),
    process.env.HEDGENTS_SOLANA_MAINNET_RPC_URL ?? "",
  ].map((value) => value.trim()).filter(Boolean);
}
import { readTerminalTrades } from "./terminal-activity";
import { readPulsePositions } from "@/lib/metal-pulse-chain";
import { deriveXpRounds, type WalletPortfolio } from "./derive";
import { buildXpProfile, type XpBinaryPosition, type XpProfile, type XpTerminalTrade } from "./rules";
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

  // Binary markets: token balances only, so a redeemed position reads as zero. Scored on holdings
  // in resolved markets, which is what can honestly be observed.
  const binary: XpBinaryPosition[] = [];
  const terminalTrades: XpTerminalTrade[] = [];
  for (const link of links) {
    const exchange = await getScarcityPortfolio(link.wallet).catch(() => null);
    if (exchange?.deployment) {
      for (const position of exchange.positions) {
        binary.push({
          marketSlug: position.slug,
          cluster: exchange.deployment.cluster,
          yes: BigInt(position.yes),
          no: BigInt(position.no),
          status: position.status as XpBinaryPosition["status"],
        });
      }
    }
    // Gold 15 rounds are binary markets too, but derived per round rather than listed in the
    // manifest, so they are read separately and scored by the same binary rules.
    const pulse = await readPulsePositions({ wallet: link.wallet }).catch(() => null);
    for (const position of pulse?.positions ?? []) {
      if (position.status === "missing") continue;
      binary.push({
        marketSlug: position.roundId,
        cluster: pulse!.cluster,
        yes: BigInt(position.yes),
        no: BigInt(position.no),
        status: position.status,
      });
    }
    // Terminal trades are always mainnet: the product registry holds mainnet mints and the terminal
    // executes there, independently of whichever cluster the scarcity exchange is deployed on.
    if (terminalRpcEndpoints().length) {
      terminalTrades.push(...await readTerminalTrades({
        wallet: link.wallet,
        cluster: "mainnet-beta",
        endpoints: terminalRpcEndpoints(),
      }).catch(() => []));
    }
  }

  const profile = buildXpProfile({
    granteeId,
    rounds: deriveXpRounds(portfolios),
    awards,
    binary,
    terminalTrades,
  });
  return {
    ...profile,
    wallets: links.map((link) => ({ wallet: link.wallet, linkedAt: link.linkedAt })),
  };
}
