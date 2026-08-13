import assert from "node:assert/strict";
import test from "node:test";
import { calculateOwnerTokenDelta } from "./settlement-verification";

/**
 * Settlement asks the only question that matters after the fact: did the taker end up with the
 * metal they were promised.
 *
 * It used to ask a different one first, whether the landed transaction's bytes equalled the quoted
 * ones, and fail the whole settlement when they did not. Phantom edits every transaction it signs,
 * so that check reported a completed purchase as a failure: 10 USDC spent, 0.002281 PAXG received,
 * receipt saying it never happened. The transaction is fetched BY SIGNATURE and a signature is over
 * the message, so those bytes are definitionally what was signed; comparing them to the quote
 * proved nothing.
 *
 * These cover the check that replaced it, on the real numbers from that order.
 */
const TAKER = "7RTAnEokqBjhqbGDwZzKffimHhVMuFHnAeGRhJTBaHZa";
const PAXG = "5GgRAEmvj6QAffum2ejwErdHnppEfNyoiWMDJgHboUGT";

function balance(owner: string, mint: string, amount: string) {
  return { accountIndex: 1, mint, owner, uiTokenAmount: { amount, decimals: 8, uiAmountString: amount } };
}

test("a wallet-edited transaction still verifies on what the taker received", () => {
  const received = calculateOwnerTokenDelta(
    [balance(TAKER, PAXG, "0")],
    [balance(TAKER, PAXG, "2281")],
    TAKER,
    PAXG,
  );
  assert.equal(received, 2281n);
  // The authenticated floor for that order. Settlement passes on outcome, whatever the bytes.
  assert.ok(received >= 2259n);
});

test("a shortfall is still caught, which is the check worth keeping", () => {
  const received = calculateOwnerTokenDelta(
    [balance(TAKER, PAXG, "0")],
    [balance(TAKER, PAXG, "1000")],
    TAKER,
    PAXG,
  );
  assert.ok(received < 2259n);
});

test("metal credited to somebody else does not count as the taker's", () => {
  const received = calculateOwnerTokenDelta(
    [balance(TAKER, PAXG, "0")],
    [balance("2XqyHSMVsomeOtherOwnerAddress1111111111111", PAXG, "2281")],
    TAKER,
    PAXG,
  );
  assert.equal(received, 0n);
});

test("a credit of a different mint does not satisfy the output", () => {
  const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const received = calculateOwnerTokenDelta(
    [balance(TAKER, usdc, "0")],
    [balance(TAKER, usdc, "2281")],
    TAKER,
    PAXG,
  );
  assert.equal(received, 0n);
});
