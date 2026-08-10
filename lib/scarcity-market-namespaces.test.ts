import assert from "node:assert/strict";
import test from "node:test";
import {
  METAL_MARKET_NAMESPACE_COVERAGE,
  METAL_MARKET_NAMESPACES,
  SCARCITY_METALS,
  getMetalMarketNamespace,
} from "./scarcity";

test("every tracked metal has a data or event market namespace", () => {
  assert.equal(METAL_MARKET_NAMESPACES.length, SCARCITY_METALS.length);
  assert.equal(METAL_MARKET_NAMESPACE_COVERAGE.mapped, 99);
  assert.equal(METAL_MARKET_NAMESPACE_COVERAGE.eventEligible, 99);
  assert.equal(METAL_MARKET_NAMESPACES.every((namespace) => namespace.primaryQuestion.endsWith("?")), true);
  assert.equal(METAL_MARKET_NAMESPACES.every((namespace) => namespace.paths.some((path) => path.kind === "event" && path.eligible)), true);
});

test("commercial germanium and scientific technetium expose different primary paths", () => {
  const germanium = getMetalMarketNamespace("Ge");
  const technetium = getMetalMarketNamespace("Tc");
  assert.equal(germanium?.primaryPath, "data");
  assert.equal(germanium?.eligibleCategories.includes("policy"), true);
  assert.equal(technetium?.primaryPath, "event");
  assert.equal(technetium?.primaryCategory, "science");
  assert.equal(technetium?.eligibleCategories.includes("policy"), false);
});
