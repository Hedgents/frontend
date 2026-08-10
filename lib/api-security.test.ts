import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiSecurityError,
  enforceRateLimit,
  resetRateLimitsForTests,
  secureMutation,
} from "./api-security";

test("rate limits by endpoint and client without mixing identities", () => {
  resetRateLimitsForTests();
  const policy = { key: "orders", limit: 2, windowMs: 1_000 };
  const first = new Request("https://hedgents.com/api/order", { headers: { "x-forwarded-for": "1.2.3.4" } });
  const second = new Request("https://hedgents.com/api/order", { headers: { "x-forwarded-for": "4.3.2.1" } });
  assert.equal(enforceRateLimit(first, policy, 100).remaining, 1);
  assert.equal(enforceRateLimit(first, policy, 100).remaining, 0);
  assert.throws(() => enforceRateLimit(first, policy, 100), ApiSecurityError);
  assert.equal(enforceRateLimit(second, policy, 100).remaining, 1);
  assert.equal(enforceRateLimit(first, policy, 1_101).remaining, 1);
});

test("mutation guard rejects foreign origins, non-JSON bodies, and oversized requests", () => {
  resetRateLimitsForTests();
  const policy = { key: "execute", limit: 1, windowMs: 1_000 };
  assert.throws(() => secureMutation(new Request("https://hedgents.com/api/execute", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
  }), policy), ApiSecurityError);
  assert.throws(() => secureMutation(new Request("https://hedgents.com/api/execute", {
    method: "POST",
    headers: { "content-type": "text/plain" },
  }), policy), ApiSecurityError);
  assert.throws(() => secureMutation(new Request("https://hedgents.com/api/execute", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "5000" },
  }), policy, 100), ApiSecurityError);
});

test("accepts the browser-facing origin behind a local or deployment proxy", () => {
  resetRateLimitsForTests();
  const request = new Request("http://localhost:3010/api/execution/compare", {
    method: "POST",
    headers: {
      origin: "http://127.0.0.1:3010",
      host: "127.0.0.1:3010",
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.doesNotThrow(() => secureMutation(
    request,
    { key: "compare", limit: 2, windowMs: 1_000 },
  ));
});
