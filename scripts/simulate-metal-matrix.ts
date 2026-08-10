import { normalizeJupiterPriceImpact } from "../lib/execution-validation";
import {
  solanaExecutionProducts,
  solanaSettlementAssets,
} from "../lib/product-registry";
import { classifyRouteAvailability } from "../lib/route-availability";
import {
  configuredMaximumSolDebitLamports,
  guardSolanaTransaction,
  type SolanaSimulationValue,
  type TransactionGuardExpectation,
} from "../lib/solana-transaction-guard";

const JUPITER_ORDER_URL = "https://api.jup.ag/swap/v2/order";
const DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";

const apiKey = process.env.JUPITER_API_KEY?.trim();
if (!apiKey) throw new Error("JUPITER_API_KEY is required.");
const maximumSolDebitLamports = configuredMaximumSolDebitLamports();

const configuredBuyTaker = process.env.HEDGENTS_SIMULATION_WALLET?.trim() || null;
if (configuredBuyTaker && (configuredBuyTaker.length < 32 || configuredBuyTaker.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(configuredBuyTaker))) {
  throw new Error("HEDGENTS_SIMULATION_WALLET must be a valid Solana public address. No private key is used.");
}

const rpcUrls = [...new Set([
  ...(process.env.HEDGENTS_SOLANA_MAINNET_RPC_URLS ?? "").split(","),
  process.env.HEDGENTS_SOLANA_MAINNET_RPC_URL ?? "",
  process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL ?? "",
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet" ? process.env.HEDGENTS_SOLANA_RPC_URL ?? "" : "",
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet" ? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "" : "",
  DEFAULT_SOLANA_RPC,
].map((value) => value.trim()).filter(Boolean))];
const requestedAmount = process.argv[2] ? Number(process.argv[2]) : null;
if (requestedAmount !== null && (!Number.isFinite(requestedAmount) || requestedAmount <= 0)) {
  throw new Error("Pass a positive optional USDC simulation amount.");
}

interface LargestTokenAccount {
  address: string;
  amount: string;
}

interface ParsedAccountInfo {
  value?: {
    data?: {
      parsed?: { info?: { owner?: string } };
    };
  } | null;
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function rpcRequest<T>(method: string, params: unknown[]) {
  let lastError = "Solana RPC unavailable.";
  for (const rpcUrl of rpcUrls) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `hedgents-matrix-${method}`,
          method,
          params,
        }),
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = `Solana RPC returned ${response.status}.`;
        await wait(300 * (attempt + 1));
        continue;
      }
      if (!response.ok) throw new Error(`Solana RPC returned ${response.status}.`);
      const payload = (await response.json()) as { result?: T; error?: { message?: string } };
      if (payload.error) throw new Error(payload.error.message ?? "Solana RPC rejected the request.");
      if (payload.result === undefined) throw new Error("Solana RPC returned no result.");
      return payload.result;
    }
  }
  throw new Error(lastError);
}

