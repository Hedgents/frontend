import { NextResponse } from "next/server";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { requireInviteAccess } from "@/lib/access-auth";
import type { JupiterOrderQuote } from "@/lib/execution-types";
import {
  ExecutionValidationError,
  normalizeJupiterPriceImpact,
  parseDecimalToBaseUnits,
  parseTokenAmountToBaseUnits,
  validateSolanaAddress,
} from "@/lib/execution-validation";
import {
  createExecutionAuthorization,
  createRecoveryAuthorization,
  type ExecutionAuthorizationClaims,
} from "@/lib/execution-authorization";
import {
  evaluateProductEligibility,
  observedCountryCode,
  parseEligibilityEvidence,
} from "@/lib/eligibility";
import { getJupiterOrder, simulateSolanaTransaction } from "@/lib/jupiter-server";
import { transactionGuardCommitment } from "@/lib/solana-transaction-guard";
import { solanaMessageSemanticDigest } from "@/lib/solana-message-semantics";
import { solanaTransactionMessageBytes } from "@/lib/solana-transaction-binding";
import {
  assertProductExecutionAllowed,
  assertUsdBaseUnitAmountWithinBetaCap,
  effectiveBuyMaximumUsd,
  requireNewExecutionEnabled,
} from "@/lib/execution-controls";
import {
  getSolanaExecutionProduct,
  getSolanaSettlementAsset,
} from "@/lib/product-registry";

export const dynamic = "force-dynamic";

function stringField(payload: Record<string, unknown>, field: string): string;
function stringField(payload: Record<string, unknown>, field: string, required: false): string | null;
function stringField(payload: Record<string, unknown>, field: string, required = true) {
  const value = payload[field];
  if (typeof value === "string" && value.length > 0) return value;
  if (!required) return null;
  throw new ExecutionValidationError(`Jupiter returned an incomplete order (${field}).`, 502);
}

function numberField(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function expiresAt(value: unknown) {
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }
  return null;
}

