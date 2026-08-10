import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "@/app/api/admin/scarcity/markets/prepare/route";
import { ADMIN_COOKIE, createAccessSession } from "@/lib/access-auth";
import { SCARCITY_MARKET_CATALOG } from "@/lib/scarcity-markets";

function prepareRequest(cookie?: string) {
  const market = SCARCITY_MARKET_CATALOG[0];
  return new Request("http://localhost/api/admin/scarcity/markets/prepare", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `${ADMIN_COOKIE}=${encodeURIComponent(cookie)}` } : {}),
    },
    body: JSON.stringify({ question: market.question, rules: market.rules }),
  });
}

test("market preparation requires an administrator session", async () => {
  const response = await POST(prepareRequest());
  assert.equal(response.status, 401);
});

test("market preparation reproduces commitments and derives accounts", async () => {
  const market = SCARCITY_MARKET_CATALOG[0];
  const response = await POST(prepareRequest(createAccessSession("admin", 60)));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.marketId, market.marketId);
  assert.equal(body.questionHash, market.questionHash);
  assert.equal(body.rulesHash, market.rulesHash);
  assert.equal(body.prepared, true);
  assert.equal(body.persisted, false);
  assert.equal(body.submitted, false);
  assert.match(body.addresses.market, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
});
