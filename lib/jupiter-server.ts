import "server-only";

import { executionErrorMessage } from "@/lib/execution-errors";
import { ExecutionValidationError } from "@/lib/execution-validation";
import type { ExecutionAuthorizationClaims } from "@/lib/execution-authorization";
import type { SettlementVerification } from "@/lib/execution-types";
import {
  calculateOwnerTokenDelta,
  type RpcTokenBalance,
} from "@/lib/settlement-verification";
import {
  serverSolanaRpcUrls,
  solanaRpcRequest,
  solanaRpcRequestFrom,
} from "@/lib/solana-rpc";
import { bindSolanaTransaction } from "@/lib/solana-transaction-binding";
import { readBoundedUpstreamJson } from "@/lib/safe-upstream-response";
import { expiredSettlementDecision } from "@/lib/execution-records";
import {
  assertProgramFingerprintAllowed,
  configuredMaximumSolDebitLamports,
  guardSolanaTransaction,
  type SolanaSimulationValue,
  type TransactionGuardExpectation,
  type TransactionGuardReport,
} from "@/lib/solana-transaction-guard";

const JUPITER_SWAP_V2 = "https://api.jup.ag/swap/v2";

/**
 * Jupiter's failure bodies, whose `error` is sometimes a string and sometimes an object.
 *
 * Typing it as a string was the bug: the object was passed straight through as an error message
 * and reached the operator as "[object Object]", hiding the venue's actual complaint through four
 * rounds of debugging. `unknown` forces every reader to extract rather than assume.
 */
interface JupiterErrorPayload {
  error?: unknown;
  errorMessage?: unknown;
  message?: unknown;
  code?: unknown;
}

export function hasJupiterApiKey() {
  return Boolean(process.env.JUPITER_API_KEY?.trim());
}

function jupiterApiKey() {
  const value = process.env.JUPITER_API_KEY?.trim();
  if (!value) {
    throw new ExecutionValidationError(
      "Jupiter execution is not configured on this deployment. Add the server-only JUPITER_API_KEY.",
      503,
    );
  }
  return value;
}

async function errorMessage(response: Response) {
  try {
    const payload = await readBoundedUpstreamJson<JupiterErrorPayload>(response, 64_000, "Jupiter");
    for (const candidate of [payload.errorMessage, payload.error, payload.message]) {
      if (candidate === undefined || candidate === null) continue;
      const extracted = executionErrorMessage(candidate);
      if (extracted && extracted !== "Execution did not complete.") {
        const code = payload.code;
        return typeof code === "number" || typeof code === "string"
          ? `Jupiter: ${extracted} (${code})`
          : `Jupiter: ${extracted}`;
      }
    }
    // Nothing readable in the body, but the body itself is still the best evidence there is.
    const serialised = JSON.stringify(payload);
    return serialised && serialised !== "{}"
      ? `Jupiter returned ${response.status}: ${serialised.slice(0, 300)}`
      : `Jupiter returned ${response.status}.`;
  } catch {
    return `Jupiter returned ${response.status}.`;
  }
}

