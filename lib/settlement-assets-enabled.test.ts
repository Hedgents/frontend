import assert from "node:assert/strict";
import test from "node:test";
import { enabledSettlementAssetIds, isSettlementAssetEnabled } from "./product-registry";

/**
 * USDT and USDG are correctly defined and Jupiter prices both, but selling into them routes through
 * venues the operator program allowlist has not reviewed, so the order dead-ends after the user has
 * already chosen a size. Until that venue set is reviewed the beta settles in USDC.
 */
test("the beta settles in USDC unless told otherwise", () => {
  assert.deepEqual(enabledSettlementAssetIds({}), ["usdc"]);
  assert.equal(isSettlementAssetEnabled("usdc", {}), true);
  assert.equal(isSettlementAssetEnabled("usdt", {}), false);
  assert.equal(isSettlementAssetEnabled("usdg", {}), false);
});

test("re-enabling is configuration, not a code change", () => {
  const env = { HEDGENTS_SETTLEMENT_ASSETS: "usdc,usdt" };
  assert.deepEqual(enabledSettlementAssetIds(env), ["usdc", "usdt"]);
  assert.equal(isSettlementAssetEnabled("usdt", env), true);
  assert.equal(isSettlementAssetEnabled("usdg", env), false);
});

test("unknown entries are ignored rather than trusted", () => {
  assert.deepEqual(
    enabledSettlementAssetIds({ HEDGENTS_SETTLEMENT_ASSETS: "usdc,dogecoin,usdg" }),
    ["usdc", "usdg"],
  );
});

test("a malformed list falls back to USDC instead of disabling trading", () => {
  // Resolving to nothing would take the terminal down, which is a worse failure than being narrow.
  assert.deepEqual(enabledSettlementAssetIds({ HEDGENTS_SETTLEMENT_ASSETS: "   " }), ["usdc"]);
  assert.deepEqual(enabledSettlementAssetIds({ HEDGENTS_SETTLEMENT_ASSETS: "nonsense" }), ["usdc"]);
});

test("case and duplicates are tolerated", () => {
  assert.deepEqual(
    enabledSettlementAssetIds({ HEDGENTS_SETTLEMENT_ASSETS: "USDC, usdc ,USDT" }),
    ["usdc", "usdt"],
  );
});

test("a non-string id is never enabled", () => {
  for (const value of [null, undefined, 42, {}, []]) {
    assert.equal(isSettlementAssetEnabled(value, {}), false);
  }
});
