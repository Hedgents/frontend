import assert from "node:assert/strict";
import test from "node:test";
import { calculateOwnerTokenDelta } from "./settlement-verification";

test("calculates the aggregate token increase for one owner and mint", () => {
  const pre = [
    { owner: "wallet", mint: "metal", uiTokenAmount: { amount: "100" } },
    { owner: "wallet", mint: "other", uiTokenAmount: { amount: "999" } },
  ];
  const post = [
    { owner: "wallet", mint: "metal", uiTokenAmount: { amount: "175" } },
    { owner: "wallet", mint: "metal", uiTokenAmount: { amount: "25" } },
  ];
  assert.equal(calculateOwnerTokenDelta(pre, post, "wallet", "metal"), 100n);
});

test("supports a newly-created destination token account", () => {
  const post = [{ owner: "wallet", mint: "metal", uiTokenAmount: { amount: "42" } }];
  assert.equal(calculateOwnerTokenDelta([], post, "wallet", "metal"), 42n);
});
