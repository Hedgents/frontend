import type {
  ExecutionRecord,
  ExecutionSubmissionState,
  SettlementVerification,
} from "@/lib/execution-types";

export function executionSubmissionState(record: ExecutionRecord): ExecutionSubmissionState {
  if (!record.signature) return "not-submitted";
  if (record.submissionState) return record.submissionState;
  if (record.status === "Success" || record.settlement?.status === "verified") return "submitted";
  return "unknown";
}

export interface SignatureStatusObservation {
  found: boolean;
  failed: boolean;
}

export function expiredSettlementDecision({
  currentBlockHeight,
  lastValidBlockHeight,
  observations,
  expectedMinimumAmount,
}: {
  currentBlockHeight: number;
  lastValidBlockHeight: number | null;
  observations: SignatureStatusObservation[];
  expectedMinimumAmount: string;
}): SettlementVerification | null {
  if (lastValidBlockHeight === null || currentBlockHeight <= lastValidBlockHeight) return null;
  const landed = observations.filter((observation) => observation.found);
  if (landed.some((observation) => !observation.failed)) return null;
  if (landed.some((observation) => observation.failed)) {
    return {
      status: "failed",
      errorCode: "transaction_failed",
      receivedAmount: null,
      expectedMinimumAmount,
      verifiedAt: new Date().toISOString(),
      error: "Solana reports that the transaction failed.",
    };
  }
  if (observations.length < 2) return null;
  return {
    status: "failed",
    errorCode: "expired_unlanded",
    receivedAmount: null,
    expectedMinimumAmount,
    verifiedAt: new Date().toISOString(),
    error: "Two independent Solana RPCs found no transaction before its block-height limit expired. It was not landed and cannot be submitted now.",
  };
}

export function executionStatusFromSettlement(
  venueStatus: "Success" | "Failed",
  settlement: SettlementVerification | null,
): ExecutionRecord["status"] {
  if (venueStatus === "Failed") return "Failed";
  if (settlement?.status === "verified") return "Success";
  if (settlement?.status === "failed") return "Failed";
  return "Pending";
}

export function submissionStateFromSettlement(
  settlement: SettlementVerification,
): ExecutionSubmissionState {
  if (settlement.status === "verified") return "submitted";
  if (settlement.errorCode === "expired_unlanded") return "not-submitted";
  if (settlement.status === "failed") return "submitted";
  return "unknown";
}

export function isExecutionRecoveryPending(record: ExecutionRecord) {
  return Boolean(
    record.signature
    && record.recoveryAuthorization
    && executionSubmissionState(record) !== "not-submitted"
    && (record.status === "Pending" || record.settlement?.status === "pending"),
  );
}

export function mergeRecoveredExecutionRecord(
  record: ExecutionRecord,
  settlement: SettlementVerification,
) {
  const status = settlement.status === "verified"
    ? "Success" as const
    : settlement.status === "failed"
      ? "Failed" as const
      : "Pending" as const;

  return {
    ...record,
    status,
    submissionState: settlement.status === "pending"
      ? record.submissionState
      : submissionStateFromSettlement(settlement),
    outputAmount: settlement.receivedAmount ?? record.outputAmount,
    settlement,
    error: status === "Failed" ? settlement.error : null,
  } satisfies ExecutionRecord;
}

export function verifiedExecutionOutput(record: ExecutionRecord) {
  return record.settlement?.status === "verified"
    ? record.settlement.receivedAmount
    : null;
}
