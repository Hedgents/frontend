import assert from "node:assert/strict";
import test from "node:test";
import {
  buildXpProfile,
  MAXIMUM_TERMINAL_TRADES_PER_DAY,
  scoreBinaryPosition,
  scoreTerminalTrades,
  XP_AWARDS,
  type XpBinaryPosition,
  type XpTerminalTrade,
} from "./rules";

function binary(overrides: Partial<XpBinaryPosition> = {}): XpBinaryPosition {
  return {
    marketSlug: "beryllium-official-reference-2027",
    cluster: "devnet",
    yes: 100n,
    no: 0n,
    status: "resolved-yes",
    ...overrides,
  };
}

function trade(overrides: Partial<XpTerminalTrade> = {}): XpTerminalTrade {
  return {
    signature: `sig-${Math.random()}`,
    cluster: "mainnet-beta",
    productId: "gold-paxg",
    direction: "buy",
    settledAt: "2026-08-12T10:00:00.000Z",
    ...overrides,
  };
}

test("holding the winning side earns participation plus a modest correctness bonus", () => {
  const scored = scoreBinaryPosition(binary());
  assert.equal(scored.participation, XP_AWARDS.binaryParticipation);
  assert.equal(scored.correct, XP_AWARDS.binaryCorrect);
});

test("being right on a coin flip is worth far less than a 1-in-41 forecast", () => {
  // Otherwise luck pays at the same rate as skill, and the curve market's accuracy signal is
  // devalued by comparison.
  assert.ok(XP_AWARDS.binaryCorrect < XP_AWARDS.accuracyMaximum / 3);
});

test("holding the losing side still earns participation", () => {
  const scored = scoreBinaryPosition(binary({ status: "resolved-no" }));
  assert.equal(scored.participation, XP_AWARDS.binaryParticipation);
  assert.equal(scored.correct, 0);
});

test("an invalid binary market pays participation and names no winner", () => {
  const scored = scoreBinaryPosition(binary({ status: "invalid", no: 100n }));
  assert.equal(scored.correct, 0);
  assert.match(scored.note ?? "", /no side was correct/);
});

test("an unresolved market and an empty position both pay nothing", () => {
  assert.equal(scoreBinaryPosition(binary({ status: "unresolved" })).total, 0);
  assert.equal(scoreBinaryPosition(binary({ yes: 0n, no: 0n })).total, 0);
});

test("a signature is counted once however often it is reported", () => {
  const once = trade({ signature: "repeat" });
  const [scored] = scoreTerminalTrades([once, { ...once }, { ...once }]);
  assert.equal(scored.trades, 1);
  assert.equal(scored.countedTrades, 1);
});

test("terminal credit is capped per day so small trades cannot be sprayed", () => {
  const many = Array.from({ length: 20 }, (_, index) =>
    trade({ signature: `s-${index}`, settledAt: "2026-08-12T10:00:00.000Z" }));
  const [scored] = scoreTerminalTrades(many);
  assert.equal(scored.trades, 20);
  assert.equal(scored.countedTrades, MAXIMUM_TERMINAL_TRADES_PER_DAY);
});

test("the cap resets across days", () => {
  const spread = ["2026-08-10", "2026-08-11", "2026-08-12"].flatMap((day, dayIndex) =>
    Array.from({ length: 5 }, (_, index) =>
      trade({ signature: `${day}-${index}`, settledAt: `${day}T10:0${dayIndex}:00.000Z` })));
  const [scored] = scoreTerminalTrades(spread);
  assert.equal(scored.countedTrades, MAXIMUM_TERMINAL_TRADES_PER_DAY * 3);
});

test("a round trip pays only when the product was both bought and sold", () => {
  const buyOnly = scoreTerminalTrades([trade({ signature: "b" })])[0];
  assert.equal(buyOnly.roundTrips, 0);
  const both = scoreTerminalTrades([
    trade({ signature: "b", direction: "buy" }),
    trade({ signature: "s", direction: "sell", settledAt: "2026-08-13T10:00:00.000Z" }),
  ])[0];
  assert.deepEqual(both.roundTripProducts, ["gold-paxg"]);
  assert.equal(both.total, 2 * XP_AWARDS.terminalTrade + XP_AWARDS.terminalRoundTrip);
});

test("a round trip counts even when the day cap swallowed the trades themselves", () => {
  // The exit path is what needs exercising, so proving it should not be lost to the spam guard.
  const sameDay = [
    ...Array.from({ length: 5 }, (_, index) => trade({ signature: `b-${index}` })),
    trade({ signature: "s", direction: "sell" }),
  ];
  const [scored] = scoreTerminalTrades(sameDay);
  assert.equal(scored.countedTrades, MAXIMUM_TERMINAL_TRADES_PER_DAY);
  assert.equal(scored.roundTrips, 1);
});

test("clusters are scored separately and never pooled", () => {
  const scored = scoreTerminalTrades([
    trade({ signature: "m", cluster: "mainnet-beta" }),
    trade({ signature: "d", cluster: "devnet" }),
  ]);
  assert.equal(scored.length, 2);
  assert.deepEqual(scored.map((entry) => entry.cluster).sort(), ["devnet", "mainnet-beta"]);
});

test("all four sources compose into one profile with clusters kept apart", () => {
  const profile = buildXpProfile({
    granteeId: "invite-1",
    rounds: [],
    awards: [],
    binary: [binary()],
    terminalTrades: [trade({ signature: "t1" })],
  });
  assert.equal(profile.binary.length, 1);
  assert.equal(profile.terminal.length, 1);
  assert.ok(profile.byCluster.devnet > 0, "binary devnet position counted");
  assert.ok(profile.byCluster["mainnet-beta"] > 0, "terminal mainnet trade counted");
  assert.equal(profile.total, profile.byCluster.devnet + profile.byCluster["mainnet-beta"]);
});

test("an empty profile is zero rather than undefined", () => {
  const profile = buildXpProfile({ granteeId: "invite-1", rounds: [], awards: [] });
  assert.equal(profile.total, 0);
  assert.deepEqual(profile.binary, []);
  assert.deepEqual(profile.terminal, []);
});
