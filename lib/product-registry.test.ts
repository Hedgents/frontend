import assert from "node:assert/strict";
import test from "node:test";
import { metalMarkets } from "./metals";
import {
  SOLANA_USDC_MINT,
  SOLANA_USDG_MINT,
  SOLANA_USDT_MINT,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  solanaExecutionProducts,
  solanaSettlementAssets,
} from "./product-registry";
import { validateSolanaAddress } from "./execution-validation";

test("pins seventeen unique mainnet metal adapters", () => {
  const entries = Object.entries(solanaExecutionProducts);
  assert.equal(entries.length, 17);
  assert.equal(new Set(entries.map(([, product]) => product.mint)).size, entries.length);

  for (const [productId, product] of entries) {
    assert.equal(product.productId, productId);
    assert.equal(validateSolanaAddress(product.mint), product.mint);
    assert.equal(product.chain, "Solana");
    assert.equal(product.cluster, "mainnet");
    assert.equal(product.execution.inputMint, SOLANA_USDC_MINT);
    assert.equal(product.execution.inputDecimals, 6);
    assert.ok(product.execution.minimumUsd > 0);
    assert.ok(product.execution.maximumUsd >= product.execution.minimumUsd);
    assert.ok(product.execution.maximumPriceImpactPct > 0);
    assert.ok(Array.isArray(product.execution.excludedDexes));
    assert.ok(["paxos", "oro", "matrixdock", "usdt0", "dominion", "xstocks", "ondo"].includes(product.eligibilityPolicyId));
    assert.equal(product.sources.some((source) => source.kind === "issuer"), true);
    assert.equal(product.sources.some((source) => source.kind === "directory"), true);
    assert.equal(product.sources.some((source) => source.kind === "explorer"), true);
  }
});

test("pins the three supported Solana settlement assets", () => {
  assert.deepEqual(Object.keys(solanaSettlementAssets), ["usdc", "usdt", "usdg"]);
  assert.equal(solanaSettlementAssets.usdc.mint, SOLANA_USDC_MINT);
  assert.equal(solanaSettlementAssets.usdt.mint, SOLANA_USDT_MINT);
  assert.equal(solanaSettlementAssets.usdg.mint, SOLANA_USDG_MINT);
  assert.equal(solanaSettlementAssets.usdc.tokenProgram, "SPL Token");
  assert.equal(solanaSettlementAssets.usdt.tokenProgram, "SPL Token");
  assert.equal(solanaSettlementAssets.usdg.tokenProgram, "Token-2022");
  for (const asset of Object.values(solanaSettlementAssets)) {
    assert.equal(validateSolanaAddress(asset.mint), asset.mint);
    assert.equal(asset.decimals, 6);
  }
});

test("GLDx carries its disclosed route-specific impact ceiling", () => {
  assert.equal(solanaExecutionProducts["gold-gldx"].execution.maximumPriceImpactPct, 1.25);
  assert.deepEqual(solanaExecutionProducts["gold-gldx"].execution.excludedDexes, ["Meteora DLMM"]);
  assert.equal(solanaExecutionProducts["gold-paxg"].execution.maximumPriceImpactPct, 1);
});

test("pins the correct token program and catalog exposure for every adapter", () => {
  for (const product of Object.values(solanaExecutionProducts)) {
    assert.equal(
      product.tokenProgramAddress,
      product.tokenProgram === "Token-2022" ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID,
    );
  }
  assert.equal(solanaExecutionProducts["gold-oro"].tokenProgram, "SPL Token");
  assert.equal(solanaExecutionProducts["gold-xaut0"].tokenProgram, "SPL Token");
  assert.equal(solanaExecutionProducts["silver-silv"].tokenProgram, "Token-2022");
  assert.equal(
    Object.values(solanaExecutionProducts).filter((product) => product.tokenProgram === "Token-2022").length,
    15,
  );

  const executableCatalogIds = metalMarkets.flatMap((market) =>
    market.products
      .filter((product) => product.availability === "Executable")
      .map((product) => product.id),
  );
  assert.deepEqual(
    [...executableCatalogIds].sort(),
    Object.keys(solanaExecutionProducts).sort(),
  );
});
