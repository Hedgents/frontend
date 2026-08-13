import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTransactionGuardCompatible,
  maximumWalletFeeLamports,
  TRANSACTION_GUARD_SCHEMA,
  type TransactionGuardCommitment,
  type TransactionGuardReport,
} from "./solana-transaction-guard";

/**
 * The quote's committed safety report, and what the simulator sees back after signing.
 *
 * The interesting axis is the fee: a wallet may add its own priority fee, which moves the lamports
 * debited and the network fee but must move nothing else.
 */
const QUOTED: TransactionGuardCommitment = {
  schema: TRANSACTION_GUARD_SCHEMA,
  reportDigest: "a".repeat(64),
  routeDigest: "b".repeat(64),
  programFingerprint: "c".repeat(64),
  takerSolDebitLamports: "5000",
  networkFeeLamports: "5000",
};

function observed(overrides: Partial<TransactionGuardReport> = {}): TransactionGuardReport {
  return {
    ...QUOTED,
    routeDigest: QUOTED.routeDigest as string,
    transactionMessageDigest: "d".repeat(64),
    inputDebitAmount: "10000000",
    outputCreditAmount: "9990000",
    programIds: ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"],
    unitsConsumed: 120_000,
    ...overrides,
  };
}

test("an untouched transaction still has to match exactly", () => {
  assert.doesNotThrow(() => assertTransactionGuardCompatible(QUOTED, observed()));
});

test("a wallet fee is refused unless the transaction is known to have been modified", () => {
  const withFee = observed({
    reportDigest: "f".repeat(64),
    takerSolDebitLamports: "205000",
    networkFeeLamports: "205000",
  });
  // No allowWalletFee: this is the untouched path, so any drift is a hard failure.
  assert.throws(() => assertTransactionGuardCompatible(QUOTED, withFee), /safety report/i);
  assert.doesNotThrow(() => assertTransactionGuardCompatible(QUOTED, withFee, { allowWalletFee: true }));
});

test("a fee beyond the ceiling is refused with a message that says what to do", () => {
  const greedy = observed({
    reportDigest: "f".repeat(64),
    takerSolDebitLamports: String(5000 + 3_000_000),
    networkFeeLamports: String(5000 + 3_000_000),
  });
  assert.throws(
    () => assertTransactionGuardCompatible(QUOTED, greedy, { allowWalletFee: true }),
    /priority fee larger than this order allows/i,
  );
});

test("the route itself may not move, however small the fee", () => {
  for (const drift of [
    { routeDigest: "9".repeat(64) },
    { programFingerprint: "9".repeat(64) },
  ]) {
    const tampered = observed({ reportDigest: "f".repeat(64), ...drift });
    assert.throws(
      () => assertTransactionGuardCompatible(QUOTED, tampered, { allowWalletFee: true }),
      /safety report/i,
    );
  }
});

test("paying less than quoted is fine; only paying more needs headroom", () => {
  const cheaper = observed({
    reportDigest: "f".repeat(64),
    takerSolDebitLamports: "1",
    networkFeeLamports: "1",
  });
  assert.doesNotThrow(() => assertTransactionGuardCompatible(QUOTED, cheaper, { allowWalletFee: true }));
});

test("a quote issued before route commitments existed cannot use the tolerance", () => {
  const { routeDigest: _dropped, ...legacy } = QUOTED;
  const withFee = observed({ reportDigest: "f".repeat(64), takerSolDebitLamports: "6000" });
  assert.throws(
    () => assertTransactionGuardCompatible(legacy as TransactionGuardCommitment, withFee, { allowWalletFee: true }),
    /build a fresh quote/i,
  );
});

test("the ceiling is bounded whatever the environment claims", () => {
  assert.equal(maximumWalletFeeLamports({}), 2_000_000n);
  assert.equal(maximumWalletFeeLamports({ HEDGENTS_MAX_WALLET_FEE_LAMPORTS: "500000" }), 500_000n);
  // Nonsense falls back rather than disabling the bound.
  assert.equal(maximumWalletFeeLamports({ HEDGENTS_MAX_WALLET_FEE_LAMPORTS: "lots" }), 2_000_000n);
  // And the hard ceiling cannot be configured away.
  assert.equal(maximumWalletFeeLamports({ HEDGENTS_MAX_WALLET_FEE_LAMPORTS: "999999999999" }), 20_000_000n);
});

test("the ceiling applies to the debit and the fee independently", () => {
  const debitOnly = observed({
    reportDigest: "f".repeat(64),
    takerSolDebitLamports: String(5000 + 3_000_000),
  });
  assert.throws(
    () => assertTransactionGuardCompatible(QUOTED, debitOnly, { allowWalletFee: true }),
    /priority fee larger/i,
  );
  const feeOnly = observed({
    reportDigest: "f".repeat(64),
    networkFeeLamports: String(5000 + 3_000_000),
  });
  assert.throws(
    () => assertTransactionGuardCompatible(QUOTED, feeOnly, { allowWalletFee: true }),
    /priority fee larger/i,
  );
});
