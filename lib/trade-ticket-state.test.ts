import assert from "node:assert/strict";
import test from "node:test";
import { defaultAmountForTradeSide } from "./trade-ticket-state";

test("buy defaults never exceed the closed-beta maximum", () => {
  assert.equal(defaultAmountForTradeSide("buy", 100, "2"), "100");
  assert.equal(defaultAmountForTradeSide("buy", 25, "2"), "25");
});

test("sell defaults to the selected wallet balance or a small probe", () => {
  assert.equal(defaultAmountForTradeSide("sell", 25, "0.003"), "0.003");
  assert.equal(defaultAmountForTradeSide("sell", 25, "0"), "0.1");
  assert.equal(defaultAmountForTradeSide("sell", 25, undefined), "0.1");
});
