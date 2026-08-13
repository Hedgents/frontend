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
import { bindSolanaTransaction, solanaTransactionMessageBytes } from "@/lib/solana-transaction-binding";
import { solanaMessageSemanticDigest } from "@/lib/solana-message-semantics";
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
import {
  ExecutionAuditDuplicateIntentError,
  ExecutionAuditWriteOutcomeUnknownError,
  recordExecutionSubmissionIntent,
} from "@/lib/execution-audit-store";
import { scheduleExecutionAuditObservation } from "@/lib/execution-audit-after";

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
  let auditSignature: string | null = null;
  let auditObservationScheduled = false;
  try {
    const access = requireInviteAccess(request);
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
    // True once the wallet has returned something other than what it was handed. It gates the fee
    // tolerance below, so an untouched transaction is still held to byte-for-byte equality.
    const walletModified = submittedBinding.messageDigest !== claims.transactionMessageDigest;
    if (walletModified && !claims.transactionGuard?.routeDigest) {
      // Older quotes committed only to the bytes, so there is nothing left to check a modified
      // transaction against.
      throw new ExecutionValidationError(
        "This quote predates the current route commitment. Build a fresh quote.",
      );
    }
    // A modified transaction is NOT checked against the message bytes. Wallets add instructions and
    // their own address lookup tables, and a lookup table means an instruction's accounts are
    // resolved at runtime, so comparing the raw message cannot see what an instruction actually
    // touches and shifts position when a table is appended. The authority for these is the guard
    // below, which re-simulates the submitted transaction and receives every lookup resolved to a
    // real address before comparing the route.
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
    // The fee tolerance is offered only when the wallet actually changed the transaction. An
    // untouched one must still match its safety report exactly, fee included.
    assertTransactionGuardCompatible(claims.transactionGuard, observedGuard, {
      allowWalletFee: walletModified,
    });
    const signature = submittedBinding.firstSignature;
    await recordExecutionSubmissionIntent({
      signature,
      requestId,
      sessionId: access.sessionId,
      grantId: access.grantId,
      productId: claims.productId,
      side: claims.side,
      settlementAssetId: claims.settlementAssetId,
      transactionMessageDigest: claims.transactionMessageDigest,
      transactionGuardReportDigest: claims.transactionGuard.reportDigest,
      programFingerprint: claims.transactionGuard.programFingerprint,
      lastValidBlockHeight: claims.lastValidBlockHeight,
    });
    auditSignature = signature;
    submissionState = "unknown";
    const raw = await executeJupiterOrder({
      signedTransaction,
      requestId,
      ...(claims.lastValidBlockHeight !== null ? { lastValidBlockHeight: claims.lastValidBlockHeight } : {}),
    });
    const venueStatus = raw.status === "Success" ? "Success" : "Failed";
    const venueSignature = nullableString(raw.signature);
    if (venueSignature && venueSignature !== signature) {
      throw new ExecutionValidationError(
        "Jupiter returned a signature that does not match the authenticated signed transaction.",
        502,
      );
    }
    const settlement = await verifySolanaSettlement(signature, claims, "finalized");
    const status = executionStatusFromSettlement("Success", settlement);
    const verifiedSubmissionState = submissionStateFromSettlement(settlement);
    scheduleExecutionAuditObservation({
      signature,
      submissionState: verifiedSubmissionState,
      settlementState: settlement.status,
      errorCode: settlement.errorCode ?? null,
    });
    auditObservationScheduled = true;
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
    if (
      error instanceof ExecutionAuditDuplicateIntentError
      || error instanceof ExecutionAuditWriteOutcomeUnknownError
    ) {
      // A prior immutable intent exists, or the write outcome itself is
      // uncertain. The final pre-submit boundary may have been crossed. Never
      // call Jupiter again; only recovery may determine whether the exact
      // signature landed.
      submissionState = "unknown";
      auditSignature = error.signature;
    } else if (auditSignature && !auditObservationScheduled) {
      // Once the intent exists, a venue timeout or downstream error cannot be
      // represented as definitely unsent. This audit write is best effort and
      // must never replace the real execution response.
      const signature = auditSignature;
      scheduleExecutionAuditObservation({
        signature,
        submissionState: "unknown",
        settlementState: "pending",
        errorCode: null,
      });
    }
    const security = apiSecurityError(error);
    const status = security?.status ?? (error instanceof ExecutionValidationError ? error.status : 500);
    const message = error instanceof Error ? error.message : "The signed order could not be submitted.";
    return NextResponse.json(
      { error: message, submissionState, ...(auditSignature ? { signature: auditSignature } : {}) },
      { status, headers: { ...responseHeaders, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
