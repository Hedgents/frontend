import assert from "node:assert/strict";
import test from "node:test";
import {
  GENESIS_BATCH_SIZE,
  GENESIS_PULL_PRICE_USD,
  GENESIS_RELIC_TIERS,
  genesisPullForTicket,
  genesisEconomy,
  paxgForRedemption,
  relicTierForTicket,
  secureRandomIndex,
  tierOddsPct,
} from "./relic-vault";

test("genesis deck has exactly one hundred tickets and complete odds", () => {
  assert.equal(
    GENESIS_RELIC_TIERS.reduce((total, tier) => total + tier.count, 0),
    GENESIS_BATCH_SIZE,
  );
  assert.equal(
    GENESIS_RELIC_TIERS.reduce((total, tier) => total + tierOddsPct(tier), 0),
    100,
  );
});

test("genesis economics match the disclosed fixed-deck liabilities", () => {
  assert.deepEqual(genesisEconomy(), {
    batchBackingUsd: 2_975,
    batchRevenueUsd: 3_500,
    expectedBackingUsd: 29.75,
    grossMarginUsd: 525,
    returnToPlayerPct: 85,
  });
  assert.equal(GENESIS_PULL_PRICE_USD, 35);
});

test("every fixed-deck ticket resolves into the disclosed tier counts", () => {
  const counts = new Map<string, number>();
  for (let ticket = 0; ticket < GENESIS_BATCH_SIZE; ticket += 1) {
    const tier = relicTierForTicket(ticket);
    counts.set(tier.id, (counts.get(tier.id) ?? 0) + 1);
  }
  for (const tier of GENESIS_RELIC_TIERS) assert.equal(counts.get(tier.id), tier.count);
  assert.throws(() => relicTierForTicket(-1), RangeError);
  assert.throws(() => relicTierForTicket(GENESIS_BATCH_SIZE), RangeError);
});

test("every ticket resolves to its exact production-edition artwork", () => {
  assert.deepEqual(
    [0, 54, 55, 80, 94, 99].map((ticket) => genesisPullForTicket(ticket).image),
    [
      "/assets/relics/genesis-v2/final/001-common-gold-signet.webp",
      "/assets/relics/genesis-v2/final/055-common-gold-signet.webp",
      "/assets/relics/genesis-v2/final/056-uncommon-orbit-bracelet.webp",
      "/assets/relics/genesis-v2/final/081-rare-royal-torque.webp",
      "/assets/relics/genesis-v2/final/095-epic-imperial-ovoid.webp",
      "/assets/relics/genesis-v2/final/100-legendary-crown-jewel.webp",
    ],
  );
});

test("redemption dollars convert into exact PAXG units at funding time", () => {
  assert.equal(paxgForRedemption(45, 4_500), 0.01);
  assert.throws(() => paxgForRedemption(45, 0), RangeError);
});

test("preview randomness rejects the biased uint32 tail before selecting an index", () => {
  const samples = [0xffff_ffff, 42];
  let reads = 0;
  const index = secureRandomIndex(GENESIS_BATCH_SIZE, (values) => {
    values[0] = samples[reads];
    reads += 1;
    return values;
  });

  assert.equal(index, 42);
  assert.equal(reads, 2);
});

test("preview randomness validates bounds and can reach both edges", () => {
  assert.equal(secureRandomIndex(1, (values) => {
    values[0] = 0xffff_ffff;
    return values;
  }), 0);
  assert.equal(secureRandomIndex(GENESIS_BATCH_SIZE, (values) => {
    values[0] = 99;
    return values;
  }), 99);
  assert.throws(() => secureRandomIndex(0), RangeError);
  assert.throws(() => secureRandomIndex(1.5), RangeError);
});
