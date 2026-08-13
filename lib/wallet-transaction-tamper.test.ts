import assert from "node:assert/strict";
import test from "node:test";
import { describeWalletTampering } from "./wallet-transaction-tamper";

/** A wire transaction: short-vec signature count, that many 64-byte signatures, then the message. */
function transaction(signatureCount: number, message: number[], fill = 0) {
  const signatures = new Uint8Array(signatureCount * 64).fill(fill);
  return Uint8Array.from([signatureCount, ...signatures, ...message]);
}

test("an untouched message is not reported as changed, whatever the signatures say", () => {
  const message = [0x80, 1, 0, 1, 9, 9, 9];
  // Same message, one unsigned and one signed: signatures differ by design.
  const report = describeWalletTampering({
    original: transaction(1, message, 0),
    signed: transaction(1, message, 0xab),
  });
  assert.equal(report.changed, false);
  assert.equal(report.summary, null);
  assert.equal(report.originalMessageBytes, message.length);
});

test("an added instruction is reported as the likely priority-fee edit", () => {
  const report = describeWalletTampering({
    original: transaction(1, [0x80, 1, 0, 1, 9]),
    signed: transaction(1, [0x80, 1, 0, 1, 9, 7, 7, 7]),
  });
  assert.equal(report.changed, true);
  assert.equal(report.lengthChanged, true);
  assert.match(report.summary ?? "", /priority fee/i);
  assert.equal(report.originalMessageBytes, 5);
  assert.equal(report.signedMessageBytes, 8);
});

test("a same-length edit is called out as a route or amount change, which is the alarming case", () => {
  const report = describeWalletTampering({
    original: transaction(1, [0x80, 1, 0, 1, 9]),
    signed: transaction(1, [0x80, 1, 0, 1, 4]),
  });
  assert.equal(report.changed, true);
  assert.equal(report.lengthChanged, false);
  assert.match(report.summary ?? "", /route or its amounts/i);
});

test("a differing signature count does not by itself count as tampering", () => {
  // The unsigned original may carry placeholder slots; what matters is the message after them.
  const message = [0x80, 1, 0, 1, 9];
  const report = describeWalletTampering({
    original: transaction(2, message),
    signed: transaction(2, message, 0xff),
  });
  assert.equal(report.changed, false);
});

test("a truncated transaction is reported rather than throwing", () => {
  const report = describeWalletTampering({
    original: Uint8Array.from([4, 1, 2, 3]), // claims four signatures, has none
    signed: Uint8Array.from([1]),
  });
  assert.equal(report.changed, true);
  assert.match(report.summary ?? "", /could not be read back/i);
});
