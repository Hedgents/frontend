import assert from "node:assert/strict";
import test from "node:test";
import { getBase58Decoder } from "@solana/kit";
import {
  createExecutionAuditIntentRecord,
  createExecutionAuditObservationRecord,
  executionAuditIdentifierHmac,
  ExecutionAuditSchemaError,
  validateExecutionAuditIntentRecord,
  validateExecutionAuditObservationRecord,
  type ExecutionAuditIntentInput,
} from "./execution-audit-schema";

const SECRET = "test-only-execution-audit-secret-with-more-than-32-characters";
const NOW = new Date("2026-08-10T12:34:56.789Z");
const SIGNATURE = getBase58Decoder().decode(Uint8Array.from({ length: 64 }, (_, index) => index + 1));
const MESSAGE_DIGEST = "a".repeat(64);
const GUARD_DIGEST = "b".repeat(64);
const PROGRAM_FINGERPRINT = "c".repeat(64);

function intentInput(): ExecutionAuditIntentInput {
  return {
    signature: SIGNATURE,
    requestId: "jupiter-request-123456",
    sessionId: "93c7851e-3ed7-4f09-96a2-6f3217fac849",
    grantId: "ABCDEF123456",
    productId: "gold-paxg",
    side: "buy",
    settlementAssetId: "usdc",
    transactionMessageDigest: MESSAGE_DIGEST,
    transactionGuardReportDigest: GUARD_DIGEST,
    programFingerprint: PROGRAM_FINGERPRINT,
    lastValidBlockHeight: 345_678_901,
  };
}

test("intent HMACs signature/request/session identities and persists exact non-secret commitments", () => {
  const input = intentInput();
  const record = createExecutionAuditIntentRecord(input, SECRET, NOW);
  const serialized = JSON.stringify(record);

  assert.match(record.signatureHmac, /^[a-f0-9]{64}$/);
  assert.equal(record.grantId, input.grantId);
  assert.equal(record.transactionMessageDigest, MESSAGE_DIGEST);
  assert.equal(record.transactionGuardReportDigest, GUARD_DIGEST);
  assert.equal(record.programFingerprint, PROGRAM_FINGERPRINT);
  assert.equal(record.lastValidBlockHeight, 345_678_901);
  assert.equal(record.createdAt, NOW.toISOString());
  assert.match(record.requestIdHmac, /^[a-f0-9]{64}$/);
  assert.match(record.sessionIdHmac, /^[a-f0-9]{64}$/);
  assert.notEqual(record.requestIdHmac, record.sessionIdHmac);
  assert.doesNotMatch(serialized, new RegExp(input.requestId));
  assert.doesNotMatch(serialized, new RegExp(input.sessionId));
  assert.doesNotMatch(serialized, new RegExp(input.signature));
  for (const forbidden of [
    "wallet",
    "taker",
    "country",
    "ip",
    "userAgent",
    "inputAmount",
    "outputAmount",
    "signedTransaction",
    "authorization",
    "inviteHash",
  ]) {
    assert.equal(Object.hasOwn(record, forbidden), false);
  }
  assert.equal(validateExecutionAuditIntentRecord(record, SECRET), record);
});

test("identifier HMACs are deterministic and domain separated", () => {
  const value = "same-underlying-identifier";
  assert.equal(
    executionAuditIdentifierHmac("request", value, SECRET),
    executionAuditIdentifierHmac("request", value, SECRET),
  );
  assert.notEqual(
    executionAuditIdentifierHmac("request", value, SECRET),
    executionAuditIdentifierHmac("session", value, SECRET),
  );
  assert.notEqual(
    executionAuditIdentifierHmac("signature", value, SECRET),
    executionAuditIdentifierHmac("request", value, SECRET),
  );
});

test("intent input rejects every unsupported field, including prohibited sensitive fields", () => {
  for (const field of [
    "wallet",
    "taker",
    "country",
    "ip",
    "userAgent",
    "inputAmount",
    "signedTransaction",
    "rawRequestId",
    "authToken",
    "inviteHash",
  ]) {
    assert.throws(
      () => createExecutionAuditIntentRecord({ ...intentInput(), [field]: `private-${field}` }, SECRET, NOW),
      (error) => error instanceof ExecutionAuditSchemaError && /unsupported fields/.test(error.message),
      field,
    );
  }
});

test("stored intent validation rejects integrity tampering and unexpected persisted fields", () => {
  const record = createExecutionAuditIntentRecord(intentInput(), SECRET, NOW);
  assert.throws(
    () => validateExecutionAuditIntentRecord({ ...record, productId: "silver-test" }, SECRET),
    /failed its integrity check/,
  );
  assert.throws(
    () => validateExecutionAuditIntentRecord({ ...record, taker: "private-wallet" }, SECRET),
    /unsupported fields/,
  );
  assert.throws(
    () => validateExecutionAuditIntentRecord(record, `${SECRET}-wrong`),
    /failed its integrity check/,
  );
  const reordered = Object.fromEntries(Object.entries(record).reverse());
  assert.equal(validateExecutionAuditIntentRecord(reordered, SECRET), reordered);
});

