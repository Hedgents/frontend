import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionRecord, SettlementVerification } from "./execution-types";
import {
  executionSubmissionState,
  executionStatusFromSettlement,
  expiredSettlementDecision,
  isExecutionRecoveryPending,
  mergeRecoveredExecutionRecord,
  submissionStateFromSettlement,
  verifiedExecutionOutput,
} from "./execution-records";

const pendingSettlement: SettlementVerification = {
  status: "pending",
  receivedAmount: null,
  expectedMinimumAmount: "90",
  verifiedAt: null,
  error: "RPC indexing pending.",
};

const record: ExecutionRecord = {
  id: "order",
  productId: "gold-paxg",
  metal: "Gold",
  ticker: "PAXG",
  side: "buy",
  outputAmount: "100",
  outputDecimals: 6,
  source: "Solana",
  destination: "PAXG · Solana",
  status: "Success",
  signature: "4".repeat(88),
  recoveryAuthorization: "signed-recovery",
  timestamp: "2026-08-09T00:00:00.000Z",
  settlement: pendingSettlement,
};

test("keeps venue success pending until wallet settlement is independently verified", () => {
  assert.equal(executionStatusFromSettlement("Success", pendingSettlement), "Pending");
  assert.equal(executionStatusFromSettlement("Success", { ...pendingSettlement, status: "verified" }), "Success");
  assert.equal(executionStatusFromSettlement("Success", { ...pendingSettlement, status: "failed" }), "Failed");
  assert.equal(executionStatusFromSettlement("Failed", null), "Failed");
});

test("derives submission state only from independent settlement evidence", () => {
  assert.equal(submissionStateFromSettlement(pendingSettlement), "unknown");
  assert.equal(submissionStateFromSettlement({ ...pendingSettlement, status: "verified" }), "submitted");
  assert.equal(submissionStateFromSettlement({ ...pendingSettlement, status: "failed", errorCode: "transaction_failed" }), "submitted");
  assert.equal(submissionStateFromSettlement({ ...pendingSettlement, status: "failed", errorCode: "expired_unlanded" }), "not-submitted");
});

test("recovers any record whose settlement remains pending", () => {
  assert.equal(isExecutionRecoveryPending(record), true);
  assert.equal(isExecutionRecoveryPending({ ...record, recoveryAuthorization: undefined }), false);
});

test("distinguishes chain submission from local signatures", () => {
  assert.equal(executionSubmissionState(record), "submitted");
  assert.equal(executionSubmissionState({ ...record, status: "Pending", settlement: pendingSettlement }), "unknown");
  assert.equal(executionSubmissionState({ ...record, signature: null, status: "Failed" }), "not-submitted");
  assert.equal(executionSubmissionState({ ...record, signature: null, submissionState: "submitted" }), "not-submitted");
  assert.equal(
    isExecutionRecoveryPending({
      ...record,
      status: "Pending",
      submissionState: "not-submitted",
      settlement: pendingSettlement,
    }),
    false,
  );
});

test("recovery marks proven onchain failures submitted and expired signatures not submitted", () => {
  const chainFailure = mergeRecoveredExecutionRecord(record, {
    ...pendingSettlement,
    status: "failed",
    errorCode: "transaction_failed",
    error: "Authenticated transaction failed.",
    verifiedAt: "2026-08-10T00:00:00.000Z",
  });
  assert.equal(chainFailure.status, "Failed");
  assert.equal(chainFailure.submissionState, "submitted");
  const expired = mergeRecoveredExecutionRecord(record, {
    ...pendingSettlement,
    status: "failed",
    errorCode: "expired_unlanded",
    error: "Transaction did not land.",
    verifiedAt: "2026-08-10T00:00:00.000Z",
  });
  assert.equal(expired.status, "Failed");
  assert.equal(expired.submissionState, "not-submitted");
});

test("expires only after two independent RPCs agree the signature never landed", () => {
  assert.equal(expiredSettlementDecision({
    currentBlockHeight: 100,
    lastValidBlockHeight: 101,
    observations: [{ found: false, failed: false }, { found: false, failed: false }],
    expectedMinimumAmount: "90",
  }), null);
  assert.equal(expiredSettlementDecision({
    currentBlockHeight: 102,
    lastValidBlockHeight: 101,
    observations: [{ found: false, failed: false }],
    expectedMinimumAmount: "90",
  }), null);
  const expired = expiredSettlementDecision({
    currentBlockHeight: 102,
    lastValidBlockHeight: 101,
    observations: [{ found: false, failed: false }, { found: false, failed: false }],
    expectedMinimumAmount: "90",
  });
  assert.equal(expired?.status, "failed");
  assert.equal(expired?.errorCode, "expired_unlanded");
  assert.match(expired?.error ?? "", /not landed/);
  assert.equal(expiredSettlementDecision({
    currentBlockHeight: 102,
    lastValidBlockHeight: 101,
    observations: [{ found: true, failed: false }, { found: false, failed: false }],
    expectedMinimumAmount: "90",
  }), null);
});

test("replaces venue output with the independently verified wallet increase", () => {
  const settlement: SettlementVerification = {
    status: "verified",
    receivedAmount: "97",
    expectedMinimumAmount: "90",
    verifiedAt: "2026-08-09T00:00:30.000Z",
    error: null,
  };
  const recovered = mergeRecoveredExecutionRecord(record, settlement);
  assert.equal(recovered.status, "Success");
  assert.equal(recovered.outputAmount, "97");
  assert.equal(verifiedExecutionOutput(recovered), "97");
});
