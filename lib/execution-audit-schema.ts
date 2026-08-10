import { createHmac, timingSafeEqual } from "node:crypto";
import { isSignature } from "@solana/kit";
import { canonicalJson } from "@/lib/scarcity-markets/canonical";

export const EXECUTION_AUDIT_INTENT_SCHEMA = "hedgents.execution-audit.intent.v1" as const;
export const EXECUTION_AUDIT_OBSERVATION_SCHEMA = "hedgents.execution-audit.observation.v1" as const;

export const executionAuditSubmissionStates = ["submitted", "not-submitted", "unknown"] as const;
export const executionAuditSettlementStates = ["verified", "pending", "failed"] as const;

export type ExecutionAuditSubmissionState = typeof executionAuditSubmissionStates[number];
export type ExecutionAuditSettlementState = typeof executionAuditSettlementStates[number];
export type ExecutionAuditErrorCode = "expired_unlanded" | "transaction_failed" | "verification_failed" | null;
export type ExecutionAuditSide = "buy" | "sell";
export type ExecutionAuditSettlementAssetId = "usdc" | "usdt" | "usdg";

export interface ExecutionAuditIntentInput {
  signature: string;
  requestId: string;
  sessionId: string;
  grantId: string;
  productId: string;
  side: ExecutionAuditSide;
  settlementAssetId: ExecutionAuditSettlementAssetId;
  transactionMessageDigest: string;
  transactionGuardReportDigest: string;
  programFingerprint: string;
  lastValidBlockHeight: number | null;
}

export interface ExecutionAuditIntentBody {
  schema: typeof EXECUTION_AUDIT_INTENT_SCHEMA;
  signatureHmac: string;
  requestIdHmac: string;
  sessionIdHmac: string;
  grantId: string;
  productId: string;
  side: ExecutionAuditSide;
  settlementAssetId: ExecutionAuditSettlementAssetId;
  transactionMessageDigest: string;
  transactionGuardReportDigest: string;
  programFingerprint: string;
  lastValidBlockHeight: number | null;
  createdAt: string;
}

export interface ExecutionAuditIntentRecord extends ExecutionAuditIntentBody {
  integrityHmac: string;
}

export interface ExecutionAuditObservationInput {
  signature: string;
  submissionState: ExecutionAuditSubmissionState;
  settlementState: ExecutionAuditSettlementState;
  errorCode: ExecutionAuditErrorCode;
}

export interface ExecutionAuditObservationBody {
  schema: typeof EXECUTION_AUDIT_OBSERVATION_SCHEMA;
  signatureHmac: string;
  submissionState: ExecutionAuditSubmissionState;
  settlementState: ExecutionAuditSettlementState;
  errorCode: ExecutionAuditErrorCode;
  observedAt: string;
}

export interface ExecutionAuditObservationRecord extends ExecutionAuditObservationBody {
  integrityHmac: string;
}

const INTENT_INPUT_KEYS = [
  "grantId",
  "lastValidBlockHeight",
  "productId",
  "programFingerprint",
  "requestId",
  "sessionId",
  "settlementAssetId",
  "side",
  "signature",
  "transactionGuardReportDigest",
  "transactionMessageDigest",
] as const;
const INTENT_RECORD_KEYS = [
  "createdAt",
  "grantId",
  "integrityHmac",
  "lastValidBlockHeight",
  "productId",
  "programFingerprint",
  "requestIdHmac",
  "schema",
  "sessionIdHmac",
  "settlementAssetId",
  "side",
  "signatureHmac",
  "transactionGuardReportDigest",
  "transactionMessageDigest",
] as const;
const OBSERVATION_INPUT_KEYS = ["errorCode", "settlementState", "signature", "submissionState"] as const;
const OBSERVATION_RECORD_KEYS = [
  "errorCode",
  "integrityHmac",
  "observedAt",
  "schema",
  "settlementState",
  "signatureHmac",
  "submissionState",
] as const;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._~:+/=-]{8,256}$/;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRANT_ID_PATTERN = /^(?:admin|dev|[A-F0-9]{12})$/;
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const HMAC_PATTERN = /^[a-f0-9]{64}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export class ExecutionAuditSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionAuditSchemaError";
  }
}

