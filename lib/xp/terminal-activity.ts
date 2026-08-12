import "server-only";
import { getSolanaExecutionProduct, solanaExecutionProducts } from "@/lib/product-registry";
import type { XpCluster, XpTerminalTrade } from "./rules";

/**
 * Terminal trades, read from the chain.
 *
 * The terminal keeps its execution receipts in the browser and its audit store is keyed by
 * signature rather than by wallet, so there is no server-side per-wallet history to read. Rather
 * than add one, or trust a client to report its own trades, this derives them the same way
 * everything else here is derived: from what the chain already shows.
 *
 * A metal trade is a settled transaction in which the wallet's balance of a registered product mint
 * moved. Direction comes from the sign of that move. Nothing here reads amounts into the score, so
 * a large trade and a small one are worth the same, and a failed transaction is worth nothing.
 */
const MAX_SIGNATURES = 100;
const RPC_TIMEOUT_MS = 15_000;

interface TokenBalanceEntry {
  owner?: string;
  mint?: string;
  uiTokenAmount?: { amount?: string };
}

interface ParsedTransaction {
  slot?: number;
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    preTokenBalances?: TokenBalanceEntry[];
    postTokenBalances?: TokenBalanceEntry[];
  } | null;
}

async function rpc<T>(endpoints: readonly string[], method: string, params: unknown[]): Promise<T | null> {
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: `xp-${method}`, method, params }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as { result?: T; error?: unknown };
      if (payload.error) continue;
      if (payload.result !== undefined) return payload.result;
    } catch {
      // Fall through to the next endpoint; a single unreachable provider must not zero a record.
    }
  }
  return null;
}

function ownedBalances(entries: TokenBalanceEntry[] | undefined, wallet: string) {
  const balances = new Map<string, bigint>();
  for (const entry of entries ?? []) {
    if (entry.owner !== wallet || !entry.mint) continue;
    const amount = entry.uiTokenAmount?.amount;
    if (!amount || !/^\d+$/.test(amount)) continue;
    balances.set(entry.mint, (balances.get(entry.mint) ?? 0n) + BigInt(amount));
  }
  return balances;
}

const productIdByMint = new Map(
  Object.values(solanaExecutionProducts).map((product) => [product.mint, product.productId]),
);

export async function readTerminalTrades(input: {
  wallet: string;
  cluster: XpCluster;
  endpoints: readonly string[];
}): Promise<XpTerminalTrade[]> {
  const signatures = await rpc<Array<{ signature: string; err: unknown; blockTime: number | null }>>(
    input.endpoints,
    "getSignaturesForAddress",
    [input.wallet, { limit: MAX_SIGNATURES }],
  );
  if (!signatures?.length) return [];

  const trades: XpTerminalTrade[] = [];
  for (const entry of signatures) {
    if (entry.err) continue;
    const transaction = await rpc<ParsedTransaction>(input.endpoints, "getTransaction", [
      entry.signature,
      { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    ]);
    if (!transaction || transaction.meta?.err) continue;

    const before = ownedBalances(transaction.meta?.preTokenBalances, input.wallet);
    const after = ownedBalances(transaction.meta?.postTokenBalances, input.wallet);
    const mints = new Set([...before.keys(), ...after.keys()]);
    for (const mint of mints) {
      const productId = productIdByMint.get(mint);
      if (!productId || !getSolanaExecutionProduct(productId)) continue;
      const delta = (after.get(mint) ?? 0n) - (before.get(mint) ?? 0n);
      if (delta === 0n) continue;
      const settledAt = new Date((entry.blockTime ?? transaction.blockTime ?? 0) * 1_000).toISOString();
      trades.push({
        signature: entry.signature,
        cluster: input.cluster,
        productId,
        direction: delta > 0n ? "buy" : "sell",
        settledAt,
      });
    }
  }
  return trades;
}
