import assert from "node:assert/strict";
import test from "node:test";
import { confirmedOrderCount } from "./analytics-metrics";

test("counts only independently verified settlements as confirmed orders", () => {
  assert.equal(confirmedOrderCount([
    { name: "order_confirmed", properties: { requestId: "one" } },
    { name: "settlement_pending", properties: { requestId: "one" } },
    { name: "settlement_verified", properties: { requestId: "one" } },
    { name: "settlement_verified", properties: { requestId: "one" } },
    { name: "settlement_verified", properties: { requestId: "two" } },
  ]), 2);
  assert.equal(confirmedOrderCount([{ name: "order_confirmed", properties: {} }]), 0);
});
