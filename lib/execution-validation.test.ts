import assert from "node:assert/strict";
import test from "node:test";
import {
  ExecutionValidationError,
  normalizeJupiterPriceImpact,
  parseDecimalToBaseUnits,
  parseTokenAmountToBaseUnits,
  validateRequestId,
  validateSignedTransaction,
  validateTransactionSignature,
  validateSolanaAddress,
} from "./execution-validation";

test("converts exact USDC decimal amounts without floating-point math", () => {
  assert.equal(parseDecimalToBaseUnits("10", 6, 10, 10_000), "10000000");
  assert.equal(parseDecimalToBaseUnits("2500.123456", 6, 10, 10_000), "2500123456");
  assert.equal(
    parseDecimalToBaseUnits("10.25", 18, 10, 10_000),
    "10250000000000000000",
  );
});

test("converts exact metal token amounts without floating-point math", () => {
  assert.equal(parseTokenAmountToBaseUnits("0.125", 6, "PAXG"), "125000");
  assert.equal(parseTokenAmountToBaseUnits("1.000000001", 9, "XAUm"), "1000000001");
  assert.throws(() => parseTokenAmountToBaseUnits("0", 6, "PAXG"), ExecutionValidationError);
  assert.throws(() => parseTokenAmountToBaseUnits("0.0000001", 6, "PAXG"), ExecutionValidationError);
});

test("rejects malformed or out-of-range order sizes", () => {
  assert.throws(() => parseDecimalToBaseUnits("9.99", 6, 10, 10_000), ExecutionValidationError);
  assert.throws(() => parseDecimalToBaseUnits("10.0000001", 6, 10, 10_000), ExecutionValidationError);
  assert.throws(() => parseDecimalToBaseUnits("10001", 6, 10, 10_000), ExecutionValidationError);
});

test("accepts canonical Solana addresses and rejects non-addresses", () => {
  const mint = "5GgRAEmv8ZxF2PR5hY72Qs5x1bnQ6UK2RbTPoqJ3wSwW";
  assert.equal(validateSolanaAddress(mint), mint);
  assert.throws(() => validateSolanaAddress("not-a-wallet"), ExecutionValidationError);
});

test("validates execution request boundaries", () => {
  const encoded = Buffer.alloc(100, 1).toString("base64");
  assert.equal(validateSignedTransaction(encoded), encoded);
  assert.equal(validateRequestId("swap-request:1234"), "swap-request:1234");
  assert.throws(() => validateSignedTransaction("bad"), ExecutionValidationError);
  assert.throws(() => validateRequestId("spaces are rejected"), ExecutionValidationError);
  const signature = "4".repeat(88);
  assert.equal(validateTransactionSignature(signature), signature);
  assert.throws(() => validateTransactionSignature("not-a-signature"), ExecutionValidationError);
});

test("normalizes price impact defensively", () => {
  assert.equal(normalizeJupiterPriceImpact({ priceImpactPct: "0.125" }), 12.5);
  assert.equal(normalizeJupiterPriceImpact({ priceImpact: 0.5 }), 0.5);
  assert.equal(
    normalizeJupiterPriceImpact({ priceImpact: "0.25", priceImpactPct: "0.9" }),
    0.25,
  );
  assert.equal(normalizeJupiterPriceImpact({ priceImpact: "invalid" }), null);
});
