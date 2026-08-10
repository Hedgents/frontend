import assert from "node:assert/strict";
import test from "node:test";
import { address } from "@solana/kit";
import {
  publishMetalPulseResolutionEvidence,
  readMetalPulseArtifact,
  readMetalPulseResolution,
  resetMetalPulseEvidenceForTests,
} from "./metal-pulse-evidence-store";
import { METAL_PULSE_INTERVAL_SECONDS, type MetalPulsePricePoint } from "./metal-pulse";
import { GOLD_PYTH_FEED_ID, type MetalPulsePythArtifact } from "./metal-pulse-source";
import { buildMetalPulseResolutionPacket, compileMetalPulseMarket } from "./metal-pulse-market";
import { MAINNET_USDC_MINT } from "./scarcity-exchange";
import { sha256Hex } from "./scarcity-markets/canonical";

const START = 1_800_000_000;
const resolver = address("11111111111111111111111111111111");

function evidence(publishedAtUnix: number, rawPrice: string) {
  const body = JSON.stringify({
    binary: { encoding: "hex", data: [`deadbeef${publishedAtUnix}`] },
    parsed: [{
      id: GOLD_PYTH_FEED_ID,
      price: { price: rawPrice, conf: "100", expo: -3, publish_time: publishedAtUnix },
      metadata: { slot: publishedAtUnix, proof_available_time: publishedAtUnix + 1, prev_publish_time: publishedAtUnix - 1 },
    }],
  });
  const artifactHash = sha256Hex(body);
  const sourceUrl = `https://hermes.pyth.network/v2/updates/price/${publishedAtUnix}?ids%5B%5D=${GOLD_PYTH_FEED_ID}`;
  const retrievedAt = new Date((publishedAtUnix + 2) * 1_000).toISOString();
  const artifact: MetalPulsePythArtifact = {
    schemaVersion: "1.0.0",
    artifactHash,
    contentType: "application/json",
    body,
    sourceUrl,
    retrievedAt,
    requestedPublishTime: publishedAtUnix,
    feedId: GOLD_PYTH_FEED_ID,
    binaryEncoding: "hex",
    binaryUpdateCount: 1,
  };
  const point: MetalPulsePricePoint = {
    priceUsd: Number(rawPrice) / 1_000,
    confidenceUsd: 0.1,
    publishedAt: new Date(publishedAtUnix * 1_000).toISOString(),
    raw: { price: rawPrice, confidence: "100", exponent: -3 },
    evidence: {
      artifactHash,
      sourceUrl,
      retrievedAt,
      binaryEncoding: "hex",
      binaryUpdateCount: 1,
      slot: publishedAtUnix,
      proofAvailableAt: new Date((publishedAtUnix + 1) * 1_000).toISOString(),
      previousPublishAt: new Date((publishedAtUnix - 1) * 1_000).toISOString(),
    },
  };
  return { artifact, point };
}

test("persists exact Pyth bodies before exposing a resolution as signable", async () => {
  resetMetalPulseEvidenceForTests();
  const market = compileMetalPulseMarket({ startsAtUnix: START, collateralMint: MAINNET_USDC_MINT });
  const opening = evidence(START, "100000");
  const closing = evidence(START + METAL_PULSE_INTERVAL_SECONDS, "101000");
  const packet = await buildMetalPulseResolutionPacket({
    market,
    resolver,
    opening: opening.point,
    closing: closing.point,
    generatedAt: new Date(Number(market.onchainSchedule.resolveAfter) * 1_000).toISOString(),
  });
  const published = await publishMetalPulseResolutionEvidence({
    report: packet.report,
    canonicalReport: packet.canonicalReport,
    resolutionReportHash: packet.resolutionReportHash,
    artifacts: [opening.artifact, closing.artifact],
  });
  assert.equal(published.persisted, true);
  assert.equal(published.signable, true);
  assert.equal(published.artifactPaths.length, 2);
  assert.equal(await readMetalPulseArtifact(opening.artifact.artifactHash), opening.artifact.body);
  assert.equal(await readMetalPulseResolution(packet.resolutionReportHash), packet.canonicalReport);
});

test("persists an incomplete invalid report but withholds signability", async () => {
  resetMetalPulseEvidenceForTests();
  const market = compileMetalPulseMarket({ startsAtUnix: START, collateralMint: MAINNET_USDC_MINT });
  const opening = evidence(START, "100000");
  const packet = await buildMetalPulseResolutionPacket({
    market,
    resolver,
    opening: opening.point,
    closing: null,
    generatedAt: new Date(Number(market.onchainSchedule.resolveAfter) * 1_000).toISOString(),
  });
  const published = await publishMetalPulseResolutionEvidence({
    report: packet.report,
    canonicalReport: packet.canonicalReport,
    resolutionReportHash: packet.resolutionReportHash,
    artifacts: [opening.artifact],
  });
  assert.equal(packet.report.outcome, "invalid");
  assert.equal(published.persisted, true);
  assert.equal(published.signable, false);
});

test("rejects an artifact whose body does not match its hash", async () => {
  resetMetalPulseEvidenceForTests();
  const market = compileMetalPulseMarket({ startsAtUnix: START, collateralMint: MAINNET_USDC_MINT });
  const opening = evidence(START, "100000");
  const closing = evidence(START + METAL_PULSE_INTERVAL_SECONDS, "101000");
  const packet = await buildMetalPulseResolutionPacket({
    market,
    resolver,
    opening: opening.point,
    closing: closing.point,
    generatedAt: new Date(Number(market.onchainSchedule.resolveAfter) * 1_000).toISOString(),
  });
  await assert.rejects(() => publishMetalPulseResolutionEvidence({
    report: packet.report,
    canonicalReport: packet.canonicalReport,
    resolutionReportHash: packet.resolutionReportHash,
    artifacts: [{ ...opening.artifact, body: `${opening.artifact.body} ` }, closing.artifact],
  }), /does not match its content hash/);
});

test("rejects committed price fields that are not present in the exact Hermes body", async () => {
  resetMetalPulseEvidenceForTests();
  const market = compileMetalPulseMarket({ startsAtUnix: START, collateralMint: MAINNET_USDC_MINT });
  const opening = evidence(START, "100000");
  const closing = evidence(START + METAL_PULSE_INTERVAL_SECONDS, "101000");
  const packet = await buildMetalPulseResolutionPacket({
    market,
    resolver,
    opening: { ...opening.point, raw: { ...opening.point.raw!, price: "99000" }, priceUsd: 99 },
    closing: closing.point,
    generatedAt: new Date(Number(market.onchainSchedule.resolveAfter) * 1_000).toISOString(),
  });
  await assert.rejects(() => publishMetalPulseResolutionEvidence({
    report: packet.report,
    canonicalReport: packet.canonicalReport,
    resolutionReportHash: packet.resolutionReportHash,
    artifacts: [opening.artifact, closing.artifact],
  }), /committed price does not match its exact artifact/);
});
