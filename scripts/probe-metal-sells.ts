import {
  solanaExecutionProducts,
  solanaSettlementAssets,
} from "../lib/product-registry";

const apiKey = process.env.JUPITER_API_KEY?.trim() ?? null;
const JUPITER_QUOTE_URL = apiKey
  ? "https://api.jup.ag/swap/v2/order"
  : "https://lite-api.jup.ag/swap/v1/quote";
const SOLANA_USDC_MINT = solanaSettlementAssets.usdc.mint;
const PROBE_USD_BASE_UNITS = "10000000";
const REQUEST_INTERVAL_MS = apiKey ? 850 : 180;
const requestedSymbols = new Set(process.argv.slice(2).map((value) => value.toLowerCase()));
const products = Object.values(solanaExecutionProducts);
const probeProducts = requestedSymbols.size
  ? products.filter((product) => requestedSymbols.has(product.symbol.toLowerCase()))
  : products;

if (requestedSymbols.size && probeProducts.length !== requestedSymbols.size) {
  throw new Error("One or more requested symbols do not have an active Solana adapter.");
}

async function main() {
  const readQuote = async (params: URLSearchParams) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(`${JUPITER_QUOTE_URL}?${params}`, {
        cache: "no-store",
        headers: apiKey ? { "x-api-key": apiKey } : undefined,
      });
      const payload = (await response.json()) as Record<string, unknown>;
      const rateLimited = response.status === 429 || String(payload.error ?? "").includes("Too many requests");
      if (!rateLimited || attempt === 3) return { response, payload };
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
    throw new Error("Jupiter quote retry loop ended unexpectedly.");
  };
  const results = [];
  for (const product of probeProducts) {
    let inputAmount = "0";
    try {
      const buyParams = new URLSearchParams({
        inputMint: SOLANA_USDC_MINT,
        outputMint: product.mint,
        amount: PROBE_USD_BASE_UNITS,
        slippageBps: "50",
      });
      const { response: buyResponse, payload: buyPayload } = await readQuote(buyParams);
      if (!buyResponse.ok || typeof buyPayload.outAmount !== "string" || !/^\d+$/.test(buyPayload.outAmount)) {
        throw new Error(String(buyPayload.error ?? buyPayload.message ?? "No $10 buy probe output."));
      }
      inputAmount = buyPayload.outAmount;
    } catch (error) {
      for (const settlementAsset of Object.values(solanaSettlementAssets)) {
        results.push({
          productId: product.productId,
          symbol: product.symbol,
          settlementAsset: settlementAsset.symbol,
          inputAmount,
          outputAmount: null,
          protectedOutput: null,
          priceImpactPct: null,
          routeable: false,
          error: `Could not size the $10 round-trip probe: ${error instanceof Error ? error.message : String(error)}`,
          latencyMs: 0,
        });
      }
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
    for (const settlementAsset of Object.values(solanaSettlementAssets)) {
      const startedAt = Date.now();
      try {
        const params = new URLSearchParams({
          inputMint: product.mint,
          outputMint: settlementAsset.mint,
          amount: inputAmount,
          slippageBps: "50",
        });
        const { response, payload } = await readQuote(params);
        const outputAmount = typeof payload.outAmount === "string" ? payload.outAmount : null;
        const protectedOutput = typeof payload.otherAmountThreshold === "string"
          ? payload.otherAmountThreshold
          : outputAmount;
        if (!response.ok) throw new Error(String(payload.error ?? payload.message ?? response.status));
        if (
          payload.inputMint !== product.mint ||
          payload.outputMint !== settlementAsset.mint ||
          payload.inAmount !== inputAmount
        ) {
          throw new Error("Jupiter returned an unexpected reverse-route asset or amount.");
        }
        if (
          !outputAmount || !protectedOutput ||
          !/^\d+$/.test(outputAmount) || !/^\d+$/.test(protectedOutput) ||
          BigInt(outputAmount) <= 0n || BigInt(protectedOutput) <= 0n
        ) {
          throw new Error("Jupiter returned no protected reverse-route output.");
        }
        const rawImpact = Number(apiKey ? payload.priceImpact : payload.priceImpactPct);
        const priceImpactPct = Number.isFinite(rawImpact) ? rawImpact * (apiKey ? 1 : 100) : null;
        results.push({
          productId: product.productId,
          symbol: product.symbol,
          settlementAsset: settlementAsset.symbol,
          inputAmount,
          outputAmount,
          protectedOutput,
          priceImpactPct,
          routeable: priceImpactPct !== null && priceImpactPct <= product.execution.maximumPriceImpactPct,
          latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        results.push({
          productId: product.productId,
          symbol: product.symbol,
          settlementAsset: settlementAsset.symbol,
          inputAmount,
          outputAmount: null,
          protectedOutput: null,
          priceImpactPct: null,
          routeable: false,
          error: error instanceof Error ? error.message : String(error),
          latencyMs: Date.now() - startedAt,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
    }
  }

  const failed = results.filter((result) => !result.routeable);
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    mode: `read-only Jupiter ${apiKey ? "Swap V2" : "public V1"} route probe; no wallet, signature, or transaction`,
    adapterCount: probeProducts.length,
    settlementAssetCount: Object.keys(solanaSettlementAssets).length,
    routeCount: results.length,
    routeableCount: results.length - failed.length,
    allRouteable: failed.length === 0,
    results,
  }, null, 2));

  if (failed.length > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
