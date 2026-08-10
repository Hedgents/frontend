import {
  SOLANA_USDC_MINT,
  solanaExecutionProducts,
} from "../lib/product-registry";

const apiKey = process.env.JUPITER_API_KEY?.trim() || null;
const JUPITER_QUOTE_URL = apiKey
  ? "https://api.jup.ag/swap/v2/order"
  : "https://lite-api.jup.ag/swap/v1/quote";

const amountUsd = Number(process.argv[2] ?? "100");
if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
  throw new Error("Pass a positive USDC probe amount.");
}

const requestedSymbols = new Set(process.argv.slice(3).map((value) => value.toLowerCase()));
const products = Object.values(solanaExecutionProducts);
const probeProducts = requestedSymbols.size
  ? products.filter((product) => requestedSymbols.has(product.symbol.toLowerCase()))
  : products;

if (requestedSymbols.size && probeProducts.length !== requestedSymbols.size) {
  const matched = new Set(probeProducts.map((product) => product.symbol.toLowerCase()));
  const missing = [...requestedSymbols].filter((symbol) => !matched.has(symbol));
  throw new Error(`Unknown or inactive product symbol: ${missing.join(", ")}`);
}

const amount = String(Math.round(amountUsd * 1_000_000));
const results: Array<{ routeable: boolean; [key: string]: unknown }> = [];

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function priceImpactPct(payload: Record<string, unknown>) {
  if (apiKey) return numberValue(payload.priceImpact);
  const ratio = numberValue(payload.priceImpactPct);
  return ratio === null ? null : ratio * 100;
}

async function main() {
for (const product of probeProducts) {
  const params = new URLSearchParams({
    inputMint: SOLANA_USDC_MINT,
    outputMint: product.mint,
    amount,
  });
  if (!apiKey) params.set("slippageBps", "50");
  const startedAt = Date.now();
  try {
    const response = await fetch(`${JUPITER_QUOTE_URL}?${params}`, {
      headers: apiKey ? { "x-api-key": apiKey } : undefined,
    });
    const payload = (await response.json()) as Record<string, unknown>;
    const outAmount = typeof payload.outAmount === "string" ? payload.outAmount : null;
    const impact = priceImpactPct(payload);
    const hasOutput = Boolean(outAmount && /^\d+$/.test(outAmount) && BigInt(outAmount) > 0n);
    const routeable = response.ok && hasOutput && impact !== null &&
      impact <= product.execution.maximumPriceImpactPct;
    results.push({
      productId: product.productId,
      symbol: product.symbol,
      outputMint: product.mint,
      amountUsd,
      status: response.status,
      routeable,
      outAmount,
      router: typeof payload.router === "string" ? payload.router : null,
      priceImpactPct: impact,
      maximumPriceImpactPct: product.execution.maximumPriceImpactPct,
      errorCode: payload.errorCode ?? null,
      error: payload.errorMessage ?? payload.error ?? payload.message ??
        (impact === null ? "Jupiter did not report price impact." : null),
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    results.push({
      productId: product.productId,
      symbol: product.symbol,
      outputMint: product.mint,
      amountUsd,
      status: null,
      routeable: false,
      outAmount: null,
      router: null,
      priceImpactPct: null,
      maximumPriceImpactPct: product.execution.maximumPriceImpactPct,
      errorCode: null,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
    });
  }
}

const failed = results.filter((result) => !result.routeable);
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  mode: `read-only Jupiter ${apiKey ? "Swap V2" : "public V1"} route probe; no wallet, signature, or transaction`,
  activeAdapterCount: products.length,
  probedAdapterCount: results.length,
  routeableAdapterCount: results.length - failed.length,
  allRouteable: failed.length === 0,
  results,
}, null, 2));

if (failed.length > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
