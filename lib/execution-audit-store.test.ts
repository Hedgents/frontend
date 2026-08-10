import assert from "node:assert/strict";
import test from "node:test";
import { getBase58Decoder } from "@solana/kit";
import {
  createExecutionAuditStore,
  executionAuditConfigurationStatus,
  ExecutionAuditDuplicateIntentError,
  executionAuditIntentPath,
  executionAuditObservationPath,
  ExecutionAuditUnavailableError,
  ExecutionAuditWriteOutcomeUnknownError,
  readDevelopmentExecutionAuditRecordForTests,
  resetExecutionAuditStoreForTests,
  type ExecutionAuditImmutableWritePolicy,
  type ExecutionAuditStorage,
} from "./execution-audit-store";
import type {
  ExecutionAuditErrorCode,
  ExecutionAuditIntentInput,
  ExecutionAuditSettlementState,
  ExecutionAuditSubmissionState,
} from "./execution-audit-schema";
import { createExecutionAuditObservationRecord } from "./execution-audit-schema";

const SECRET = "test-only-execution-audit-secret-with-more-than-32-characters";
const NOW = new Date("2026-08-10T12:34:56.789Z");
const SIGNATURE = getBase58Decoder().decode(Uint8Array.from({ length: 64 }, (_, index) => 255 - index));

function intentInput(): ExecutionAuditIntentInput {
  return {
    signature: SIGNATURE,
    requestId: "jupiter-request-987654",
    sessionId: "e21476d2-d737-43ef-9e57-8a08c358c038",
    grantId: "123456ABCDEF",
    productId: "gold-paxg",
    side: "buy",
    settlementAssetId: "usdc",
    transactionMessageDigest: "a".repeat(64),
    transactionGuardReportDigest: "b".repeat(64),
    programFingerprint: "c".repeat(64),
    lastValidBlockHeight: 345_678_901,
  };
}

function capturingStorage(result: "stored" | "duplicate" = "stored") {
  const writes: Array<{ pathname: string; content: string; policy: ExecutionAuditImmutableWritePolicy }> = [];
  const storage: ExecutionAuditStorage = {
    async writeImmutable(pathname, content, policy) {
      writes.push({ pathname, content, policy });
      return result;
    },
  };
  return { storage, writes };
}

test.beforeEach(() => resetExecutionAuditStoreForTests());

test("intent writes use a deterministic private path and immutable Blob policy", async () => {
  const capture = capturingStorage();
  const store = createExecutionAuditStore({
    production: true,
    environment: {},
    secret: SECRET,
    storage: capture.storage,
    now: () => NOW,
  });
  const record = await store.recordSubmissionIntent(intentInput());

  assert.equal(capture.writes.length, 1);
  assert.equal(capture.writes[0].pathname, executionAuditIntentPath(record.signatureHmac));
  assert.deepEqual(capture.writes[0].policy, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json",
    cacheControlMaxAge: 31_536_000,
  });
  assert.deepEqual(JSON.parse(capture.writes[0].content), record);
  assert.doesNotMatch(capture.writes[0].content, /jupiter-request-987654|e21476d2-d737-43ef-9e57-8a08c358c038/);
  assert.doesNotMatch(capture.writes[0].content, new RegExp(SIGNATURE));
  assert.doesNotMatch(capture.writes[0].pathname, new RegExp(SIGNATURE));
});

test("development memory storage is immutable and duplicate intent is distinct from outage", async () => {
  const store = createExecutionAuditStore({ production: false, environment: {}, now: () => NOW });
  const record = await store.recordSubmissionIntent(intentInput());
  const pathname = executionAuditIntentPath(record.signatureHmac);
  const first = readDevelopmentExecutionAuditRecordForTests(pathname);
  assert.ok(first);

  await assert.rejects(
    () => store.recordSubmissionIntent(intentInput()),
    (error) => error instanceof ExecutionAuditDuplicateIntentError
      && error.status === 409
      && error.signature === SIGNATURE
      && /must not be resubmitted/.test(error.message),
  );
  assert.equal(readDevelopmentExecutionAuditRecordForTests(pathname), first);
});

