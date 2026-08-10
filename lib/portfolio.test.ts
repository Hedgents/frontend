import assert from "node:assert/strict";
import test from "node:test";
import { aggregatePortfolioBalances, formatBaseUnitsExact } from "./portfolio";
import {
  SOLANA_USDC_MINT,
  solanaExecutionProducts,
} from "./product-registry";

test("formats token balances without floating-point rounding", () => {
  assert.equal(formatBaseUnitsExact("1000001", 6), "1.000001");
  assert.equal(formatBaseUnitsExact("1", 9), "0.000000001");
  assert.equal(formatBaseUnitsExact("0", 6), "0");
});

test("aggregates classic and Token-2022 accounts by pinned mint", () => {
  const paxg = solanaExecutionProducts["gold-paxg"];
  const balances = aggregatePortfolioBalances([
    { mint: paxg.mint, tokenAmount: { amount: "125000", decimals: paxg.decimals } },
    { mint: paxg.mint, tokenAmount: { amount: "25000", decimals: paxg.decimals } },
    { mint: SOLANA_USDC_MINT, tokenAmount: { amount: "42000000", decimals: 6 } },
    { mint: "unknown", tokenAmount: { amount: "999", decimals: 9 } },
  ]);
  assert.equal(balances.find((asset) => asset.productId === "gold-paxg")?.amount, "0.15");
  assert.equal(balances.find((asset) => asset.symbol === "USDC")?.amount, "42");
  assert.equal(balances.length, 18);
});

test("rejects metadata that does not match a pinned mint", () => {
  assert.throws(() => aggregatePortfolioBalances([
    { mint: SOLANA_USDC_MINT, tokenAmount: { amount: "1", decimals: 9 } },
  ]));
});
