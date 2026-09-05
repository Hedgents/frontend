import assert from "node:assert/strict";
import test from "node:test";
import { SCARCITY_MARKET_CATALOG } from "@/lib/scarcity-markets";
import { SCARCITY_METHODOLOGY_VERSION } from "@/lib/scarcity/methodology";

// SCARCITY_INDEX_SPEC.md §8 "Catalog defects, same window": the question prose
// and the hashed metric document must both carry the engine's methodology
// version, and a future methodology bump must turn this test red rather than
// silently leaving a stale on-chain commitment.
test("catalog data markets commit the engine methodology version in prose and observation", () => {
  const dataMarkets = SCARCITY_MARKET_CATALOG.filter(
    (market) => market.question.kind !== "event",
  );
  assert.ok(dataMarkets.length > 0, "catalog must contain data markets");
  for (const market of dataMarkets) {
    const question = market.question as { question: string; observation?: { methodologyVersion: string } };
    if (!question.observation) continue;
    assert.equal(
      question.observation.methodologyVersion,
      SCARCITY_METHODOLOGY_VERSION,
      `${market.slug}: hashed observation methodologyVersion is stale`,
    );
    assert.ok(
      question.question.includes(SCARCITY_METHODOLOGY_VERSION),
      `${market.slug}: question prose must cite ${SCARCITY_METHODOLOGY_VERSION}`,
    );
  }
});
