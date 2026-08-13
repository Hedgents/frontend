import assert from "node:assert/strict";
import test from "node:test";
import { actionableExecutionError, executionErrorMessage } from "./execution-errors";

test("an Error keeps its message", () => {
  assert.equal(executionErrorMessage(new Error("Simulation failed")), "Simulation failed");
});

test("a plain object never renders as [object Object]", () => {
  // The real failure: something structured reached the checkout screen and said nothing at all.
  assert.equal(executionErrorMessage({ message: "Blockhash not found" }), "Blockhash not found");
  assert.equal(executionErrorMessage({ error: "Slippage tolerance exceeded" }), "Slippage tolerance exceeded");
  assert.equal(executionErrorMessage({ reason: "Route no longer available" }), "Route no longer available");
});

test("a wallet's numeric code is carried alongside its message", () => {
  assert.equal(executionErrorMessage({ code: 4001, message: "User rejected" }), "User rejected (4001)");
});

test("a nested venue error is unwrapped", () => {
  assert.equal(
    executionErrorMessage({ error: { message: "Custom program error: 0x1771" } }),
    "Custom program error: 0x1771",
  );
});

test("an unrecognised object is serialised rather than discarded", () => {
  const message = executionErrorMessage({ slot: 123, logs: ["a", "b"] });
  assert.match(message, /slot/);
  assert.match(message, /123/);
});

test("empty and unserialisable values fall back to something readable", () => {
  assert.equal(executionErrorMessage({}), "Execution did not complete.");
  assert.equal(executionErrorMessage(null), "Execution did not complete.");
  assert.equal(executionErrorMessage(undefined), "Execution did not complete.");
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(executionErrorMessage(circular), "Execution did not complete.");
});

test("classification still works through the extracted message", () => {
  // A structured wallet rejection must still be recognised as a rejection, not a hard failure.
  const rejected = actionableExecutionError({ code: 4001, message: "User rejected the request" });
  assert.equal(rejected.code, "wallet_rejected");
  assert.equal(rejected.retryable, true);

  const slippage = actionableExecutionError({ error: { message: "insufficient funds for rent" } });
  assert.equal(slippage.code, "insufficient_balance");
});
