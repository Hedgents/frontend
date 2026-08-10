import assert from "node:assert/strict";
import test from "node:test";
import {
  METAL_PULSE_INTERVAL_SECONDS,
  buildPulseRound,
  createMetalPulsePaperAccount,
  parsePulseRoundId,
  placeMetalPulsePaperPosition,
  pulseRoundId,
  pulseRoundStart,
  settleMetalPulsePaperAccount,
  settlePulseRound,
  type MetalPulsePricePoint,
} from "./metal-pulse";
import { GOLD_PYTH_FEED_ID, fetchMetalPulseSnapshot } from "./metal-pulse-source";

const START = 1_800_000_000;

function point(priceUsd: number, publishedAtUnix: number): MetalPulsePricePoint {
  return { priceUsd, confidenceUsd: 0.25, publishedAt: new Date(publishedAtUnix * 1_000).toISOString() };
}

function pythPayload(priceUsd: number, publishedAtUnix: number) {
  return {
    binary: { encoding: "hex", data: ["deadbeef"] },
    parsed: [{
      id: GOLD_PYTH_FEED_ID,
      price: {
        price: String(Math.round(priceUsd * 1_000)),
        conf: "250",
        expo: -3,
        publish_time: publishedAtUnix,
      },
      metadata: {
        slot: publishedAtUnix,
        proof_available_time: publishedAtUnix + 1,
        prev_publish_time: publishedAtUnix - 1,
      },
    }],
  };
}

test("builds stable 15-minute round identities and rejects malformed ids", () => {
  assert.equal(pulseRoundStart(START + 899), START);
  assert.equal(pulseRoundId(START), `gold-15m-${START}`);
  assert.equal(parsePulseRoundId(`gold-15m-${START}`), START);
  assert.equal(parsePulseRoundId(`gold-15m-${START + 1}`), null);
  assert.equal(parsePulseRoundId("silver-15m-1800000000"), null);
});

test("resolves only observations inside committed windows", () => {
  assert.deepEqual(settlePulseRound(point(100, START), point(101, START + 900), START), {
    outcome: "up",
    invalidReason: null,
  });
  assert.equal(settlePulseRound(point(100, START), point(99, START + 900), START).outcome, "down");
  assert.equal(settlePulseRound(point(100, START), point(100, START + 900), START).outcome, "invalid");
  assert.match(
    settlePulseRound(point(100, START + 61), point(101, START + 900), START).invalidReason ?? "",
    /opening observation/i,
  );
});

test("moves a round through scheduled, trading, frozen, and resolved states", () => {
  const scheduled = buildPulseRound({ startsAtUnix: START, nowUnix: START - 1 });
  const trading = buildPulseRound({ startsAtUnix: START, nowUnix: START + 60, opening: point(100, START), latest: point(100.5, START + 60) });
  const frozen = buildPulseRound({ startsAtUnix: START, nowUnix: START + 890, opening: point(100, START), latest: point(100.5, START + 890) });
  const resolved = buildPulseRound({ startsAtUnix: START, nowUnix: START + 901, opening: point(100, START), closing: point(101, START + 900) });
  assert.equal(scheduled.status, "scheduled");
  assert.equal(trading.status, "trading");
  assert.equal(frozen.status, "frozen");
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.outcome, "up");
});

test("paper positions debit balance and settle wins, losses, and invalid rounds exactly", () => {
  const nextRound = buildPulseRound({ startsAtUnix: START, nowUnix: START - 60 });
  const initial = createMetalPulsePaperAccount(100);
  const placed = placeMetalPulsePaperPosition({
    account: initial,
    round: nextRound,
    direction: "up",
    stakeUsdc: 10,
    placedAt: "2027-01-15T07:59:00.000Z",
    positionId: "paper-1",
  });
  assert.equal(placed.account.balanceUsdc, 90);
  assert.equal(placed.position.shares, 20);
  const wonRound = buildPulseRound({ startsAtUnix: START, nowUnix: START + 901, opening: point(100, START), closing: point(101, START + 900) });
  const settled = settleMetalPulsePaperAccount(placed.account, new Map([[wonRound.id, wonRound]]));
  assert.equal(settled.balanceUsdc, 110);
  assert.equal(settled.positions[0].status, "won");
  assert.equal(settled.positions[0].payoutUsdc, 20);
});

test("paper entries freeze before the committed observation window", () => {
  const nextRound = buildPulseRound({ startsAtUnix: START, nowUnix: START - 10 });
  assert.throws(() => placeMetalPulsePaperPosition({
    account: createMetalPulsePaperAccount(100),
    round: nextRound,
    direction: "up",
    stakeUsdc: 10,
    placedAt: new Date((START - 10) * 1_000).toISOString(),
  }), /final 15 seconds/i);
});

test("builds current, previous, and next rounds from exact Pyth timestamps", async () => {
  const nowUnix = START + 600;
  const previousStart = START - METAL_PULSE_INTERVAL_SECONDS;
  const requested: string[] = [];
  const snapshot = await fetchMetalPulseSnapshot({
    now: new Date(nowUnix * 1_000),
    fetchImpl: async (input) => {
      const url = new URL(input.toString());
      requested.push(url.pathname);
      if (url.pathname.endsWith("/latest")) return Response.json(pythPayload(102, nowUnix));
      const timestamp = Number(url.pathname.split("/").at(-1));
      if (timestamp === previousStart) return Response.json(pythPayload(99, previousStart));
      if (timestamp === START) return Response.json(pythPayload(100, START));
      return new Response(null, { status: 404 });
    },
  });
  assert.equal(snapshot.providerState, "online");
  assert.equal(snapshot.previous.outcome, "up");
  assert.equal(snapshot.current.status, "trading");
  assert.equal(snapshot.current.opening?.priceUsd, 100);
  assert.equal(snapshot.current.latest?.priceUsd, 102);
  assert.equal(snapshot.next.status, "scheduled");
  assert.equal(snapshot.next.paperQuote.kind, "fixed-simulation");
  assert.equal(requested.length, 3);
});

test("degrades without inventing a current round when Pyth is unavailable", async () => {
  const snapshot = await fetchMetalPulseSnapshot({
    now: new Date((START + 600) * 1_000),
    fetchImpl: async () => new Response(null, { status: 503 }),
  });
  assert.equal(snapshot.providerState, "degraded");
  assert.equal(snapshot.current.status, "session-closed");
  assert.equal(snapshot.current.opening, null);
  assert.match(snapshot.providerMessage ?? "", /503/);
});
