import assert from "node:assert/strict";
import test from "node:test";
import { AccountRole, address } from "@solana/kit";
import {
  METAL_PULSE_ENTRY_FREEZE_SECONDS,
  METAL_PULSE_RESOLUTION_GRACE_SECONDS,
  buildMetalPulseCreatePacket,
  buildMetalPulseResolutionPacket,
  compileMetalPulseMarket,
  planMetalPulseRounds,
  serializeMetalPulseInstruction,
} from "./metal-pulse-market";
import { METAL_PULSE_INTERVAL_SECONDS, type MetalPulsePricePoint } from "./metal-pulse";
import { MAINNET_USDC_MINT, SCARCITY_EXCHANGE_PROGRAM_ADDRESS } from "./scarcity-exchange";

const START = 1_800_000_000;
const signer = address("11111111111111111111111111111111");

function point(rawPrice: string, exponent: number, publishedAtUnix: number): MetalPulsePricePoint {
  return {
    priceUsd: Number(rawPrice) * 10 ** exponent,
    confidenceUsd: 0.01,
    publishedAt: new Date(publishedAtUnix * 1_000).toISOString(),
    raw: { price: rawPrice, confidence: "100", exponent },
    evidence: {
      artifactHash: `${"a".repeat(63)}${publishedAtUnix % 10}`,
      sourceUrl: `https://hermes.pyth.network/v2/updates/price/${publishedAtUnix}?ids%5B%5D=test`,
      retrievedAt: new Date((publishedAtUnix + 2) * 1_000).toISOString(),
      binaryEncoding: "hex",
      binaryUpdateCount: 1,
      slot: publishedAtUnix,
      proofAvailableAt: new Date((publishedAtUnix + 1) * 1_000).toISOString(),
      previousPublishAt: new Date((publishedAtUnix - 1) * 1_000).toISOString(),
    },
  };
}

test("compiles a stable Gold 15 commitment and exact Solana schedule", async () => {
  const first = compileMetalPulseMarket({ startsAtUnix: START, collateralMint: MAINNET_USDC_MINT });
  const second = compileMetalPulseMarket({ startsAtUnix: START, collateralMint: MAINNET_USDC_MINT });
  assert.deepEqual(first, second);
  assert.equal(first.question.roundId, `gold-15m-${START}`);
  assert.equal(first.question.observation.openingAt, new Date(START * 1_000).toISOString());
  assert.equal(first.rules.schedule.tradingClosesAt, new Date((START - METAL_PULSE_ENTRY_FREEZE_SECONDS) * 1_000).toISOString());
  assert.equal(first.onchainSchedule.opensAt, BigInt(START - METAL_PULSE_INTERVAL_SECONDS));
  assert.equal(first.onchainSchedule.resolveAfter, BigInt(START + METAL_PULSE_INTERVAL_SECONDS + METAL_PULSE_RESOLUTION_GRACE_SECONDS));
  assert.match(first.marketId, /^[a-f0-9]{64}$/);

  const packet = await buildMetalPulseCreatePacket({ startsAtUnix: START, admin: signer, collateralMint: MAINNET_USDC_MINT });
  assert.equal(packet.createInstruction.programAddress, SCARCITY_EXCHANGE_PROGRAM_ADDRESS);
  assert.equal(packet.createInstruction.accounts?.[1].role, AccountRole.WRITABLE_SIGNER);
  assert.equal(packet.createInstruction.data?.length, 128);
  const review = serializeMetalPulseInstruction(packet.createInstruction);
  assert.equal(review.dataHex.length, 256);
  assert.equal(review.accounts.length, 10);
});

test("prepares a resolver-signed report from exact Pyth integers", async () => {
  const market = compileMetalPulseMarket({ startsAtUnix: START, collateralMint: MAINNET_USDC_MINT });
  const packet = await buildMetalPulseResolutionPacket({
    market,
    resolver: signer,
    opening: point("100000", -3, START),
    closing: point("10000100", -5, START + METAL_PULSE_INTERVAL_SECONDS),
    generatedAt: new Date(Number(market.onchainSchedule.resolveAfter) * 1_000).toISOString(),
  });
  assert.equal(packet.report.outcome, "yes");
  assert.equal(packet.report.opening?.price, "100000");
  assert.equal(packet.report.closing?.exponent, -5);
  assert.equal(packet.report.evidenceArtifactHashes.length, 1);
  assert.match(packet.resolutionReportHash, /^[a-f0-9]{64}$/);
  assert.equal(packet.resolveInstruction.accounts?.[1].role, AccountRole.READONLY_SIGNER);
  assert.equal(packet.resolveInstruction.data?.length, 41);
});

test("fails closed when a committed Pyth observation is missing", async () => {
  const market = compileMetalPulseMarket({ startsAtUnix: START, collateralMint: MAINNET_USDC_MINT });
  const packet = await buildMetalPulseResolutionPacket({
    market,
    resolver: signer,
    opening: point("100000", -3, START),
    closing: null,
    generatedAt: new Date(Number(market.onchainSchedule.resolveAfter) * 1_000).toISOString(),
  });
  assert.equal(packet.report.outcome, "invalid");
  assert.match(packet.report.invalidReason ?? "", /closing observation/i);
});

test("recurring planner is source-gated, idempotent, and never creates late", async () => {
  const now = new Date((START + 300) * 1_000);
  const active = await planMetalPulseRounds({
    now,
    admin: signer,
    collateralMint: MAINNET_USDC_MINT,
    sourceLatestPublishedAt: now.toISOString(),
    horizonRounds: 3,
  });
  assert.equal(active.readyCount, 1);
  assert.equal(active.plans[0].action, "create-ready");
  assert.equal(active.plans[1].action, "queued");

  const existing = await planMetalPulseRounds({
    now,
    admin: signer,
    collateralMint: MAINNET_USDC_MINT,
    sourceLatestPublishedAt: now.toISOString(),
    horizonRounds: 1,
    existingMarketIds: new Set([active.plans[0].market.marketId]),
  });
  assert.equal(existing.plans[0].action, "exists");

  const stale = await planMetalPulseRounds({
    now,
    admin: signer,
    collateralMint: MAINNET_USDC_MINT,
    sourceLatestPublishedAt: new Date((START - 1_000) * 1_000).toISOString(),
    horizonRounds: 1,
  });
  assert.equal(stale.plans[0].action, "source-paused");
});

test("rejects unaligned rounds and early resolutions", async () => {
  assert.throws(
    () => compileMetalPulseMarket({ startsAtUnix: START + 1, collateralMint: MAINNET_USDC_MINT }),
    /15-minute UTC boundary/,
  );
  const market = compileMetalPulseMarket({ startsAtUnix: START, collateralMint: MAINNET_USDC_MINT });
  await assert.rejects(
    () => buildMetalPulseResolutionPacket({
      market,
      resolver: signer,
      opening: point("100000", -3, START),
      closing: point("100100", -3, START + METAL_PULSE_INTERVAL_SECONDS),
      generatedAt: new Date((START + METAL_PULSE_INTERVAL_SECONDS) * 1_000).toISOString(),
    }),
    /before the committed resolution time/,
  );
});
