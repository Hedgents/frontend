import assert from "node:assert/strict";
import test from "node:test";
import { routeComparisonScope } from "../hooks/use-route-comparison";

test("route comparison debounce scope changes with side and settlement", () => {
  const buy = routeComparisonScope("buy", "gold-paxg", "usdc");
  assert.notEqual(buy, routeComparisonScope("sell", "gold-paxg", "usdc"));
  assert.notEqual(buy, routeComparisonScope("buy", "gold-paxg", "usdt"));
  assert.notEqual(buy, routeComparisonScope("buy", "gold-oro", "usdc"));
});
