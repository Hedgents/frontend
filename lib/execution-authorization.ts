import "server-only";

import { ExecutionValidationError } from "@/lib/execution-validation";
import { createSignedToken, SignedTokenError, verifySignedToken } from "@/lib/signed-token";
import type { TradeSide } from "@/lib/execution-types";
import type { SettlementAssetId } from "@/lib/product-registry";
import type { EligibilityPolicyId } from "@/lib/product-registry";
import {
  getSolanaExecutionProduct,
  getSolanaSettlementAsset,
} from "@/lib/product-registry";
import {
  TRANSACTION_GUARD_SCHEMA,
  type TransactionGuardCommitment,
} from "@/lib/solana-transaction-guard";

export interface ExecutionAuthorizationClaims {
  requestId: string;
  productId: string;
  side: TradeSide;
  settlementAssetId: SettlementAssetId;
  taker: string;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  minimumOutputAmount: string;
  /** Added for new execution tokens; optional so older recovery receipts remain verifiable. */
  quotedOutputAmount?: string;
  /** Cap in force when the order was assembled; optional only for legacy recovery receipts. */
  betaMaximumUsd?: number;
  transactionMessageDigest: string;
  /**
   * Commitment over what the message MEANS, so a wallet may add its own priority fee without
   * invalidating the quote. Optional only so authorizations issued before this existed, and
   * historical recovery receipts, remain readable; submission requires it.
   */
  transactionSemanticDigest?: string;
  /** Required for new executions; optional only so historical recovery receipts remain readable. */
  transactionGuard?: TransactionGuardCommitment;
  lastValidBlockHeight: number | null;
  eligibilityCountryCode: string;
  eligibilityPolicyId: EligibilityPolicyId;
  expiresAt: number;
}

const EXECUTION_TOKEN_NAMESPACE = "hedgents.execution.v2";
const RECOVERY_TOKEN_NAMESPACE = "hedgents.recovery.v1";
const RECOVERY_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function orderSigningSecret() {
  const secret = process.env.HEDGENTS_ORDER_SIGNING_SECRET?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : process.env.JUPITER_API_KEY?.trim()) ||
    (process.env.NODE_ENV === "production" ? "" : "hedgents-local-order-secret");
  if (!secret) {
    throw new ExecutionValidationError(
      "Set a dedicated HEDGENTS_ORDER_SIGNING_SECRET before enabling production execution.",
      503,
    );
  }
  return secret;
}

function recoverySigningSecret() {
  const secret = process.env.HEDGENTS_RECOVERY_SIGNING_SECRET?.trim() ||
    process.env.HEDGENTS_ORDER_SIGNING_SECRET?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : "hedgents-local-recovery-secret");
  if (!secret) {
    throw new ExecutionValidationError(
      "Set HEDGENTS_RECOVERY_SIGNING_SECRET before enabling production recovery.",
      503,
    );
  }
  return secret;
}

export function createExecutionAuthorization(claims: ExecutionAuthorizationClaims) {
  return createSignedToken(EXECUTION_TOKEN_NAMESPACE, claims, orderSigningSecret());
}