function validObservationStatePair(
  submissionState: ExecutionAuditSubmissionState,
  settlementState: ExecutionAuditSettlementState,
) {
  if (submissionState === "submitted") return true;
  if (submissionState === "unknown") return settlementState === "pending";
  return settlementState === "failed";
}

function validObservationErrorCode(
  submissionState: ExecutionAuditSubmissionState,
  settlementState: ExecutionAuditSettlementState,
  errorCode: ExecutionAuditErrorCode,
) {
  if (settlementState !== "failed") return errorCode === null;
  if (submissionState === "not-submitted") return errorCode === "expired_unlanded";
  return submissionState === "submitted"
    && (errorCode === "transaction_failed" || errorCode === "verification_failed");
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExecutionAuditSchemaError(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ExecutionAuditSchemaError(`${label} must be a plain object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new ExecutionAuditSchemaError(`${label} contains missing or unsupported fields.`);
  }
}

function assertSecret(secret: string) {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 4_096) {
    throw new ExecutionAuditSchemaError("The execution audit secret must contain at least 32 characters.");
  }
}

function assertSignature(value: unknown): asserts value is string {
  if (typeof value !== "string" || !isSignature(value)) {
    throw new ExecutionAuditSchemaError("The execution audit signature is not a valid Solana signature.");
  }
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
  let canonical = "";
  try {
    canonical = typeof value === "string" ? new Date(value).toISOString() : "";
  } catch {
    canonical = "";
  }
  if (typeof value !== "string" || value.length !== 24 || canonical !== value) {
    throw new ExecutionAuditSchemaError(`${label} must be a canonical ISO timestamp.`);
  }
}

function assertHmac(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !HMAC_PATTERN.test(value)) {
    throw new ExecutionAuditSchemaError(`${label} is malformed.`);
  }
}

function safeEqualHmac(left: string, right: string) {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function integrityHmac(body: ExecutionAuditIntentBody | ExecutionAuditObservationBody, secret: string) {
  assertSecret(secret);
  return createHmac("sha256", secret)
    .update("hedgents.execution-audit.integrity.v1\n")
    .update(canonicalJson(body))
    .digest("hex");
}

export function executionAuditIdentifierHmac(
  kind: "request" | "session" | "signature",
  value: string,
  secret: string,
) {
  assertSecret(secret);
  return createHmac("sha256", secret)
    .update(`hedgents.execution-audit.${kind}.v1\n`)
    .update(value, "utf8")
    .digest("hex");
}

export function validateExecutionAuditIntentInput(value: unknown): ExecutionAuditIntentInput {
  assertPlainObject(value, "Execution audit intent");
  assertExactKeys(value, INTENT_INPUT_KEYS, "Execution audit intent");
  assertSignature(value.signature);
  if (typeof value.requestId !== "string" || !REQUEST_ID_PATTERN.test(value.requestId)) {
    throw new ExecutionAuditSchemaError("The execution audit request identifier is malformed.");
  }
  if (typeof value.sessionId !== "string" || !SESSION_ID_PATTERN.test(value.sessionId)) {
    throw new ExecutionAuditSchemaError("The execution audit session identifier is malformed.");
  }
  if (typeof value.grantId !== "string" || !GRANT_ID_PATTERN.test(value.grantId)) {
    throw new ExecutionAuditSchemaError("The execution audit grant identifier is malformed.");
  }
  if (typeof value.productId !== "string" || !PRODUCT_ID_PATTERN.test(value.productId)) {
    throw new ExecutionAuditSchemaError("The execution audit product identifier is malformed.");
  }
  if (value.side !== "buy" && value.side !== "sell") {
    throw new ExecutionAuditSchemaError("The execution audit side is unsupported.");
  }
  if (value.settlementAssetId !== "usdc" && value.settlementAssetId !== "usdt" && value.settlementAssetId !== "usdg") {
    throw new ExecutionAuditSchemaError("The execution audit settlement asset is unsupported.");
  }
  if (
    typeof value.transactionMessageDigest !== "string"
    || !DIGEST_PATTERN.test(value.transactionMessageDigest)
    || typeof value.transactionGuardReportDigest !== "string"
    || !DIGEST_PATTERN.test(value.transactionGuardReportDigest)
    || typeof value.programFingerprint !== "string"
    || !DIGEST_PATTERN.test(value.programFingerprint)
  ) {
    throw new ExecutionAuditSchemaError("The execution audit transaction commitments are malformed.");
  }
  if (
    value.lastValidBlockHeight !== null
    && (!Number.isSafeInteger(value.lastValidBlockHeight) || Number(value.lastValidBlockHeight) <= 0)
  ) {
    throw new ExecutionAuditSchemaError("The execution audit block-height limit is malformed.");
  }
  return value as unknown as ExecutionAuditIntentInput;
}

export function createExecutionAuditIntentRecord(
  input: unknown,
  secret: string,
  now = new Date(),
): ExecutionAuditIntentRecord {
  const validated = validateExecutionAuditIntentInput(input);
  const createdAt = now.toISOString();
  assertTimestamp(createdAt, "Execution audit creation time");
  const body: ExecutionAuditIntentBody = {
    schema: EXECUTION_AUDIT_INTENT_SCHEMA,
    signatureHmac: executionAuditIdentifierHmac("signature", validated.signature, secret),
    requestIdHmac: executionAuditIdentifierHmac("request", validated.requestId, secret),
    sessionIdHmac: executionAuditIdentifierHmac("session", validated.sessionId, secret),
    grantId: validated.grantId,
    productId: validated.productId,
    side: validated.side,
    settlementAssetId: validated.settlementAssetId,
    transactionMessageDigest: validated.transactionMessageDigest,
    transactionGuardReportDigest: validated.transactionGuardReportDigest,
    programFingerprint: validated.programFingerprint,
    lastValidBlockHeight: validated.lastValidBlockHeight,
    createdAt,
  };
  return { ...body, integrityHmac: integrityHmac(body, secret) };
}

export function validateExecutionAuditObservationInput(value: unknown): ExecutionAuditObservationInput {
  assertPlainObject(value, "Execution audit observation");
  assertExactKeys(value, OBSERVATION_INPUT_KEYS, "Execution audit observation");
  assertSignature(value.signature);
  if (!executionAuditSubmissionStates.includes(value.submissionState as ExecutionAuditSubmissionState)) {
    throw new ExecutionAuditSchemaError("The execution audit submission state is unsupported.");
  }
  if (!executionAuditSettlementStates.includes(value.settlementState as ExecutionAuditSettlementState)) {
    throw new ExecutionAuditSchemaError("The execution audit settlement state is unsupported.");
  }
  if (!validObservationStatePair(
    value.submissionState as ExecutionAuditSubmissionState,
    value.settlementState as ExecutionAuditSettlementState,
  )) {
    throw new ExecutionAuditSchemaError("The execution audit submission and settlement states are inconsistent.");
  }
  if (!validObservationErrorCode(
    value.submissionState as ExecutionAuditSubmissionState,
    value.settlementState as ExecutionAuditSettlementState,
    value.errorCode as ExecutionAuditErrorCode,
  )) {
    throw new ExecutionAuditSchemaError("The execution audit error code is inconsistent with the observed state.");
  }
  return value as unknown as ExecutionAuditObservationInput;
}

export function createExecutionAuditObservationRecord(
  input: unknown,
  secret: string,
  now = new Date(),
): ExecutionAuditObservationRecord {
  const validated = validateExecutionAuditObservationInput(input);
  const observedAt = now.toISOString();
  assertTimestamp(observedAt, "Execution audit observation time");
  const body: ExecutionAuditObservationBody = {
    schema: EXECUTION_AUDIT_OBSERVATION_SCHEMA,
    signatureHmac: executionAuditIdentifierHmac("signature", validated.signature, secret),
    submissionState: validated.submissionState,
    settlementState: validated.settlementState,
    errorCode: validated.errorCode,
    observedAt,
  };
  return { ...body, integrityHmac: integrityHmac(body, secret) };
}

export function validateExecutionAuditIntentRecord(value: unknown, secret: string): ExecutionAuditIntentRecord {
  assertPlainObject(value, "Stored execution audit intent");
  assertExactKeys(value, INTENT_RECORD_KEYS, "Stored execution audit intent");
  if (value.schema !== EXECUTION_AUDIT_INTENT_SCHEMA) {
    throw new ExecutionAuditSchemaError("The stored execution audit intent schema is unsupported.");
  }
  assertHmac(value.signatureHmac, "Stored signature HMAC");
  assertHmac(value.requestIdHmac, "Stored request identifier HMAC");
  assertHmac(value.sessionIdHmac, "Stored session identifier HMAC");
  if (typeof value.grantId !== "string" || !GRANT_ID_PATTERN.test(value.grantId)) {
    throw new ExecutionAuditSchemaError("The stored execution audit grant identifier is malformed.");
  }
  if (typeof value.productId !== "string" || !PRODUCT_ID_PATTERN.test(value.productId)) {
    throw new ExecutionAuditSchemaError("The stored execution audit product identifier is malformed.");
  }
  if (value.side !== "buy" && value.side !== "sell") {
    throw new ExecutionAuditSchemaError("The stored execution audit side is unsupported.");
  }
  if (value.settlementAssetId !== "usdc" && value.settlementAssetId !== "usdt" && value.settlementAssetId !== "usdg") {
    throw new ExecutionAuditSchemaError("The stored execution audit settlement asset is unsupported.");
  }
  if (
    typeof value.transactionMessageDigest !== "string"
    || !DIGEST_PATTERN.test(value.transactionMessageDigest)
    || typeof value.transactionGuardReportDigest !== "string"
    || !DIGEST_PATTERN.test(value.transactionGuardReportDigest)
    || typeof value.programFingerprint !== "string"
    || !DIGEST_PATTERN.test(value.programFingerprint)
  ) {
    throw new ExecutionAuditSchemaError("The stored execution audit transaction commitments are malformed.");
  }
  if (
    value.lastValidBlockHeight !== null
    && (!Number.isSafeInteger(value.lastValidBlockHeight) || Number(value.lastValidBlockHeight) <= 0)
  ) {
    throw new ExecutionAuditSchemaError("The stored execution audit block-height limit is malformed.");
  }
  assertTimestamp(value.createdAt, "Stored execution audit creation time");
  assertHmac(value.integrityHmac, "Stored execution audit integrity HMAC");
  const { integrityHmac: supplied, ...body } = value as unknown as ExecutionAuditIntentRecord;
  const expected = integrityHmac(body, secret);
  if (!safeEqualHmac(supplied, expected)) {
    throw new ExecutionAuditSchemaError("The stored execution audit intent failed its integrity check.");
  }
  return value as unknown as ExecutionAuditIntentRecord;
}

export function validateExecutionAuditObservationRecord(
  value: unknown,
  secret: string,
): ExecutionAuditObservationRecord {
  assertPlainObject(value, "Stored execution audit observation");
  assertExactKeys(value, OBSERVATION_RECORD_KEYS, "Stored execution audit observation");
  if (value.schema !== EXECUTION_AUDIT_OBSERVATION_SCHEMA) {
    throw new ExecutionAuditSchemaError("The stored execution audit observation schema is unsupported.");
  }
  assertHmac(value.signatureHmac, "Stored signature HMAC");
  if (!executionAuditSubmissionStates.includes(value.submissionState as ExecutionAuditSubmissionState)) {
    throw new ExecutionAuditSchemaError("The stored execution audit submission state is unsupported.");
  }
  if (!executionAuditSettlementStates.includes(value.settlementState as ExecutionAuditSettlementState)) {
    throw new ExecutionAuditSchemaError("The stored execution audit settlement state is unsupported.");
  }
  if (!validObservationStatePair(
    value.submissionState as ExecutionAuditSubmissionState,
    value.settlementState as ExecutionAuditSettlementState,
  )) {
    throw new ExecutionAuditSchemaError("The stored execution audit submission and settlement states are inconsistent.");
  }
  if (!validObservationErrorCode(
    value.submissionState as ExecutionAuditSubmissionState,
    value.settlementState as ExecutionAuditSettlementState,
    value.errorCode as ExecutionAuditErrorCode,
  )) {
    throw new ExecutionAuditSchemaError("The stored execution audit error code is inconsistent with the observed state.");
  }
  assertTimestamp(value.observedAt, "Stored execution audit observation time");
  assertHmac(value.integrityHmac, "Stored execution audit observation integrity HMAC");
  const { integrityHmac: supplied, ...body } = value as unknown as ExecutionAuditObservationRecord;
  const expected = integrityHmac(body, secret);
  if (!safeEqualHmac(supplied, expected)) {
    throw new ExecutionAuditSchemaError("The stored execution audit observation failed its integrity check.");
  }
  return value as unknown as ExecutionAuditObservationRecord;
}
