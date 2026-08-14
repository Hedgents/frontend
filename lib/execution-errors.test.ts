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

test("an Error already poisoned with [object Object] does not pass it on", () => {
  // How the failure survived the first fix: something upstream did new Error(someObject), so the
  // useless text was already the Error's own message by the time extraction ran.
  assert.equal(executionErrorMessage(new Error(String({}))), "Execution did not complete.");
  const withCause = new Error(String({}), { cause: { message: "Slippage exceeded" } });
  assert.equal(executionErrorMessage(withCause), "Slippage exceeded");
});

test("a Jupiter-style structured body yields readable text, not [object Object]", () => {
  // The exact shape that hid the venue's complaint: `error` is an object, not a string.
  assert.equal(
    executionErrorMessage({ error: { code: 6001, message: "Slippage tolerance exceeded" } }),
    "Slippage tolerance exceeded (6001)",
  );
  assert.match(executionErrorMessage({ error: { instruction: 3, custom: 6001 } }), /6001/);
});

test("an unreviewed venue is not reported as thin liquidity", () => {
  // The real message the guard raises. It contains "route", so before this was classified it landed
  // in route_unavailable and told the tester to try a smaller size, which cannot possibly help.
  const blocked = actionableExecutionError(
    new Error(
      "The route invokes BiSoNHVpsvpKfTFaFisxJHqPYCPMhCF7Zvy5tGkMoNBg, jupZ4m2Nb9Zw9WCM1UQxJqZ9Wb9wVUn9tGm1kkNoAqQ,"
      + " which has not passed the operator program review.",
    ),
  );
  assert.equal(blocked.code, "route_not_reviewed");
  assert.equal(blocked.retryable, true);
  // Retrying is honest advice here: Jupiter's venue choice is nondeterministic, so a fresh quote
  // genuinely can route through a reviewed venue.
  assert.match(blocked.action, /fresh quote/i);
  assert.doesNotMatch(blocked.action, /smaller size/i);

  const fingerprint = actionableExecutionError(
    new Error(`The route program fingerprint ${"a".repeat(64)} has not passed the operator canary review.`),
  );
  assert.equal(fingerprint.code, "route_not_reviewed");
});

test("genuine liquidity failures still classify as route_unavailable", () => {
  assert.equal(
    actionableExecutionError(new Error("Could not find any route for this pair")).code,
    "route_unavailable",
  );
  assert.equal(
    actionableExecutionError(new Error("Price impact too high for this size")).code,
    "route_unavailable",
  );
});
