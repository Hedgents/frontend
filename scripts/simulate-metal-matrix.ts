import { getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/kit";
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
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const addressEncoder = getAddressEncoder();
const DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";

const apiKey = process.env.JUPITER_API_KEY?.trim();
if (!apiKey) throw new Error("JUPITER_API_KEY is required.");
const maximumSolDebitLamports = configuredMaximumSolDebitLamports();

const configuredBuyTaker = process.env.HEDGENTS_SIMULATION_WALLET?.trim() || null;
if (configuredBuyTaker && (configuredBuyTaker.length < 32 || configuredBuyTaker.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(configuredBuyTaker))) {
  throw new Error("HEDGENTS_SIMULATION_WALLET must be a valid Solana public address. No private key is used.");
}

const configuredRpcUrls = [...new Set([
  ...(process.env.HEDGENTS_SOLANA_MAINNET_RPC_URLS ?? "").split(","),
  process.env.HEDGENTS_SOLANA_MAINNET_RPC_URL ?? "",
  process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL ?? "",
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet" ? process.env.HEDGENTS_SOLANA_RPC_URL ?? "" : "",
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet" ? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "" : "",
].map((value) => value.trim()).filter(Boolean))];

function rpcHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// The public endpoint is never appended silently. Without the opt-in, a typo in the RPC variable
// would produce a clean-looking artifact that was actually served by one rate-limited endpoint.
const allowPublicRpc = process.env.HEDGENTS_ALLOW_PUBLIC_RPC?.trim() === "true";
const rpcUrls = [...new Set(
  allowPublicRpc ? [...configuredRpcUrls, DEFAULT_SOLANA_RPC] : configuredRpcUrls,
)];
if (rpcUrls.length === 0) {
  throw new Error(
    "Set HEDGENTS_SOLANA_MAINNET_RPC_URLS to two independent providers, or set HEDGENTS_ALLOW_PUBLIC_RPC=true to accept the public endpoint.",
  );
}
const rpcHosts = [...new Set(rpcUrls.map(rpcHost))];
// "Two independent RPCs" means the simulation is confirmed against a second provider, not that a
// second URL exists to fail over to. Distinct hosts, not distinct strings.
const primaryRpcUrl = rpcUrls[0];
const confirmationRpcUrl = rpcUrls.find((url) => rpcHost(url) !== rpcHost(primaryRpcUrl)) ?? null;
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

const RPC_TIMEOUT_MS = 20_000;

async function rpcRequest<T>(method: string, params: unknown[], endpoints: string[] = rpcUrls) {
  let lastError = "Solana RPC unavailable.";
  for (const rpcUrl of endpoints) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: `hedgents-matrix-${method}`,
            method,
            params,
          }),
          signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        });
      } catch (error) {
        // A transport failure or timeout must fail over to the next provider rather than abort the
        // whole matrix, exactly like a 429 or a 5xx.
        lastError = `${rpcHost(rpcUrl)}: ${error instanceof Error ? error.message : String(error)}`;
        await wait(300 * (attempt + 1));
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = `${rpcHost(rpcUrl)} returned ${response.status}.`;
        await wait(300 * (attempt + 1));
        continue;
      }
      if (!response.ok) {
        lastError = `${rpcHost(rpcUrl)} returned ${response.status}.`;
        break;
      }
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

async function guardOnEndpoints(
  transaction: string,
  expectation: Omit<TransactionGuardExpectation, "maximumSolDebitLamports">,
  endpoints: string[],
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
  ], endpoints);
  const result = payload?.value;
  if (!result) throw new Error("Solana RPC returned no simulation result.");
  // The guard requires err === null. A provider that omits the field entirely would otherwise be
  // rejected here as a route failure rather than reported as a provider defect.
  if (!("err" in result)) throw new Error("Solana RPC omitted the simulation error field.");
  if (result.err) {
    const usefulLog = result.logs?.slice().reverse().find((line) => line.includes("Error") || line.includes("failed"));
    throw new Error(usefulLog ?? `Simulation failed: ${JSON.stringify(result.err)}`);
  }
  return guardSolanaTransaction(transaction, result, {
    ...expectation,
    maximumSolDebitLamports,
  });
}

