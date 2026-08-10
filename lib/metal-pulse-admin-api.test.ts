import assert from "node:assert/strict";
import test from "node:test";
import { POST as planPulse } from "@/app/api/admin/scarcity/pulse/plan/route";
import { POST as preparePulseResolution } from "@/app/api/admin/scarcity/pulse/resolve/prepare/route";
import { POST as publishPulseResolution } from "@/app/api/admin/scarcity/pulse/resolve/publish/route";
import { POST as replayPulse } from "@/app/api/admin/scarcity/pulse/replay/route";
import { ADMIN_COOKIE, createAccessSession } from "@/lib/access-auth";
import { MAINNET_USDC_MINT } from "@/lib/scarcity-exchange";

const START = 1_800_000_000;
const signer = "11111111111111111111111111111111";

function request(path: string, body: unknown, cookie?: string) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `${ADMIN_COOKIE}=${encodeURIComponent(cookie)}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("Metal Pulse operator endpoints require administrator access", async () => {
  const planResponse = await planPulse(request("/api/admin/scarcity/pulse/plan", {}));
  const resolutionResponse = await preparePulseResolution(request("/api/admin/scarcity/pulse/resolve/prepare", {}));
  const publicationResponse = await publishPulseResolution(request("/api/admin/scarcity/pulse/resolve/publish", {}));
  const replayResponse = await replayPulse(request("/api/admin/scarcity/pulse/replay", {}));
  assert.equal(planResponse.status, 401);
  assert.equal(resolutionResponse.status, 401);
  assert.equal(publicationResponse.status, 401);
  assert.equal(replayResponse.status, 401);
});

test("Metal Pulse planner returns reviewable instructions without submitting", async () => {
  const now = new Date((START + 300) * 1_000).toISOString();
  const response = await planPulse(request("/api/admin/scarcity/pulse/plan", {
    now,
    admin: signer,
    collateralMint: MAINNET_USDC_MINT,
    sourceLatestPublishedAt: now,
    horizonRounds: 2,
    makerCapitalMicroUsdc: "1000000000",
    makerMaxRoundAllocationMicroUsdc: "100000000",
  }, createAccessSession("admin", 60)));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.submitted, false);
  assert.equal(body.persisted, false);
  assert.equal(body.readyCount, 1);
  assert.equal(body.plans[0].action, "create-ready");
  assert.equal(body.plans[0].createInstruction.dataHex.length, 256);
  assert.equal(body.plans[0].maker.allocationMicroUsdc, "100000000");
  assert.match(body.plans[0].market.marketId, /^[a-f0-9]{64}$/);
});
