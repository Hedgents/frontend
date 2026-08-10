import type { PortfolioAssetBalance } from "@/lib/execution-types";
import {
  solanaExecutionProducts,
  solanaSettlementAssets,
} from "@/lib/product-registry";

export interface ParsedTokenAccount {
  mint?: string;
  tokenAmount?: {
    amount?: string;
    decimals?: number;
  };
}

export function formatBaseUnitsExact(rawAmount: string, decimals: number) {
  const padded = rawAmount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = decimals > 0 ? padded.slice(-decimals).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}

export function aggregatePortfolioBalances(accounts: ParsedTokenAccount[]): PortfolioAssetBalance[] {
  const catalog = [
    ...Object.values(solanaExecutionProducts).map((product) => ({
      kind: "metal" as const,
      productId: product.productId,
      mint: product.mint,
      symbol: product.symbol,
      name: product.displayName,
      decimals: product.decimals,
      tokenProgram: product.tokenProgram,
    })),
    ...Object.values(solanaSettlementAssets).map((asset) => ({
      kind: "stablecoin" as const,
      productId: null,
      mint: asset.mint,
      symbol: asset.symbol,
      name: asset.displayName,
      decimals: asset.decimals,
      tokenProgram: asset.tokenProgram,
    })),
  ];
  const byMint = new Map(catalog.map((asset) => [asset.mint, asset]));
  const totals = new Map(catalog.map((asset) => [asset.mint, 0n]));

  for (const account of accounts) {
    if (!account.mint || !byMint.has(account.mint)) continue;
    const asset = byMint.get(account.mint)!;
    const rawAmount = account.tokenAmount?.amount;
    if (!rawAmount || !/^\d+$/.test(rawAmount)) continue;
    if (account.tokenAmount?.decimals !== asset.decimals) {
      throw new Error(`RPC decimals did not match the pinned ${asset.symbol} mint.`);
    }
    totals.set(account.mint, (totals.get(account.mint) ?? 0n) + BigInt(rawAmount));
  }

  return catalog.map((asset) => {
    const rawAmount = (totals.get(asset.mint) ?? 0n).toString();
    return {
      ...asset,
      rawAmount,
      amount: formatBaseUnitsExact(rawAmount, asset.decimals),
    };
  });
}
