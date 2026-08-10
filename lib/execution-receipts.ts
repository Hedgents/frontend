import type { ExecutionRecord } from "@/lib/execution-types";
import { getSolanaExecutionProduct } from "@/lib/product-registry";

export function normalizeExecutionReceipt(value: unknown) {
  const parsed = value as Partial<ExecutionRecord> & { schema?: string };
  if (
    !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    typeof parsed.id !== "string" ||
    typeof parsed.productId !== "string" ||
    typeof parsed.metal !== "string" ||
    typeof parsed.ticker !== "string" ||
    typeof parsed.timestamp !== "string" ||
    !["Success", "Failed", "Pending"].includes(parsed.status ?? "") ||
    (parsed.signature != null && typeof parsed.signature !== "string")
  ) {
    throw new Error("This file is not a valid Hedgents execution receipt.");
  }
  if (!getSolanaExecutionProduct(parsed.productId)) {
    throw new Error("The receipt references a product outside the current canonical registry.");
  }
  const record = parsed as ExecutionRecord;
  if (record.status === "Failed") return record;
  const recoverable = Boolean(record.signature && record.recoveryAuthorization);
  return {
    ...record,
    status: "Pending",
    settlement: {
      status: "pending",
      receivedAmount: null,
      expectedMinimumAmount: record.minimumOutputAmount ?? record.settlement?.expectedMinimumAmount ?? "0",
      verifiedAt: null,
      error: recoverable
        ? "Receipt loaded from storage; finalized settlement must be reverified."
        : "Legacy receipt has no signed recovery evidence and cannot count toward accounting.",
    },
    error: recoverable ? null : "Signed recovery evidence is missing.",
  } satisfies ExecutionRecord;
}

export function parseExecutionReceipt(value: string) {
  try {
    return normalizeExecutionReceipt(JSON.parse(value));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("This file is not valid JSON.");
    }
    throw error;
  }
}