function validateClaims(claims: ExecutionAuthorizationClaims, requestId?: string) {
  if (requestId && claims.requestId !== requestId) {
    throw new ExecutionValidationError("The executable quote does not match this request.");
  }
  if (!Number.isFinite(claims.expiresAt) || claims.expiresAt <= Date.now()) {
    throw new ExecutionValidationError("The executable quote expired. Build a fresh route.");
  }
  const product = getSolanaExecutionProduct(claims.productId);
  const settlementAsset = getSolanaSettlementAsset(claims.settlementAssetId);
  if (!product || !settlementAsset || (claims.side !== "buy" && claims.side !== "sell")) {
    throw new ExecutionValidationError("The executable quote references an unsupported route.");
  }
  if (
    claims.eligibilityPolicyId !== product.eligibilityPolicyId ||
    !/^[A-Z]{2}$/.test(claims.eligibilityCountryCode)
  ) {
    throw new ExecutionValidationError("The executable quote eligibility policy is invalid.");
  }
  const expectedInputMint = claims.side === "buy" ? settlementAsset.mint : product.mint;
  const expectedOutputMint = claims.side === "buy" ? product.mint : settlementAsset.mint;
  if (claims.inputMint !== expectedInputMint || claims.outputMint !== expectedOutputMint) {
    throw new ExecutionValidationError("The executable quote asset direction is invalid.");
  }
  if (
    !/^\d+$/.test(claims.inputAmount) || BigInt(claims.inputAmount) <= 0n ||
    !/^\d+$/.test(claims.minimumOutputAmount) || BigInt(claims.minimumOutputAmount) <= 0n
  ) {
    throw new ExecutionValidationError("The executable quote contains invalid protected amounts.");
  }
  if (!/^[a-f0-9]{64}$/.test(claims.transactionMessageDigest)) {
    throw new ExecutionValidationError("The executable quote transaction commitment is invalid.");
  }
  if (
    claims.transactionSemanticDigest !== undefined
    && !/^[a-f0-9]{64}$/.test(claims.transactionSemanticDigest)
  ) {
    throw new ExecutionValidationError("The executable quote route commitment is invalid.");
  }
  if (claims.transactionGuard !== undefined && (
    claims.transactionGuard.schema !== TRANSACTION_GUARD_SCHEMA ||
    !/^[a-f0-9]{64}$/.test(claims.transactionGuard.reportDigest) ||
    !/^[a-f0-9]{64}$/.test(claims.transactionGuard.programFingerprint) ||
    !/^(0|[1-9]\d*)$/.test(claims.transactionGuard.takerSolDebitLamports) ||
    !/^(0|[1-9]\d*)$/.test(claims.transactionGuard.networkFeeLamports)
  )) {
    throw new ExecutionValidationError("The executable quote transaction safety report is invalid.");
  }
  if (
    claims.lastValidBlockHeight !== null
    && (!Number.isSafeInteger(claims.lastValidBlockHeight) || claims.lastValidBlockHeight <= 0)
  ) {
    throw new ExecutionValidationError("The executable quote block-height limit is invalid.");
  }
  return claims;
}

export function validateExecutionAuthorization(value: unknown, requestId: string) {
  try {
    const claims = verifySignedToken<ExecutionAuthorizationClaims>(
      EXECUTION_TOKEN_NAMESPACE,
      value,
      orderSigningSecret(),
    );
    const validated = validateClaims(claims, requestId);
    if (
      !validated.quotedOutputAmount ||
      !/^\d+$/.test(validated.quotedOutputAmount) ||
      BigInt(validated.quotedOutputAmount) <= 0n ||
      !Number.isSafeInteger(validated.betaMaximumUsd) ||
      validated.betaMaximumUsd! <= 0 ||
      !validated.transactionGuard
    ) {
      throw new ExecutionValidationError(
        "The executable quote predates the current beta controls. Build a fresh route.",
      );
    }
    return validated;
  } catch (error) {
    if (error instanceof ExecutionValidationError) throw error;
    throw new ExecutionValidationError(
      error instanceof SignedTokenError ? error.message : "The executable quote is malformed.",
    );
  }
}

export function createRecoveryAuthorization(claims: ExecutionAuthorizationClaims) {
  return createSignedToken(
    RECOVERY_TOKEN_NAMESPACE,
    { ...claims, expiresAt: Date.now() + RECOVERY_LIFETIME_MS },
    recoverySigningSecret(),
  );
}

export function validateRecoveryAuthorization(value: unknown) {
  try {
    const claims = verifySignedToken<ExecutionAuthorizationClaims>(
      RECOVERY_TOKEN_NAMESPACE,
      value,
      recoverySigningSecret(),
    );
    return validateClaims(claims);
  } catch (error) {
    if (error instanceof ExecutionValidationError) throw error;
    throw new ExecutionValidationError(
      error instanceof SignedTokenError ? error.message : "The recovery receipt is malformed.",
    );
  }
}
