import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMetalPulseMakerQuotePlan,
  simulateMetalPulseMakerRound,
  simulateRollingMetalPulseMaker,
} from "./metal-pulse-maker";

const MARKET_A = "a".repeat(64);
const MARKET_B = "b".repeat(64);
const CAPITAL = 1_000_000_000n;

test("caps maker allocation and produces deterministic two-sided order IDs", () => {
  const first = buildMetalPulseMakerQuotePlan({
    marketId: MARKET_A,
    availableCapitalMicroUsdc: CAPITAL,
    maxRoundAllocationMicroUsdc: 100_000_000n,
  });
  const second = buildMetalPulseMakerQuotePlan({
    marketId: MARKET_A,
    availableCapitalMicroUsdc: CAPITAL,
    maxRoundAllocationMicroUsdc: 100_000_000n,
  });
  assert.deepEqual(first, second);
  assert.equal(first.allocationMicroUsdc, 100_000_000n);
  assert.notEqual(first.yesAsk.orderId, first.noAsk.orderId);
  assert.equal(first.bothFilledGrossEdgeMicroUsdc, 4_000_000n);
  assert.equal(first.maximumOneSidedLossMicroUsdc, 48_000_000n);
});

test("recycles complete sets and preserves capital when neither ask fills", () => {
  const quote = buildMetalPulseMakerQuotePlan({
    marketId: MARKET_A,
    availableCapitalMicroUsdc: CAPITAL,
    maxRoundAllocationMicroUsdc: 100_000_000n,
  });
  const result = simulateMetalPulseMakerRound({
    quote,
    startingCapitalMicroUsdc: CAPITAL,
    yesFilled: 0n,
    noFilled: 0n,
    outcome: "yes",
  });
  assert.equal(result.mergedCompleteSets, 100_000_000n);
  assert.equal(result.endingCapitalMicroUsdc, CAPITAL);
  assert.equal(result.profitMicroUsdc, 0n);
});

test("earns the quoted edge when both asks fill and exposes one-sided risk", () => {
  const quote = buildMetalPulseMakerQuotePlan({
    marketId: MARKET_A,
    availableCapitalMicroUsdc: CAPITAL,
    maxRoundAllocationMicroUsdc: 100_000_000n,
  });
  const both = simulateMetalPulseMakerRound({
    quote,
    startingCapitalMicroUsdc: CAPITAL,
    yesFilled: quote.completeSetQuantity,
    noFilled: quote.completeSetQuantity,
    outcome: "yes",
  });
  assert.equal(both.profitMicroUsdc, 4_000_000n);

  const adverse = simulateMetalPulseMakerRound({
    quote,
    startingCapitalMicroUsdc: CAPITAL,
    yesFilled: quote.completeSetQuantity,
    noFilled: 0n,
    outcome: "yes",
  });
  assert.equal(adverse.profitMicroUsdc, -48_000_000n);
  assert.equal(adverse.noInventoryAtResolution, quote.completeSetQuantity);
});

test("rolls the same maker capital through consecutive rounds", () => {
  const rolling = simulateRollingMetalPulseMaker({
    initialCapitalMicroUsdc: CAPITAL,
    maxRoundAllocationMicroUsdc: 100_000_000n,
    rounds: [
      { marketId: MARKET_A, yesFilledBps: 10_000, noFilledBps: 10_000, outcome: "yes" },
      { marketId: MARKET_B, yesFilledBps: 0, noFilledBps: 0, outcome: "invalid" },
    ],
  });
  assert.equal(rolling.rounds.length, 2);
  assert.equal(rolling.endingCapitalMicroUsdc, 1_004_000_000n);
  assert.equal(rolling.profitMicroUsdc, 4_000_000n);
});

test("rejects a two-sided quote that locks in a loss", () => {
  assert.throws(
    () => buildMetalPulseMakerQuotePlan({
      marketId: MARKET_A,
      availableCapitalMicroUsdc: CAPITAL,
      maxRoundAllocationMicroUsdc: 100_000_000n,
      yesAskPriceMicroUsdc: 490_000n,
      noAskPriceMicroUsdc: 490_000n,
    }),
    /must not lock in a loss/,
  );
});
