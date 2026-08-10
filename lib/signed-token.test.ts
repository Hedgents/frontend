import assert from "node:assert/strict";
import test from "node:test";
import { createSignedToken, SignedTokenError, verifySignedToken } from "./signed-token";

test("authenticates claims only inside the intended namespace", () => {
  const token = createSignedToken("orders.v1", { requestId: "abc", expiresAt: 42 }, "secret");
  assert.deepEqual(
    verifySignedToken("orders.v1", token, "secret"),
    { requestId: "abc", expiresAt: 42 },
  );
  assert.throws(() => verifySignedToken("recovery.v1", token, "secret"), SignedTokenError);
});

test("rejects tampered claims, wrong secrets, and malformed tokens", () => {
  const token = createSignedToken("orders.v1", { requestId: "abc" }, "secret");
  const [claims, signature] = token.split(".");
  assert.throws(
    () => verifySignedToken("orders.v1", `${claims}a.${signature}`, "secret"),
    SignedTokenError,
  );
  assert.throws(() => verifySignedToken("orders.v1", token, "wrong"), SignedTokenError);
  assert.throws(() => verifySignedToken("orders.v1", "bad", "secret"), SignedTokenError);
});

