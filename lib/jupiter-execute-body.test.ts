import assert from "node:assert/strict";
import test from "node:test";
import { jupiterExecuteBody } from "./jupiter-execute-body";

/**
 * Jupiter validates its request body with a schema expecting `lastValidBlockHeight` as a string.
 * Sending the number it is everywhere else got the request rejected before the transaction was
 * looked at: "Expected string, received number", no execution, nothing on chain. Worth pinning.
 */
test("lastValidBlockHeight goes over the wire as a string", () => {
  const body = jupiterExecuteBody({
    signedTransaction: "AQAB",
    requestId: "req-1",
    lastValidBlockHeight: 371_845_112,
  });
  assert.equal(typeof body.lastValidBlockHeight, "string");
  assert.equal(body.lastValidBlockHeight, "371845112");
  assert.equal(body.signedTransaction, "AQAB");
  assert.equal(body.requestId, "req-1");
});

test("an absent block height is omitted rather than sent as the text \"undefined\"", () => {
  const body = jupiterExecuteBody({ signedTransaction: "AQAB", requestId: "req-2" });
  assert.ok(!("lastValidBlockHeight" in body));
});

test("block height zero is sent, not dropped as falsy", () => {
  const body = jupiterExecuteBody({
    signedTransaction: "AQAB",
    requestId: "req-3",
    lastValidBlockHeight: 0,
  });
  assert.equal(body.lastValidBlockHeight, "0");
});

test("every value on the wire is a string, which is what the schema demands", () => {
  const body = jupiterExecuteBody({
    signedTransaction: "AQAB",
    requestId: "req-4",
    lastValidBlockHeight: 1,
  });
  for (const [key, value] of Object.entries(body)) {
    assert.equal(typeof value, "string", `${key} should be a string`);
  }
});