test("intent input strictly validates signature, identifiers, route enums, and secret strength", () => {
  assert.throws(
    () => createExecutionAuditIntentRecord({ ...intentInput(), signature: "not-a-signature" }, SECRET, NOW),
    /valid Solana signature/,
  );
  assert.throws(
    () => createExecutionAuditIntentRecord({ ...intentInput(), requestId: "short" }, SECRET, NOW),
    /request identifier/,
  );
  assert.throws(
    () => createExecutionAuditIntentRecord({ ...intentInput(), sessionId: "session" }, SECRET, NOW),
    /session identifier/,
  );
  assert.throws(
    () => createExecutionAuditIntentRecord({ ...intentInput(), grantId: "invite-hash" }, SECRET, NOW),
    /grant identifier/,
  );
  assert.throws(
    () => createExecutionAuditIntentRecord({ ...intentInput(), side: "swap" }, SECRET, NOW),
    /side is unsupported/,
  );
  assert.throws(
    () => createExecutionAuditIntentRecord({ ...intentInput(), settlementAssetId: "dai" }, SECRET, NOW),
    /settlement asset is unsupported/,
  );
  assert.throws(
    () => createExecutionAuditIntentRecord({ ...intentInput(), transactionMessageDigest: "bad" }, SECRET, NOW),
    /transaction commitments/,
  );
  assert.throws(
    () => createExecutionAuditIntentRecord({ ...intentInput(), lastValidBlockHeight: 0 }, SECRET, NOW),
    /block-height limit/,
  );
  assert.throws(
    () => createExecutionAuditIntentRecord(intentInput(), "too-short", NOW),
    /at least 32 characters/,
  );
});

test("observation records accept only six coherent bounded outcomes and authenticate their body", () => {
  const allowed = [
    ["submitted", "verified", null],
    ["submitted", "pending", null],
    ["submitted", "failed", "transaction_failed"],
    ["submitted", "failed", "verification_failed"],
    ["unknown", "pending", null],
    ["not-submitted", "failed", "expired_unlanded"],
  ] as const;
  for (const [submissionState, settlementState, errorCode] of allowed) {
    const record = createExecutionAuditObservationRecord(
      { signature: SIGNATURE, submissionState, settlementState, errorCode },
      SECRET,
      NOW,
    );
    assert.equal(validateExecutionAuditObservationRecord(record, SECRET), record);
    assert.equal(record.observedAt, NOW.toISOString());
  }
  assert.throws(
    () => createExecutionAuditObservationRecord(
      { signature: SIGNATURE, submissionState: "retried", settlementState: "pending", errorCode: null },
      SECRET,
      NOW,
    ),
    /submission state is unsupported/,
  );
  assert.throws(
    () => createExecutionAuditObservationRecord(
      { signature: SIGNATURE, submissionState: "submitted", settlementState: "success", errorCode: null },
      SECRET,
      NOW,
    ),
    /settlement state is unsupported/,
  );
  for (const inconsistent of [
    { signature: SIGNATURE, submissionState: "unknown", settlementState: "verified", errorCode: null },
    { signature: SIGNATURE, submissionState: "not-submitted", settlementState: "pending", errorCode: null },
  ]) {
    assert.throws(
      () => createExecutionAuditObservationRecord(inconsistent, SECRET, NOW),
      /states are inconsistent/,
    );
  }
  for (const inconsistent of [
    { signature: SIGNATURE, submissionState: "submitted", settlementState: "verified", errorCode: "transaction_failed" },
    { signature: SIGNATURE, submissionState: "submitted", settlementState: "failed", errorCode: null },
    { signature: SIGNATURE, submissionState: "not-submitted", settlementState: "failed", errorCode: "transaction_failed" },
  ]) {
    assert.throws(
      () => createExecutionAuditObservationRecord(inconsistent, SECRET, NOW),
      /error code is inconsistent/,
    );
  }
  const record = createExecutionAuditObservationRecord(
    { signature: SIGNATURE, submissionState: "submitted", settlementState: "verified", errorCode: null },
    SECRET,
    NOW,
  );
  assert.throws(
    () => validateExecutionAuditObservationRecord({ ...record, observedAt: "2026-08-10T00:00:00.000Z" }, SECRET),
    /failed its integrity check/,
  );
  assert.throws(
    () => validateExecutionAuditObservationRecord(record, `${SECRET}-wrong`),
    /failed its integrity check/,
  );
});
