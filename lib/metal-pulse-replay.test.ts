import assert from "node:assert/strict";
import test from "node:test";
import {
  METAL_PULSE_INTERVAL_SECONDS,
  buildPulseRound,
  type MetalPulsePricePoint,
} from "./metal-pulse";
import type { MetalPulsePythArtifact } from "./metal-pulse-source";
import { replayMetalPulseHistory, type MetalPulseReplayFetchResult } from "./metal-pulse-replay";

const START = 1_800_000_000;

function point(priceUsd: number, publishedAtUnix: number): MetalPulsePricePoint {
  return { priceUsd, confidenceUsd: 0.1, publishedAt: new Date(publishedAtUnix * 1_000).toISOString() };
}

function artifact(hashCharacter: string): MetalPulsePythArtifact {
  return {
    schemaVersion: "1.0.0",
    artifactHash: hashCharacter.repeat(64),
    contentType: "application/json",
    body: "{}",
    sourceUrl: "https://hermes.pyth.network/v2/updates/price/1800000000",
    retrievedAt: new Date(START * 1_000).toISOString(),
    requestedPublishTime: START,
    feedId: "feed",
    binaryEncoding: "hex",
    binaryUpdateCount: 1,
  };
}

function result(startsAtUnix: number, openingPrice: number, closingPrice: number | null): MetalPulseReplayFetchResult {
  const closing = closingPrice === null ? null : point(closingPrice, startsAtUnix + METAL_PULSE_INTERVAL_SECONDS);
  return {
    round: buildPulseRound({
      startsAtUnix,
      nowUnix: startsAtUnix + METAL_PULSE_INTERVAL_SECONDS + 60,
      opening: point(openingPrice, startsAtUnix),
      closing,
    }),
    artifacts: { opening: artifact("a"), closing: closing ? artifact("b") : null },
    providerState: "online",
  };
}

test("replays completed rounds and measures validity, gaps, and delays", async () => {
  const replay = await replayMetalPulseHistory({
    fromStartUnix: START,
    roundCount: 4,
    now: new Date((START + 5 * METAL_PULSE_INTERVAL_SECONDS) * 1_000),
    concurrency: 2,
    fetchRound: async ({ startsAtUnix }) => {
      const index = (startsAtUnix - START) / METAL_PULSE_INTERVAL_SECONDS;
      if (index === 0) return result(startsAtUnix, 100, 101);
      if (index === 1) return result(startsAtUnix, 101, 100);
      if (index === 2) return result(startsAtUnix, 100, null);
      throw new Error("Hermes unavailable");
    },
  });
  assert.equal(replay.summary.totalRounds, 4);
  assert.equal(replay.summary.resolvedRounds, 2);
  assert.equal(replay.summary.invalidRounds, 2);
  assert.equal(replay.summary.upRounds, 1);
  assert.equal(replay.summary.downRounds, 1);
  assert.equal(replay.summary.evidenceCompleteRounds, 2);
  assert.equal(replay.summary.longestInvalidRun, 2);
  assert.equal(replay.summary.degradedRounds, 1);
  assert.match(replay.replayHash, /^[a-f0-9]{64}$/);
});

test("replay rejects future, unaligned, and oversized ranges", async () => {
  await assert.rejects(() => replayMetalPulseHistory({
    fromStartUnix: START + 1,
    roundCount: 1,
    now: new Date((START + 10_000) * 1_000),
  }), /15-minute UTC boundary/);
  await assert.rejects(() => replayMetalPulseHistory({
    fromStartUnix: START,
    roundCount: 97,
    now: new Date((START + 100_000) * 1_000),
  }), /between one and 96 rounds/);
  await assert.rejects(() => replayMetalPulseHistory({
    fromStartUnix: START,
    roundCount: 2,
    now: new Date((START + METAL_PULSE_INTERVAL_SECONDS) * 1_000),
  }), /only completed/);
});
