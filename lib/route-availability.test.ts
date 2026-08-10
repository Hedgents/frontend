import assert from "node:assert/strict";
import test from "node:test";
import { classifyRouteAvailability, routeAvailabilityLabel } from "./route-availability";

test("classifies actionable route failures for the terminal", () => {
  assert.equal(classifyRouteAvailability("Jupiter API key is not configured"), "configuration-required");
  assert.equal(classifyRouteAvailability("Market maker is offline"), "market-closed");
  assert.equal(classifyRouteAvailability("Only USDC is available for swapping with Ondo"), "settlement-restricted");
  assert.equal(classifyRouteAvailability("No route found"), "insufficient-liquidity");
  assert.equal(classifyRouteAvailability("Transfer is restricted"), "transfer-restricted");
  assert.equal(routeAvailabilityLabel("provider-unavailable"), "Venue unavailable");
});

