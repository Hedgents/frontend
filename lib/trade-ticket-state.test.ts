import assert from "node:assert/strict";
import test from "node:test";
import { defaultAmountForTradeSide, maximumSellAmount } from "./trade-ticket-state";

test("buy defaults never exceed the closed-beta maximum", () => {
  assert.equal(defaultAmountForTradeSide("buy", 100, "2"), "100");
  assert.equal(defaultAmountForTradeSide("buy", 25, "2"), "25");
});

test("sell defaults to the selected wallet balance or a small probe", () => {
  assert.equal(defaultAmountForTradeSide("sell", 25, "0.003"), "0.003");
  assert.equal(defaultAmountForTradeSide("sell", 25, "0"), "0.1");
  assert.equal(defaultAmountForTradeSide("sell", 25, undefined), "0.1");
});

test("sell defaults and Max stay inside the closed-beta dollar cap", () => {
  // 0.5 PAXG at $3,500 is ~$1,750; a $25 cap allows ~0.007 units.
  assert.equal(defaultAmountForTradeSide("sell", 25, "0.5", 3500), "0.007");
  assert.equal(maximumSellAmount(25, "0.5", 3500), "0.007");
  // A holding already under the cap is offered in full.
  assert.equal(maximumSellAmount(100, "0.003", 3500), "0.003");
  // Cheap metal: the cap is far above a whole unit, so the balance still wins.
  assert.equal(maximumSellAmount(100, "2", 30), "2");
  // No price means the cap cannot be expressed in metal units; the server stays the authority.
  assert.equal(maximumSellAmount(25, "0.5", null), "0.5");
  // An empty wallet still gets a quotable, in-cap probe size rather than the old flat 0.1.
  assert.equal(maximumSellAmount(25, "0", 3500), "0.007");
  assert.equal(maximumSellAmount(25, undefined, 0), "0.1");
})