async function simulateTransaction(
  transaction: string,
  expectation: Omit<TransactionGuardExpectation, "maximumSolDebitLamports">,
) {
  const primary = await guardOnEndpoints(transaction, expectation, [primaryRpcUrl]);
  if (!confirmationRpcUrl) return { guard: primary, crossChecked: false };
  // Confirm the exact same signed bytes against a second, independent provider. A disagreement
  // means one provider's accounting cannot be trusted for a real-funds decision.
  const confirmation = await guardOnEndpoints(transaction, expectation, [confirmationRpcUrl]);
  if (confirmation.reportDigest !== primary.reportDigest) {
    throw new Error(
      `Independent RPC disagreement between ${rpcHost(primaryRpcUrl)} and ${rpcHost(confirmationRpcUrl)}: `
      + `SOL debit ${primary.takerSolDebitLamports} vs ${confirmation.takerSolDebitLamports}, `
      + `fee ${primary.networkFeeLamports} vs ${confirmation.networkFeeLamports}, `
      + `programs ${primary.programFingerprint.slice(0, 12)} vs ${confirmation.programFingerprint.slice(0, 12)}.`,
    );
  }
  return { guard: primary, crossChecked: true };
}

async function associatedTokenAddress(owner: string, mint: string, tokenProgramAddress: string) {
  const [address] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID as Address,
    seeds: [
      addressEncoder.encode(owner as Address),
      addressEncoder.encode(tokenProgramAddress as Address),
      addressEncoder.encode(mint as Address),
    ],
  });
  return address as string;
}

async function findPublicHolder(mint: string, minimumAmount: bigint, tokenProgramAddress: string) {
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
    if (!owner || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) continue;
    // Jupiter builds the swap against the taker's associated token account, not against whichever
    // token account happens to be large. A whale that custodies through a non-ATA account reports
    // "Insufficient funds" and would be recorded as a missing route rather than a bad taker choice.
    if (await associatedTokenAddress(owner, mint, tokenProgramAddress) !== account.address) continue;
    const balance = await rpcRequest<{ value?: number }>("getBalance", [owner, { commitment: "confirmed" }]);
    if ((balance.value ?? 0) >= 5_000_000) return owner;
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
  solanaSettlementAssets.usdc.tokenProgramAddress,
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
      excludeRouters: "jupiterz,okx,dflow",
    }));
    const validated = validateOrder(payload, {
      inputMint: product.execution.inputMint,
      outputMint: product.mint,
      inputAmount,
      maximumPriceImpactPct: product.execution.maximumPriceImpactPct,
    });
    buyOutputAmount = validated.outputAmount;
    phase = "simulation";
    const { guard, crossChecked } = await simulateTransaction(validated.transaction, {
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
      programIds: guard.programIds,
      crossCheckedOnSecondRpc: crossChecked,
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
    sellTaker = await findPublicHolder(product.mint, sellAmount, product.tokenProgramAddress);
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
        excludeRouters: "jupiterz,okx,dflow",
      }));
      const validated = validateOrder(payload, {
        inputMint: product.mint,
        outputMint: settlement.mint,
        inputAmount,
        maximumPriceImpactPct: product.execution.maximumPriceImpactPct,
      });
      phase = "simulation";
      const { guard, crossChecked } = await simulateTransaction(validated.transaction, {
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
        programIds: guard.programIds,
        crossCheckedOnSecondRpc: crossChecked,
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
// Emit each candidate fingerprint together with the exact program set it authorizes. Reviewing a
// bare hash is not something an operator can actually do.
const fingerprintPrograms = new Map<string, string[]>();
for (const result of results) {
  if (typeof result.programFingerprint !== "string") continue;
  if (!fingerprintPrograms.has(result.programFingerprint)) {
    fingerprintPrograms.set(result.programFingerprint, (result.programIds as string[] | undefined) ?? []);
  }
}
const programFingerprints = [...fingerprintPrograms.keys()].sort();
const passedResults = results.filter((result) => result.status === "passed");
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  mode: "read-only simulation; public state only; no signature and no submission",
  buyWallet: `${buyTaker.slice(0, 5)}…${buyTaker.slice(-4)}`,
  rpcEndpointHosts: rpcHosts,
  independentRpcCount: rpcHosts.length,
  publicRpcAccepted: allowPublicRpc,
  crossCheckedOnSecondRpc: confirmationRpcUrl !== null,
  adapterCount: Object.keys(solanaExecutionProducts).length,
  routeCount: results.length,
  buyPassed: buyResults.filter((result) => result.status === "passed").length,
  sellPassed: sellResults.filter((result) => result.status === "passed").length,
  failedCount: failed.length,
  allPassed: failed.length === 0,
  twoRpcGateSatisfied: confirmationRpcUrl !== null
    && passedResults.length > 0
    && passedResults.every((result) => result.crossCheckedOnSecondRpc === true),
  reviewedProgramFingerprintCandidates: programFingerprints.map((fingerprint) => ({
    fingerprint,
    programIds: fingerprintPrograms.get(fingerprint) ?? [],
  })),
  results,
}, null, 2));

if (!confirmationRpcUrl) {
  console.error(
    "WARNING: only one independent RPC host was configured, so no simulation was cross-checked. "
    + "This artifact does not satisfy the two-independent-RPC launch gate.",
  );
}

if (failed.length > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
