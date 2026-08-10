import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { getAddressDecoder } from "@solana/kit";
import { bindSolanaTransaction } from "./solana-transaction-binding";

const addressDecoder = getAddressDecoder();

function fixture(options: { signed?: boolean; payerByte?: number; messageByte?: number } = {}) {
  const payer = Uint8Array.from({ length: 32 }, () => options.payerByte ?? 7);
  const program = Uint8Array.from({ length: 32 }, () => 9);
  const message = Uint8Array.from([
    0x80, 1, 0, 1,
    2,
    ...payer,
    ...program,
    ...Uint8Array.from({ length: 32 }, () => options.messageByte ?? 3),
    0,
    0,
  ]);
  const transaction = Uint8Array.from([
    1,
    ...Uint8Array.from({ length: 64 }, () => options.signed ? 4 : 0),
    ...message,
  ]);
  return {
    payer: String(addressDecoder.decode(payer)),
    encoded: Buffer.from(transaction).toString("base64"),
    digest: createHash("sha256").update(message).digest("hex"),
  };
}

test("binds a Solana transaction to its exact message and fee payer", () => {
  const input = fixture();
  const binding = bindSolanaTransaction(input.encoded, input.payer);
  assert.equal(binding.messageDigest, input.digest);
  assert.equal(binding.requiredSignatureCount, 1);
  assert.equal(binding.firstSignaturePresent, false);
  assert.equal(binding.firstSignature, null);
});

test("requires a populated wallet signature at execution time", () => {
  const unsigned = fixture();
  assert.throws(() => bindSolanaTransaction(unsigned.encoded, unsigned.payer, { requireFirstSignature: true }));
  const signed = fixture({ signed: true });
  const signedBinding = bindSolanaTransaction(signed.encoded, signed.payer, { requireFirstSignature: true });
  assert.equal(signedBinding.firstSignaturePresent, true);
  assert.equal(typeof signedBinding.firstSignature, "string");
  assert.match(signedBinding.firstSignature ?? "", /^[1-9A-HJ-NP-Za-km-z]{87,88}$/);
});

test("rejects a different fee payer or altered message", () => {
  const input = fixture({ signed: true });
  const other = fixture({ payerByte: 8, signed: true });
  assert.throws(() => bindSolanaTransaction(input.encoded, other.payer));
  assert.notEqual(bindSolanaTransaction(input.encoded, input.payer).messageDigest, bindSolanaTransaction(fixture({ signed: true, messageByte: 5 }).encoded, input.payer).messageDigest);
});
