import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionRecord } from "./execution-types";
import { normalizeExecutionReceipt, parseExecutionReceipt } from "./execution-receipts";

const receipt: ExecutionRecord = {
  id: "order",
  productId: "gold-paxg",
  metal: "Gold",
  ticker: "PAXG",
  side: "buy",
  inputUsd: 100,
  outputAmount: "2000",
  outputDecimals: 6,
  source: "Solana",
  destination: "PAXG · Solana",
  status: "Success",
  signature: "4".repeat(88),
  recoveryAuthorization: "signed-recovery-token",
  minimumOutputAmount: "1900",
  timestamp: "2026-08-07T00:00:00.000Z",
  settlement: {
    status: "verified",
    receivedAmount: "2000",
    expectedMinimumAmount: "1900",
    verifiedAt: "2026-08-07T00:01:00.000Z",
    error: null,
  },
};

test("downgrades loaded success receipts until finalized recovery revalidates them", () => {
  const normalized = normalizeExecutionReceipt(receipt);
  assert.equal(normalized.status, "Pending");
  assert.equal(normalized.settlement?.status, "pending");
  assert.equal(normalized.settlement?.expectedMinimumAmount, "1900");
});

test("keeps failures informational and rejects unknown products or malformed JSON", () => {
  assert.equal(normalizeExecutionReceipt({ ...receipt, status: "Failed" }).status, "Failed");
  assert.throws(() => normalizeExecutionReceipt({ ...receipt, productId: "unknown" }));
  assert.throws(() => parseExecutionReceipt("not-json"));
});