function recordField(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorResponse(error: unknown, headers: Record<string, string> = {}) {
  const security = apiSecurityError(error);
  const status = security?.status ?? (error instanceof ExecutionValidationError ? error.status : 500);
  const message = error instanceof Error ? error.message : "The order could not be prepared.";
  return NextResponse.json(
    { error: message },
    { status, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let responseHeaders: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    const executionControls = requireNewExecutionEnabled();
    responseHeaders = secureMutation(request, { key: "execution-order", limit: 12, windowMs: 60_000 }).headers;
    const body = await readJsonBody(request, 16_384);
    const productId = typeof body.productId === "string" ? body.productId : "";
    const product = getSolanaExecutionProduct(productId);
    if (!product) {
      throw new ExecutionValidationError(
        "This product is mapped for discovery but does not have an activated execution adapter.",
      );
    }
    assertProductExecutionAllowed(product.productId, executionControls);
    const eligibility = evaluateProductEligibility(
      product,
      parseEligibilityEvidence(body.eligibility),
      observedCountryCode(request.headers),
    );
    if (!eligibility.eligible || !eligibility.countryCode) {
      throw new ExecutionValidationError(eligibility.reason, 403);
    }
    const side = body.side === "sell" ? "sell" : "buy";
    const settlementAsset = getSolanaSettlementAsset(
      side === "buy" ? "usdc" : body.settlementAssetId,
    );
    if (!settlementAsset) {
      throw new ExecutionValidationError("Choose USDC, USDT, or USDG settlement on Solana.");
    }
    const taker = validateSolanaAddress(body.taker);
    const inputAmount = side === "buy"
      ? parseDecimalToBaseUnits(
          body.amountUsd,
          settlementAsset.decimals,
          product.execution.minimumUsd,
          effectiveBuyMaximumUsd(product.execution.maximumUsd, executionControls.maxUsd),
        )
      : parseTokenAmountToBaseUnits(body.amountToken, product.decimals, product.symbol);
    const inputMint = side === "buy" ? settlementAsset.mint : product.mint;
    const outputMint = side === "buy" ? product.mint : settlementAsset.mint;
    const inputDecimals = side === "buy" ? settlementAsset.decimals : product.decimals;
    const outputDecimals = side === "buy" ? product.decimals : settlementAsset.decimals;
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: inputAmount,
      taker,
      excludeRouters: "jupiterz",
    });
    const raw = await getJupiterOrder(params);
    const transaction = stringField(raw, "transaction");
    const requestId = stringField(raw, "requestId");
    const outputAmount = stringField(raw, "outAmount");
    const minimumOutputAmount = stringField(raw, "otherAmountThreshold", false) ?? outputAmount;
    const returnedInputMint = stringField(raw, "inputMint");
    const returnedOutputMint = stringField(raw, "outputMint");
    const returnedInputAmount = stringField(raw, "inAmount");

    if (!/^\d+$/.test(outputAmount) || !/^\d+$/.test(minimumOutputAmount)) {
      throw new ExecutionValidationError("Jupiter returned malformed output amounts.", 502);
    }
    if (BigInt(outputAmount) <= 0n || BigInt(minimumOutputAmount) <= 0n) {
      throw new ExecutionValidationError("Jupiter returned no executable output for this size.");
    }
    if (BigInt(minimumOutputAmount) > BigInt(outputAmount)) {
      throw new ExecutionValidationError("Jupiter returned invalid minimum-output protection.", 502);
    }
    if (side === "sell") {
      assertUsdBaseUnitAmountWithinBetaCap(
        outputAmount,
        settlementAsset.decimals,
        executionControls,
      );
    }
    if (transaction.length < 100 || transaction.length > 16_000) {
      throw new ExecutionValidationError("Jupiter returned a malformed transaction.", 502);
    }

    if (returnedInputMint !== inputMint) {
      throw new ExecutionValidationError("Jupiter returned an unexpected input asset.", 502);
    }
    if (returnedOutputMint !== outputMint) {
      throw new ExecutionValidationError("Jupiter returned an unexpected output asset.", 502);
    }
    if (returnedInputAmount !== inputAmount) {
      throw new ExecutionValidationError("Jupiter returned an unexpected input amount.", 502);
    }

    const priceImpactPct = normalizeJupiterPriceImpact(raw);
    if (priceImpactPct === null) {
      throw new ExecutionValidationError(
        "Jupiter did not report price impact, so the route was rejected.",
        502,
      );
    }
    if (priceImpactPct > product.execution.maximumPriceImpactPct) {
      throw new ExecutionValidationError(
        `Route rejected: ${priceImpactPct.toFixed(2)}% price impact exceeds the ${product.execution.maximumPriceImpactPct}% guardrail.`,
      );
    }

    const simulation = await simulateSolanaTransaction(transaction, {
      taker,
      inputMint,
      outputMint,
      inputAmount,
      minimumOutputAmount,
    });
    const platformFee = recordField(raw, "platformFee");
    const quoteExpiresAt = expiresAt(raw.expireAt);
    const authorizationExpiresAt = Math.min(
      Date.now() + 90_000,
      quoteExpiresAt ? Date.parse(quoteExpiresAt) : Number.POSITIVE_INFINITY,
    );
    const lastValidBlockHeight = numberField(raw, "lastValidBlockHeight");
    if (authorizationExpiresAt <= Date.now() + 5_000) {
      throw new ExecutionValidationError("Jupiter returned an order too close to expiry. Build a fresh route.", 502);
    }
    if (lastValidBlockHeight !== null && (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight <= 0)) {
      throw new ExecutionValidationError("Jupiter returned an invalid block-height limit.", 502);
    }
    const authorizationClaims: ExecutionAuthorizationClaims = {
      requestId,
      productId,
      side,
      settlementAssetId: settlementAsset.id,
      taker,
      inputMint,
      outputMint,
      inputAmount,
      minimumOutputAmount,
      quotedOutputAmount: outputAmount,
      betaMaximumUsd: executionControls.maxUsd,
      transactionMessageDigest: simulation.transactionMessageDigest,
      // Commits to what the route means rather than the bytes it arrived in, so a wallet may set
      // its own priority fee without invalidating the quote. See solana-message-semantics.
      transactionSemanticDigest: solanaMessageSemanticDigest(
        solanaTransactionMessageBytes(transaction),
      ),
      transactionGuard: transactionGuardCommitment(simulation),
      lastValidBlockHeight,
      eligibilityCountryCode: eligibility.countryCode,
      eligibilityPolicyId: eligibility.policyId,
      expiresAt: authorizationExpiresAt,
    };
    const authorization = createExecutionAuthorization(authorizationClaims);
    const recoveryAuthorization = createRecoveryAuthorization(authorizationClaims);
    const order: JupiterOrderQuote = {
      productId,
      side,
      settlementAssetId: settlementAsset.id,
      requestId,
      authorization,
      recoveryAuthorization,
      transaction,
      inputMint,
      outputMint,
      inputAmount,
      outputAmount,
      minimumOutputAmount,
      inputDecimals,
      outputDecimals,
      router: stringField(raw, "router", false) ?? "Jupiter Meta Aggregator",
      slippageBps: numberField(raw, "slippageBps"),
      priceImpactPct,
      feeBps: numberField(raw, "feeBps") ?? (platformFee ? numberField(platformFee, "feeBps") : null),
      feeMint: stringField(raw, "feeMint", false) ?? (platformFee ? stringField(platformFee, "feeMint", false) : null),
      lastValidBlockHeight,
      expiresAt: new Date(authorizationExpiresAt).toISOString(),
      simulated: true,
      simulationUnitsConsumed: simulation.unitsConsumed,
      quotedAt: new Date().toISOString(),
    };
    return NextResponse.json(order, { headers: { ...responseHeaders, "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, responseHeaders);
  }
}
