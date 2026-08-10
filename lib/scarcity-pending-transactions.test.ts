import assert from "node:assert/strict";
import test from "node:test";
import {
  parseScarcityPendingTransactions,
  removeScarcityPendingTransaction,
  upsertScarcityPendingTransaction,
  type ScarcityPendingTransaction,
} from "./scarcity-pending-transactions";

const signature = "5".repeat(88);
const record: ScarcityPendingTransaction = {
  schemaVersion: "1.0.0",
  signature,
  cluster: "devnet",
  wallet: "9".repeat(44),
  label: "Place YES order",
  submittedAt: "2026-08-09T10:00:00.000Z",
  state: "pending",
  lastCheckedAt: null,
  error: null,
};

test("keeps valid pending scarcity transactions recoverable and drops malformed storage", () => {
  assert.deepEqual(parseScarcityPendingTransactions("not-json"), []);
  assert.deepEqual(parseScarcityPendingTransactions(JSON.stringify([{ ...record, cluster: "ethereum" }])), []);
  const saved = upsertScarcityPendingTransaction([], record);
  assert.deepEqual(parseScarcityPendingTransactions(JSON.stringify(saved)), [record]);
  assert.equal(upsertScarcityPendingTransaction(saved, { ...record, state: "failed" }).length, 1);
  assert.deepEqual(removeScarcityPendingTransaction(saved, signature), []);
});