test("concurrent same-signature intents store once and fail the competitor as duplicate", async () => {
  const store = createExecutionAuditStore({ production: false, environment: {}, now: () => NOW });
  const attempts = await Promise.allSettled([
    store.recordSubmissionIntent(intentInput()),
    store.recordSubmissionIntent(intentInput()),
  ]);
  assert.equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1);
  const rejected = attempts.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  assert.ok(rejected?.reason instanceof ExecutionAuditDuplicateIntentError);
});

test("production intent fails closed with clear 503 errors when secret or Blob is missing", async () => {
  const capture = capturingStorage();
  await assert.rejects(
    () => createExecutionAuditStore({
      production: true,
      environment: {},
      storage: capture.storage,
      now: () => NOW,
    }).recordSubmissionIntent(intentInput()),
    (error) => error instanceof ExecutionAuditUnavailableError
      && error.status === 503
      && /HEDGENTS_EXECUTION_AUDIT_SECRET/.test(error.message),
  );
  await assert.rejects(
    () => createExecutionAuditStore({
      production: true,
      environment: {},
      secret: SECRET,
      now: () => NOW,
    }).recordSubmissionIntent(intentInput()),
    (error) => error instanceof ExecutionAuditUnavailableError
      && error.status === 503
      && /Blob storage/.test(error.message),
  );
});

test("readiness uses the same production secret and storage rules as intent writes", () => {
  assert.equal(executionAuditConfigurationStatus({ production: true, environment: {} }).ready, false);
  const missingStorage = executionAuditConfigurationStatus({
    production: true,
    environment: { HEDGENTS_EXECUTION_AUDIT_SECRET: SECRET },
  });
  assert.equal(missingStorage.ready, false);
  assert.match(missingStorage.detail, /Blob storage/);
  const ready = executionAuditConfigurationStatus({
    production: true,
    environment: {
      HEDGENTS_EXECUTION_AUDIT_SECRET: SECRET,
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test",
    },
  });
  assert.equal(ready.ready, true);
  assert.match(ready.detail, /immutable execution-audit/);
});

test("a post-write storage outage is unknown and never masquerades as definitely unsent", async () => {
  const storage: ExecutionAuditStorage = {
    async writeImmutable() {
      throw new Error("network timeout");
    },
  };
  const store = createExecutionAuditStore({
    production: true,
    environment: {},
    secret: SECRET,
    storage,
    now: () => NOW,
  });
  await assert.rejects(
    () => store.recordSubmissionIntent(intentInput()),
    (error) => error instanceof ExecutionAuditWriteOutcomeUnknownError
      && !(error instanceof ExecutionAuditDuplicateIntentError)
      && error.status === 503
      && error.signature === SIGNATURE,
  );
});

test("a persisted write followed by a transport error resolves to duplicate through a validated origin read", async () => {
  let persisted: string | null = null;
  const storage: ExecutionAuditStorage = {
    async writeImmutable(_pathname, content) {
      persisted = content;
      throw new Error("response lost after commit");
    },
    async readImmutable() {
      return persisted;
    },
  };
  const store = createExecutionAuditStore({
    production: true,
    environment: {},
    secret: SECRET,
    storage,
    now: () => NOW,
  });
  await assert.rejects(
    () => store.recordSubmissionIntent(intentInput()),
    (error) => error instanceof ExecutionAuditDuplicateIntentError && error.signature === SIGNATURE,
  );
});