async function jupiterOrder(params: URLSearchParams) {
  let lastError = "Jupiter order service unavailable.";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${JUPITER_ORDER_URL}?${params}`, {
      headers: { "x-api-key": apiKey! },
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (response.ok) return payload;
    lastError = String(
      payload.errorMessage ?? payload.error ?? payload.message ?? `Jupiter returned ${response.status}.`,
    );
    if (response.status !== 429 && response.status < 500) throw new Error(lastError);
    await wait(500 * (attempt + 1));
  }
  throw new Error(lastError);
}

async function simulateTransaction(
  transaction: string,
  expectation: Omit<TransactionGuardExpectation, "maximumSolDebitLamports">,
) {
  const payload = await rpcRequest<{ value?: SolanaSimulationValue }>("simulateTransaction", [
    transaction,
    {
      encoding: "base64",
      commitment: "confirmed",
      sigVerify: false,
      replaceRecentBlockhash: false,
      innerInstructions: true,
    },
  ]);
  const result = payload?.value;
  if (!result) throw new Error("Solana RPC returned no simulation result.");
  if (result.err) {
    const usefulLog = result.logs?.slice().reverse().find((line) => line.includes("Error") || line.includes("failed"));
    throw new Error(usefulLog ?? `Simulation failed: ${JSON.stringify(result.err)}`);
  }
  return guardSolanaTransaction(transaction, result, {
    ...expectation,
    maximumSolDebitLamports,
  });
}

async function findPublicHolder(mint: string, minimumAmount: bigint) {
  const largest = await rpcRequest<{ value?: LargestTokenAccount[] }>(
    "getTokenLargestAccounts",
    [mint, { commitment: "confirmed" }],
  );
  for (const account of largest.value ?? []) {
    if (!/^\d+$/.test(account.amount) || BigInt(account.amount) < minimumAmount) continue;
    const info = await rpcRequest<ParsedAccountInfo>(
      "getAccountInfo",
      [account.address, { encoding: "jsonParsed", commitment: "confirmed" }],
    );
    const owner = info.value?.data?.parsed?.info?.owner;
    if (owner && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) {
      const balance = await rpcRequest<{ value?: number }>("getBalance", [owner, { commitment: "confirmed" }]);
      if ((balance.value ?? 0) >= 5_000_000) return owner;
    }
  }
  throw new Error("No public holder with enough token balance was found for read-only sell simulation.");
}

function validateOrder(
  payload: Record<string, unknown>,
  expected: { inputMint: string; outputMint: string; inputAmount: string; maximumPriceImpactPct: number },
) {
  if (
    payload.inputMint !== expected.inputMint ||
    payload.outputMint !== expected.outputMint ||
    payload.inAmount !== expected.inputAmount
  ) {
    throw new Error("Jupiter returned an unexpected asset or amount.");
  }
  const outputAmount = typeof payload.outAmount === "string" ? payload.outAmount : null;
  const minimumOutputAmount = typeof payload.otherAmountThreshold === "string"
    ? payload.otherAmountThreshold
    : outputAmount;
  const transaction = typeof payload.transaction === "string" ? payload.transaction : null;
  const priceImpactPct = normalizeJupiterPriceImpact(payload);
  if (
    !outputAmount
    || !minimumOutputAmount
    || !/^\d+$/.test(outputAmount)
    || !/^\d+$/.test(minimumOutputAmount)
    || BigInt(outputAmount) <= 0n
    || BigInt(minimumOutputAmount) <= 0n
    || BigInt(minimumOutputAmount) > BigInt(outputAmount)
  ) {
    throw new Error("Jupiter returned no executable output.");
  }
  if (!transaction || transaction.length < 100) throw new Error("Jupiter returned no signable transaction.");
  if (priceImpactPct === null) throw new Error("Jupiter did not report price impact.");
  if (priceImpactPct > expected.maximumPriceImpactPct) {
    throw new Error(`${priceImpactPct.toFixed(2)}% price impact exceeds the adapter guardrail.`);
  }
  return { outputAmount, minimumOutputAmount, transaction, priceImpactPct };
}

type MatrixResult = Record<string, unknown> & { status: "passed" | "failed" };
async function main() {
const results: MatrixResult[] = [];
const maximumBuyAmount = Math.max(...Object.values(solanaExecutionProducts).map((product) => requestedAmount ?? product.execution.probeUsd));
const buyTaker = configuredBuyTaker ?? await findPublicHolder(
  solanaSettlementAssets.usdc.mint,
  BigInt(Math.ceil(maximumBuyAmount * 10 ** solanaSettlementAssets.usdc.decimals)),
);

for (const product of Object.values(solanaExecutionProducts)) {
  const amountUsd = requestedAmount ?? product.execution.probeUsd;
  const buyStartedAt = Date.now();
  let buyOutputAmount: string | null = null;
  let phase = "order";
  try {
    if (amountUsd < product.execution.minimumUsd || amountUsd > product.execution.maximumUsd) {
      throw new Error(`$${amountUsd} is outside this adapter's execution bounds.`);
    }
    const inputAmount = String(Math.round(amountUsd * 10 ** product.execution.inputDecimals));
    const payload = await jupiterOrder(new URLSearchParams({
      inputMint: product.execution.inputMint,
      outputMint: product.mint,
      amount: inputAmount,
      taker: buyTaker,
      excludeRouters: "jupiterz",
    }));
    const validated = validateOrder(payload, {
      inputMint: product.execution.inputMint,
      outputMint: product.mint,
      inputAmount,
      maximumPriceImpactPct: product.execution.maximumPriceImpactPct,
    });
    buyOutputAmount = validated.outputAmount;
    phase = "simulation";
    const guard = await simulateTransaction(validated.transaction, {
      taker: buyTaker,
      inputMint: product.execution.inputMint,
      outputMint: product.mint,
      inputAmount,
      minimumOutputAmount: validated.minimumOutputAmount,
    });
    results.push({
      direction: "buy",
      productId: product.productId,
      symbol: product.symbol,
      settlementAssetId: "usdc",
      amountUsd,
      status: "passed",
      outputAmount: validated.outputAmount,
      priceImpactPct: validated.priceImpactPct,
      router: typeof payload.router === "string" ? payload.router : null,
      unitsConsumed: guard.unitsConsumed,
      programFingerprint: guard.programFingerprint,
      takerSolDebitLamports: guard.takerSolDebitLamports,
      networkFeeLamports: guard.networkFeeLamports,
      latencyMs: Date.now() - buyStartedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      direction: "buy",
      productId: product.productId,
      symbol: product.symbol,
      settlementAssetId: "usdc",
      amountUsd,
      status: "failed",
      phase,
      availabilityReason: classifyRouteAvailability(message),
      error: message,
      latencyMs: Date.now() - buyStartedAt,
    });
  }

  const fallbackSellAmount = 10n ** BigInt(Math.max(0, product.decimals - 3));
  const sellAmount = buyOutputAmount && BigInt(buyOutputAmount) > 10n
    ? BigInt(buyOutputAmount) / 10n
    : fallbackSellAmount;
  let sellTaker: string | null = null;
  try {
    sellTaker = await findPublicHolder(product.mint, sellAmount);
  } catch {
    sellTaker = null;
  }

  for (const settlement of Object.values(solanaSettlementAssets)) {
    const sellStartedAt = Date.now();
    phase = "holder-discovery";
    try {
      if (!sellTaker) {
        throw new Error("No public holder is available for read-only sell simulation.");
      }
      phase = "order";
      const inputAmount = sellAmount.toString();
      const payload = await jupiterOrder(new URLSearchParams({
        inputMint: product.mint,
        outputMint: settlement.mint,
        amount: inputAmount,
        taker: sellTaker,
        excludeRouters: "jupiterz",
      }));
      const validated = validateOrder(payload, {
        inputMint: product.mint,
        outputMint: settlement.mint,
        inputAmount,
        maximumPriceImpactPct: product.execution.maximumPriceImpactPct,
      });
      phase = "simulation";
      const guard = await simulateTransaction(validated.transaction, {
        taker: sellTaker,
        inputMint: product.mint,
        outputMint: settlement.mint,
        inputAmount,
        minimumOutputAmount: validated.minimumOutputAmount,
      });
      results.push({
        direction: "sell",
        productId: product.productId,
        symbol: product.symbol,
        settlementAssetId: settlement.id,
        inputAmount,
        status: "passed",
        outputAmount: validated.outputAmount,
        priceImpactPct: validated.priceImpactPct,
        router: typeof payload.router === "string" ? payload.router : null,
        unitsConsumed: guard.unitsConsumed,
        programFingerprint: guard.programFingerprint,
        takerSolDebitLamports: guard.takerSolDebitLamports,
        networkFeeLamports: guard.networkFeeLamports,
        holder: `${sellTaker.slice(0, 5)}…${sellTaker.slice(-4)}`,
        latencyMs: Date.now() - sellStartedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        direction: "sell",
        productId: product.productId,
        symbol: product.symbol,
        settlementAssetId: settlement.id,
        inputAmount: sellAmount.toString(),
        status: "failed",
        phase,
        availabilityReason: classifyRouteAvailability(message),
        error: message,
        latencyMs: Date.now() - sellStartedAt,
      });
    }
  }
}

const failed = results.filter((result) => result.status === "failed");
const buyResults = results.filter((result) => result.direction === "buy");
const sellResults = results.filter((result) => result.direction === "sell");
const programFingerprints = [...new Set(
  results
    .map((result) => result.programFingerprint)
    .filter((value): value is string => typeof value === "string"),
)].sort();
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  mode: "read-only simulation; public state only; no signature and no submission",
  buyWallet: `${buyTaker.slice(0, 5)}…${buyTaker.slice(-4)}`,
  adapterCount: Object.keys(solanaExecutionProducts).length,
  routeCount: results.length,
  buyPassed: buyResults.filter((result) => result.status === "passed").length,
  sellPassed: sellResults.filter((result) => result.status === "passed").length,
  failedCount: failed.length,
  allPassed: failed.length === 0,
  reviewedProgramFingerprintCandidates: programFingerprints,
  results,
}, null, 2));

if (failed.length > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
