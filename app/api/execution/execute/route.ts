import { NextResponse } from "next/server";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { requireInviteAccess } from "@/lib/access-auth";
import type { JupiterExecutionResult } from "@/lib/execution-types";
import {
  evaluateProductEligibility,
  observedCountryCode,
  parseEligibilityEvidence,
} from "@/lib/eligibility";
import {
  ExecutionValidationError,
  validateRequestId,
  validateSignedTransaction,
} from "@/lib/execution-validation";
import {
  executeJupiterOrder,
  simulateSolanaTransaction,
  verifySolanaSettlement,
} from "@/lib/jupiter-server";
import { validateExecutionAuthorization } from "@/lib/execution-authorization";
import { getSolanaExecutionProduct, getSolanaSettlementAsset } from "@/lib/product-registry";
import { bindSolanaTransaction } from "@/lib/solana-transaction-binding";
import {
  executionStatusFromSettlement,
  submissionStateFromSettlement,
} from "@/lib/execution-records";
import {
  assertProductExecutionAllowed,
  assertExecutionWithinBetaCap,
  requireExecutionSubmissionEnabled,
} from "@/lib/execution-controls";
import { assertTransactionGuardCompatible } from "@/lib/solana-transaction-guard";

export const dynamic = "force-dynamic";

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: Request) {
  let responseHeaders: Record<string, string> = {};
  let submissionState: "not-submitted" | "unknown" = "not-submitted";
  try {
    requireInviteAccess(request);
    const executionControls = requireExecutionSubmissionEnabled();
    responseHeaders = secureMutation(request, { key: "execution-submit", limit: 8, windowMs: 60_000 }).headers;
    const body = await readJsonBody(request, 32_768);
    const signedTransaction = validateSignedTransaction(body.signedTransaction);
    const requestId = validateRequestId(body.requestId);
    const claims = validateExecutionAuthorization(body.authorization, requestId);
    assertProductExecutionAllowed(claims.productId, executionControls);
    const settlementAsset = getSolanaSettlementAsset(claims.settlementAssetId);
    if (!settlementAsset) {
      throw new ExecutionValidationError("The execution settlement asset is no longer supported.");
    }
    assertExecutionWithinBetaCap(
      claims,
      settlementAsset.decimals,
      executionControls,
    );
    const submittedBinding = bindSolanaTransaction(signedTransaction, claims.taker, { requireFirstSignature: true });
    if (submittedBinding.messageDigest !== claims.transactionMessageDigest) {
      throw new ExecutionValidationError("The signed transaction does not match the authenticated executable quote.");
    }
    if (!submittedBinding.firstSignature) {
      throw new ExecutionValidationError("The signed transaction does not contain a recoverable fee-payer signature.");
    }
    const product = getSolanaExecutionProduct(claims.productId);
    if (!product) throw new ExecutionValidationError("The execution product is no longer active.");
    const eligibility = evaluateProductEligibility(
      product,
      parseEligibilityEvidence(body.eligibility),
      observedCountryCode(request.headers),
    );
    if (
      !eligibility.eligible ||
      eligibility.countryCode !== claims.eligibilityCountryCode ||
      eligibility.policyId !== claims.eligibilityPolicyId
    ) {
      throw new ExecutionValidationError(eligibility.reason, 403);
    }
    if (!claims.transactionGuard) {
      throw new ExecutionValidationError("The executable quote has no authenticated transaction safety report.");
    }
    const observedGuard = await simulateSolanaTransaction(
      signedTransaction,
      {
        taker: claims.taker,
        inputMint: claims.inputMint,
        outputMint: claims.outputMint,
        inputAmount: claims.inputAmount,
        minimumOutputAmount: claims.minimumOutputAmount,
      },
      { sigVerify: true },
    );
    assertTransactionGuardCompatible(claims.transactionGuard, observedGuard);
    submissionState = "unknown";
    const raw = await executeJupiterOrder({
      signedTransaction,
      requestId,
      ...(claims.lastValidBlockHeight !== null ? { lastValidBlockHeight: claims.lastValidBlockHeight } : {}),
    });
    const venueStatus = raw.status === "Success" ? "Success" : "Failed";
    const venueSignature = nullableString(raw.signature);
    const signature = submittedBinding.firstSignature;
    if (venueSignature && venueSignature !== signature) {
      throw new ExecutionValidationError(
        "Jupiter returned a signature that does not match the authenticated signed transaction.",
        502,
      );
    }
    const settlement = await verifySolanaSettlement(signature, claims, "finalized");
    const status = executionStatusFromSettlement("Success", settlement);
    const verifiedSubmissionState = submissionStateFromSettlement(settlement);
    const venueError = nullableString(raw.error)
      ?? nullableString(raw.errorMessage)
      ?? (venueStatus === "Failed" ? "Jupiter did not report a successful execution." : null);
    const result: JupiterExecutionResult = {
      status,
      submissionState: verifiedSubmissionState,
      signature,
      code: nullableNumber(raw.code),
      error: status === "Failed"
        ? settlement.error ?? venueError ?? "The signed transaction failed."
        : status === "Pending" && venueError
          ? `${venueError} Chain submission is not yet independently proven; verify before retrying.`
          : null,
      inputAmount: nullableString(raw.inputAmountResult) ?? nullableString(raw.totalInputAmount),
      outputAmount: settlement.receivedAmount
        ?? nullableString(raw.totalOutputAmount)
        ?? nullableString(raw.outputAmountResult),
      settlement,
    };
    return NextResponse.json(result, {
      status: status === "Success" ? 200 : status === "Pending" ? 202 : 422,
      headers: { ...responseHeaders, "cache-control": "no-store" },
    });
  } catch (error) {
    const security = apiSecurityError(error);
    const status = security?.status ?? (error instanceof ExecutionValidationError ? error.status : 500);
    const message = error instanceof Error ? error.message : "The signed order could not be submitted.";
    return NextResponse.json(
      { error: message, submissionState },
      { status, headers: { ...responseHeaders, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