test("readiness rejects store-id-only credentials and accepts supported private write credentials", () => {
  const storeIdOnly = executionAuditConfigurationStatus({
    production: true,
    environment: { HEDGENTS_EXECUTION_AUDIT_SECRET: SECRET, BLOB_STORE_ID: "store_test" },
  });
  assert.equal(storeIdOnly.ready, false);
  const oidc = executionAuditConfigurationStatus({
    production: true,
    environment: {
      HEDGENTS_EXECUTION_AUDIT_SECRET: SECRET,
      BLOB_STORE_ID: "store_test",
      VERCEL_OIDC_TOKEN: "oidc_test",
    },
  });
  assert.equal(oidc.ready, true);
  assert.throws(() => executionAuditIntentPath(SIGNATURE), /path identifier is malformed/);
});

test("observation paths are bounded to six coherent immutable idempotency slots per signature", async () => {
  const seen = new Set<string>();
  const storage: ExecutionAuditStorage = {
    async writeImmutable(pathname) {
      if (seen.has(pathname)) return "duplicate";
      seen.add(pathname);
      return "stored";
    },
  };
  const store = createExecutionAuditStore({
    production: true,
    environment: {},
    secret: SECRET,
    storage,
    now: () => NOW,
  });
  const states: Array<{
    signature: string;
    submissionState: ExecutionAuditSubmissionState;
    settlementState: ExecutionAuditSettlementState;
    errorCode: ExecutionAuditErrorCode;
  }> = [
    { signature: SIGNATURE, submissionState: "submitted", settlementState: "verified", errorCode: null },
    { signature: SIGNATURE, submissionState: "submitted", settlementState: "pending", errorCode: null },
    { signature: SIGNATURE, submissionState: "submitted", settlementState: "failed", errorCode: "transaction_failed" },
    { signature: SIGNATURE, submissionState: "submitted", settlementState: "failed", errorCode: "verification_failed" },
    { signature: SIGNATURE, submissionState: "unknown", settlementState: "pending", errorCode: null },
    { signature: SIGNATURE, submissionState: "not-submitted", settlementState: "failed", errorCode: "expired_unlanded" },
  ];
  for (const input of states) {
    const result = await store.recordObservation(input);
    const record = createExecutionAuditObservationRecord(input, SECRET, NOW);
    assert.deepEqual(result, {
      recorded: true,
      reason: "stored",
      pathname: executionAuditObservationPath(record),
    });
  }
  assert.equal(seen.size, 6);
  const duplicate = await store.recordObservation({
    signature: SIGNATURE,
    submissionState: "submitted",
    settlementState: "verified",
    errorCode: null,
  });
  assert.equal(duplicate.recorded, false);
  assert.equal(duplicate.reason, "duplicate");
  assert.equal(seen.size, 6);
});

test("observation writes are best effort on independent invalid/configuration/outage paths", async () => {
  const missingConfiguration = await createExecutionAuditStore({
    production: true,
    environment: {},
    now: () => NOW,
  }).recordObservation({
    signature: SIGNATURE,
    submissionState: "submitted",
    settlementState: "pending",
    errorCode: null,
  });
  assert.deepEqual(missingConfiguration, { recorded: false, reason: "unavailable", pathname: null });

  const outageStorage: ExecutionAuditStorage = {
    async writeImmutable() {
      throw new Error("storage outage");
    },
  };
  const outage = await createExecutionAuditStore({
    production: true,
    environment: {},
    secret: SECRET,
    storage: outageStorage,
    now: () => NOW,
  }).recordObservation({
    signature: SIGNATURE,
    submissionState: "submitted",
    settlementState: "pending",
    errorCode: null,
  });
  assert.equal(outage.recorded, false);
  assert.equal(outage.reason, "unavailable");
  assert.match(outage.pathname ?? "", /submitted--pending--none\.json$/);

  const invalid = await createExecutionAuditStore({
    production: false,
    environment: {},
    now: () => NOW,
  }).recordObservation({
    signature: "invalid",
    submissionState: "submitted",
    settlementState: "pending",
    errorCode: null,
  });
  assert.deepEqual(invalid, { recorded: false, reason: "invalid", pathname: null });
});