export async function getJupiterOrder(params: URLSearchParams) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${JUPITER_SWAP_V2}/order?${params}`, {
      headers: { "x-api-key": jupiterApiKey() },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ExecutionValidationError(await errorMessage(response), response.status < 500 ? 400 : 502);
    }
    return await readBoundedUpstreamJson<Record<string, unknown>>(response, 2_000_000, "Jupiter order");
  } catch (error) {
    if (error instanceof ExecutionValidationError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ExecutionValidationError("Jupiter did not return a route in time.", 504);
    }
    throw new ExecutionValidationError("Jupiter is temporarily unavailable.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeJupiterOrder(body: {
  signedTransaction: string;
  requestId: string;
  lastValidBlockHeight?: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${JUPITER_SWAP_V2}/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": jupiterApiKey(),
      },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new ExecutionValidationError(await errorMessage(response), response.status < 500 ? 400 : 502);
    }
    return await readBoundedUpstreamJson<Record<string, unknown>>(response, 1_000_000, "Jupiter execution");
  } catch (error) {
    if (error instanceof ExecutionValidationError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ExecutionValidationError(
        "Execution status timed out. Check the wallet or explorer before retrying.",
        504,
      );
    }
    throw new ExecutionValidationError("Jupiter execution is temporarily unavailable.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export async function simulateSolanaTransaction(
  transaction: string,
  expectation: Omit<TransactionGuardExpectation, "maximumSolDebitLamports">,
  options: { sigVerify?: boolean } = {},
): Promise<TransactionGuardReport> {
  try {
    const resultEnvelope = await solanaRpcRequest<{ value?: SolanaSimulationValue }>(
      "simulateTransaction",
      [
        transaction,
        {
          encoding: "base64",
          commitment: "confirmed",
          sigVerify: options.sigVerify === true,
          replaceRecentBlockhash: false,
          innerInstructions: true,
        },
      ],
      { timeoutMs: 12_000, id: "hedgents-m2-simulation" },
    );
    const result = resultEnvelope.value;
    if (!result) throw new ExecutionValidationError("Solana RPC returned no simulation result.", 502);
    if (result.err) {
      const usefulLog = result.logs
        ?.slice()
        .reverse()
        .find((line) => line.includes("Error") || line.includes("failed"));
      throw new ExecutionValidationError(
        usefulLog ? `Simulation failed: ${usefulLog}` : "The route failed simulation and was not sent.",
        400,
      );
    }
    const report = guardSolanaTransaction(transaction, result, {
      ...expectation,
      maximumSolDebitLamports: configuredMaximumSolDebitLamports(),
    });
    assertProgramFingerprintAllowed(report);
    return report;
  } catch (error) {
    if (error instanceof ExecutionValidationError) throw error;
    throw new ExecutionValidationError(
      error instanceof Error ? `Solana simulation unavailable: ${error.message}` : "Solana simulation is temporarily unavailable.",
      502,
    );
  }
}

interface TransactionPayload {
  error?: { message?: string };
  result?: {
    transaction?: [string, "base64"];
    meta?: {
      err?: unknown;
      preTokenBalances?: RpcTokenBalance[] | null;
      postTokenBalances?: RpcTokenBalance[] | null;
    } | null;
  } | null;
}

interface SignatureStatusesPayload {
  value?: Array<{
    err?: unknown;
    confirmationStatus?: "processed" | "confirmed" | "finalized" | null;
  } | null>;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function verifySolanaSettlement(
  signature: string,
  claims: ExecutionAuthorizationClaims,
  commitment: "confirmed" | "finalized" = "confirmed",
): Promise<SettlementVerification> {
  let lastError: string | null = null;
  let missingTransactionObserved = false;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await wait(450 * attempt);
    try {
      const result = await solanaRpcRequest<NonNullable<TransactionPayload["result"]>>(
        "getTransaction",
        [
          signature,
          {
            commitment,
            encoding: "base64",
            maxSupportedTransactionVersion: 0,
          },
        ],
        { timeoutMs: 8_000, id: "hedgents-settlement-verification" },
      );
      if (!result?.meta) {
        missingTransactionObserved = true;
        lastError = `The ${commitment} transaction is not indexed by this RPC yet.`;
        continue;
      }
      const encodedTransaction = result.transaction?.[0];
      if (!encodedTransaction || result.transaction?.[1] !== "base64") {
        lastError = "Solana RPC did not return the settled transaction bytes.";
        continue;
      }
      const settledBinding = bindSolanaTransaction(encodedTransaction, claims.taker, { requireFirstSignature: true });
      if (settledBinding.messageDigest !== claims.transactionMessageDigest) {
        return {
          status: "failed",
          errorCode: "verification_failed",
          receivedAmount: null,
          expectedMinimumAmount: claims.minimumOutputAmount,
          verifiedAt: new Date().toISOString(),
          error: "The transaction does not match the authenticated executable quote.",
        };
      }
      if (result.meta.err) {
        return {
          status: "failed",
          errorCode: "transaction_failed",
          receivedAmount: null,
          expectedMinimumAmount: claims.minimumOutputAmount,
          verifiedAt: new Date().toISOString(),
          error: "Solana reports that the authenticated transaction failed.",
        };
      }
      const received = calculateOwnerTokenDelta(
        result.meta.preTokenBalances,
        result.meta.postTokenBalances,
        claims.taker,
        claims.outputMint,
      );
      if (received < BigInt(claims.minimumOutputAmount)) {
        return {
          status: "failed",
          errorCode: "verification_failed",
          receivedAmount: received > 0n ? received.toString() : "0",
          expectedMinimumAmount: claims.minimumOutputAmount,
          verifiedAt: new Date().toISOString(),
          error: "The wallet token increase is below the authenticated minimum output.",
        };
      }
      return {
        status: "verified",
        receivedAmount: received.toString(),
        expectedMinimumAmount: claims.minimumOutputAmount,
        verifiedAt: new Date().toISOString(),
        error: null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Settlement verification is unavailable.";
    }
  }

  if (missingTransactionObserved && claims.lastValidBlockHeight !== null) {
    try {
      const currentBlockHeight = await solanaRpcRequest<number>(
        "getBlockHeight",
        [{ commitment: "finalized" }],
        { timeoutMs: 5_000, id: "hedgents-settlement-block-height" },
      );
      if (currentBlockHeight > claims.lastValidBlockHeight) {
        const observations = (await Promise.allSettled(
          serverSolanaRpcUrls().map(async (endpoint) => {
            const result = await solanaRpcRequestFrom<SignatureStatusesPayload>(
              [endpoint],
              "getSignatureStatuses",
              [[signature], { searchTransactionHistory: true }],
              { timeoutMs: 5_000, id: "hedgents-settlement-signature-status" },
            );
            const status = result.value?.[0] ?? null;
            return { found: Boolean(status), failed: Boolean(status?.err) };
          }),
        )).flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        const expired = expiredSettlementDecision({
          currentBlockHeight,
          lastValidBlockHeight: claims.lastValidBlockHeight,
          observations,
          expectedMinimumAmount: claims.minimumOutputAmount,
        });
        if (expired) return expired;
      }
    } catch {
      // Keep the receipt pending when expiry cannot be proven independently.
    }
  }

  return {
    status: "pending",
    receivedAmount: null,
    expectedMinimumAmount: claims.minimumOutputAmount,
    verifiedAt: null,
    error: lastError ?? "The transaction is still awaiting independent RPC verification.",
  };
}
