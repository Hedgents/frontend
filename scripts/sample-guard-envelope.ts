/**
 * Zero-spend sampler for the two production guard settings that cannot be chosen from a single
 * matrix run: HEDGENTS_SOLANA_PROGRAM_ALLOWLIST and HEDGENTS_MAX_SOL_DEBIT_LAMPORTS.
 *
 * Both fail closed. A program list built from one sample misses every venue Jupiter did not happen
 * to pick that minute, and a debit cap pinned to one observation rejects the next transaction that
 * opens one more account. This script repeats the real order and simulation path across several
 * trade sizes so the operator sets both from a distribution rather than from a single lucky route.
 * It also reports each distinct program-set fingerprint, which is what the optional
 * HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST pin would have to enumerate.
 *
 * No key is used, nothing is signed, and nothing is submitted.
 *
 *   npx tsx scripts/sample-guard-envelope.ts [productId] [samplesPerSize]
 */
import { getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/kit";
import { normalizeJupiterPriceImpact } from "../lib/execution-validation";
import { solanaExecutionProducts, solanaSettlementAssets } from "../lib/product-registry";
import { guardSolanaTransaction, type SolanaSimulationValue } from "../lib/solana-transaction-guard";

const JUPITER_ORDER_URL = "https://api.jup.ag/swap/v2/order";
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const addressEncoder = getAddressEncoder();

const apiKey = process.env.JUPITER_API_KEY?.trim();
if (!apiKey) throw new Error("JUPITER_API_KEY is required.");

const rpcUrls = [...new Set((process.env.HEDGENTS_SOLANA_MAINNET_RPC_URLS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean))];
if (rpcUrls.length === 0) throw new Error("Set HEDGENTS_SOLANA_MAINNET_RPC_URLS.");

const productId = process.argv[2] ?? "gold-paxg";
const resolvedProduct = Object.values(solanaExecutionProducts).find((entry) => entry.productId === productId);
if (!resolvedProduct) throw new Error(`Unknown product ${productId}.`);
const product = resolvedProduct;
const samplesPerSize = Number(process.argv[3] ?? "3");
if (!Number.isInteger(samplesPerSize) || samplesPerSize < 1) throw new Error("samplesPerSize must be a positive integer.");

// The closed beta runs a $100 ceiling, so sample the sizes a tester can actually submit.
const sizesUsd = [10, 25, 50, 100].filter(
  (size) => size >= product.execution.minimumUsd && size <= product.execution.maximumUsd,
);
const settlement = solanaSettlementAssets.usdc;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpcRequest<T>(method: string, params: unknown[]) {
  let lastError = "Solana RPC unavailable.";
  for (const rpcUrl of rpcUrls) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: `hedgents-envelope-${method}`, method, params }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await wait(300 * (attempt + 1));
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = `RPC returned ${response.status}.`;
        await wait(300 * (attempt + 1));
        continue;
      }
      if (!response.ok) {
        lastError = `RPC returned ${response.status}.`;
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
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${JUPITER_ORDER_URL}?${params}`, { headers: { "x-api-key": apiKey! } });
    const payload = (await response.json()) as Record<string, unknown>;
    if (response.ok) return payload;
    if (response.status !== 429 && response.status < 500) {
      throw new Error(String(payload.errorMessage ?? payload.error ?? `Jupiter returned ${response.status}.`));
    }
    await wait(500 * (attempt + 1));
  }
  throw new Error("Jupiter order service unavailable.");
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
  const largest = await rpcRequest<{ value?: Array<{ address: string; amount: string }> }>(
    "getTokenLargestAccounts",
    [mint, { commitment: "confirmed" }],
  );
  for (const account of largest.value ?? []) {
    if (!/^\d+$/.test(account.amount) || BigInt(account.amount) < minimumAmount) continue;
    const info = await rpcRequest<{ value?: { data?: { parsed?: { info?: { owner?: string } } } } }>(
      "getAccountInfo",
      [account.address, { encoding: "jsonParsed", commitment: "confirmed" }],
    );
    const owner = info.value?.data?.parsed?.info?.owner;
    if (!owner || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) continue;
    // Jupiter builds against the taker's associated token account, so a whale holding through a
    // non-ATA account is not a usable simulated taker.
    if (await associatedTokenAddress(owner, mint, tokenProgramAddress) !== account.address) continue;
    const balance = await rpcRequest<{ value?: number }>("getBalance", [owner, { commitment: "confirmed" }]);
    if ((balance.value ?? 0) >= 5_000_000) return owner;
  }
  throw new Error("No usable public holder was found.");
}

interface Sample {
  direction: "buy" | "sell";
  sizeUsd: number;
  router: string | null;
  fingerprint: string;
  programIds: string[];
  solDebitLamports: number;
  networkFeeLamports: number;
  priceImpactPct: number | null;
}

async function sampleOnce(
  direction: "buy" | "sell",
  sizeUsd: number,
  taker: string,
  inputMint: string,
  outputMint: string,
  inputAmount: string,
): Promise<Sample> {
  const payload = await jupiterOrder(new URLSearchParams({
    inputMint,
    outputMint,
    amount: inputAmount,
    taker,
    excludeRouters: "jupiterz",
  }));
  if (payload.inputMint !== inputMint || payload.outputMint !== outputMint || payload.inAmount !== inputAmount) {
    throw new Error("Jupiter returned an unexpected asset or amount.");
  }
  const transaction = typeof payload.transaction === "string" ? payload.transaction : null;
  if (!transaction) throw new Error(String(payload.errorMessage ?? "Jupiter returned no signable transaction."));
  const minimumOutputAmount = typeof payload.otherAmountThreshold === "string"
    ? payload.otherAmountThreshold
    : String(payload.outAmount);

  const simulation = await rpcRequest<{ value?: SolanaSimulationValue }>("simulateTransaction", [
    transaction,
    {
      encoding: "base64",
      commitment: "confirmed",
      sigVerify: false,
      replaceRecentBlockhash: false,
      innerInstructions: true,
    },
  ]);
  const value = simulation?.value;
  if (!value) throw new Error("Solana RPC returned no simulation result.");
  if (value.err) throw new Error(`Simulation failed: ${JSON.stringify(value.err)}`);

  // Sampling must observe what the route actually does, so the debit ceiling is deliberately wide
  // here. The point of the run is to report the real maximum, not to pass a cap.
  const guard = guardSolanaTransaction(transaction, value, {
    taker,
    inputMint,
    outputMint,
    inputAmount,
    minimumOutputAmount,
    maximumSolDebitLamports: "1000000000",
  });
  return {
    direction,
    sizeUsd,
    router: typeof payload.router === "string" ? payload.router : null,
    fingerprint: guard.programFingerprint,
    programIds: guard.programIds,
    solDebitLamports: Number(guard.takerSolDebitLamports),
    networkFeeLamports: Number(guard.networkFeeLamports),
    priceImpactPct: normalizeJupiterPriceImpact(payload),
  };
}

async function main() {
  const buyTaker = process.env.HEDGENTS_SIMULATION_WALLET?.trim()
    ?? await findPublicHolder(
      settlement.mint,
      BigInt(Math.max(...sizesUsd) * 10 ** settlement.decimals),
      settlement.tokenProgramAddress,
    );

  const samples: Sample[] = [];
  const failures: Array<{ direction: string; sizeUsd: number; error: string }> = [];
  let sellTaker: string | null = null;

  for (const sizeUsd of sizesUsd) {
    const buyAmount = String(Math.round(sizeUsd * 10 ** settlement.decimals));
    for (let sample = 0; sample < samplesPerSize; sample += 1) {
      try {
        samples.push(await sampleOnce("buy", sizeUsd, buyTaker, settlement.mint, product.mint, buyAmount));
      } catch (error) {
        failures.push({ direction: "buy", sizeUsd, error: error instanceof Error ? error.message : String(error) });
      }
      await wait(900);
    }
  }

  // Size the sell leg from a real buy so the metal amount matches what a tester would be holding.
  const referenceBuy = samples.find((entry) => entry.direction === "buy");
  for (const sizeUsd of sizesUsd) {
    let sellAmount: bigint;
    try {
      const order = await jupiterOrder(new URLSearchParams({
        inputMint: settlement.mint,
        outputMint: product.mint,
        amount: String(Math.round(sizeUsd * 10 ** settlement.decimals)),
        taker: buyTaker,
        excludeRouters: "jupiterz",
      }));
      sellAmount = BigInt(String(order.outAmount));
    } catch {
      failures.push({ direction: "sell", sizeUsd, error: "Could not size the sell leg from a buy quote." });
      continue;
    }
    if (!sellTaker) {
      try {
        sellTaker = await findPublicHolder(product.mint, sellAmount, product.tokenProgramAddress);
      } catch (error) {
        failures.push({ direction: "sell", sizeUsd, error: error instanceof Error ? error.message : String(error) });
        continue;
      }
    }
    for (let sample = 0; sample < samplesPerSize; sample += 1) {
      try {
        samples.push(await sampleOnce(
          "sell", sizeUsd, sellTaker, product.mint, settlement.mint, sellAmount.toString(),
        ));
      } catch (error) {
        failures.push({ direction: "sell", sizeUsd, error: error instanceof Error ? error.message : String(error) });
      }
      await wait(900);
    }
  }

  const byFingerprint = new Map<string, { programIds: string[]; count: number; directions: Set<string>; routers: Set<string> }>();
  for (const sample of samples) {
    const entry = byFingerprint.get(sample.fingerprint)
      ?? { programIds: sample.programIds, count: 0, directions: new Set<string>(), routers: new Set<string>() };
    entry.count += 1;
    entry.directions.add(sample.direction);
    if (sample.router) entry.routers.add(sample.router);
    byFingerprint.set(sample.fingerprint, entry);
  }
  const debits = samples.map((sample) => sample.solDebitLamports);
  const observedMaximum = debits.length ? Math.max(...debits) : 0;

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    mode: "read-only sampling; no signature and no submission",
    productId: product.productId,
    settlementAssetId: settlement.id,
    sizesUsd,
    samplesPerSize,
    sampleCount: samples.length,
    failureCount: failures.length,
    buyWallet: `${buyTaker.slice(0, 5)}…${buyTaker.slice(-4)}`,
    sellWallet: sellTaker ? `${sellTaker.slice(0, 5)}…${sellTaker.slice(-4)}` : null,
    solDebitLamports: {
      minimum: debits.length ? Math.min(...debits) : null,
      maximum: observedMaximum || null,
      // A cap must clear the widest observed transaction with room for one extra rent-exempt
      // account, or the next route that opens one more account fails closed for the tester.
      recommendedCap: observedMaximum ? observedMaximum + 2_100_000 : null,
    },
    distinctFingerprints: byFingerprint.size,
    fingerprints: [...byFingerprint.entries()]
      .sort((left, right) => right[1].count - left[1].count)
      .map(([fingerprint, entry]) => ({
        fingerprint,
        observations: entry.count,
        directions: [...entry.directions],
        routers: [...entry.routers],
        programIds: entry.programIds,
      })),
    failures,
    samples,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
