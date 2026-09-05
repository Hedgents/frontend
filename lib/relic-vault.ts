export const GENESIS_PULL_PRICE_USD = 35;
export const GENESIS_BATCH_SIZE = 100;

const UINT32_RANGE = 0x1_0000_0000;

export type RandomUint32Source = (values: Uint32Array) => Uint32Array;

/**
 * Selects an index without the modulo bias produced by `uint32 % upperBound`.
 * This powers only the disabled design preview; production outcomes must come
 * from the campaign's authenticated on-chain randomness integration.
 */
export function secureRandomIndex(
  upperBound: number,
  randomSource: RandomUint32Source = (values) => globalThis.crypto.getRandomValues(values),
) {
  if (!Number.isSafeInteger(upperBound) || upperBound <= 0 || upperBound > UINT32_RANGE) {
    throw new RangeError(`Upper bound must be an integer from 1 to ${UINT32_RANGE}.`);
  }

  const rejectionLimit = UINT32_RANGE - (UINT32_RANGE % upperBound);
  const values = new Uint32Array(1);

  do {
    randomSource(values);
  } while (values[0] >= rejectionLimit);

  return values[0] % upperBound;
}

export type RelicTierId = "ring" | "bracelet" | "necklace" | "egg" | "crown";

export interface RelicTier {
  id: RelicTierId;
  rarity: "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary";
  name: string;
  count: number;
  redemptionUsd: number;
  image: string;
  description: string;
}

export interface GenesisPullResult {
  ticketIndex: number;
  edition: number;
  tier: RelicTier;
  image: string;
}

export const GENESIS_RELIC_TIERS: readonly RelicTier[] = [
  {
    id: "ring",
    rarity: "Common",
    name: "Gold Signet",
    count: 55,
    redemptionUsd: 15,
    image: "/assets/relics/genesis/common-gold-signet.png",
    description: "A restrained signet cut with the first Hedgents assay mark.",
  },
  {
    id: "bracelet",
    rarity: "Uncommon",
    name: "Orbit Bracelet",
    count: 25,
    redemptionUsd: 24,
    image: "/assets/relics/genesis/uncommon-orbit-bracelet.png",
    description: "Linked gold arcs arranged around a dark mineral clasp.",
  },
  {
    id: "necklace",
    rarity: "Rare",
    name: "Royal Torque",
    count: 14,
    redemptionUsd: 45,
    image: "/assets/relics/genesis/rare-royal-torque.png",
    description: "A ceremonial collar with a suspended elemental seal.",
  },
  {
    id: "egg",
    rarity: "Epic",
    name: "Imperial Ovoid",
    count: 5,
    redemptionUsd: 110,
    image: "/assets/relics/genesis/epic-imperial-ovoid.png",
    description: "A mechanical reliquary of gold lattice and enamel shadow.",
  },
  {
    id: "crown",
    rarity: "Legendary",
    name: "Crown Jewel",
    count: 1,
    redemptionUsd: 370,
    image: "/assets/relics/genesis/legendary-crown-jewel.png",
    description: "The singular sovereign relic of the Genesis assay.",
  },
] as const;

export interface GenesisEconomy {
  batchBackingUsd: number;
  batchRevenueUsd: number;
  expectedBackingUsd: number;
  grossMarginUsd: number;
  returnToPlayerPct: number;
}

export function genesisEconomy(): GenesisEconomy {
  const batchBackingUsd = GENESIS_RELIC_TIERS.reduce(
    (total, tier) => total + tier.count * tier.redemptionUsd,
    0,
  );
  const batchRevenueUsd = GENESIS_BATCH_SIZE * GENESIS_PULL_PRICE_USD;
  return {
    batchBackingUsd,
    batchRevenueUsd,
    expectedBackingUsd: batchBackingUsd / GENESIS_BATCH_SIZE,
    grossMarginUsd: batchRevenueUsd - batchBackingUsd,
    returnToPlayerPct: (batchBackingUsd / batchRevenueUsd) * 100,
  };
}

export function relicTierForTicket(ticketIndex: number): RelicTier {
  if (!Number.isInteger(ticketIndex) || ticketIndex < 0 || ticketIndex >= GENESIS_BATCH_SIZE) {
    throw new RangeError(`Ticket index must be an integer from 0 to ${GENESIS_BATCH_SIZE - 1}.`);
  }

  let boundary = 0;
  for (const tier of GENESIS_RELIC_TIERS) {
    boundary += tier.count;
    if (ticketIndex < boundary) return tier;
  }
  throw new Error("Genesis deck is incomplete.");
}

export function genesisPullForTicket(ticketIndex: number): GenesisPullResult {
  const tier = relicTierForTicket(ticketIndex);
  const edition = ticketIndex + 1;
  const artefactSlug = tier.name.toLowerCase().replaceAll(" ", "-");
  return {
    ticketIndex,
    edition,
    tier,
    image: `/assets/relics/genesis-v2/final/${String(edition).padStart(3, "0")}-${tier.rarity.toLowerCase()}-${artefactSlug}.webp`,
  };
}

export function paxgForRedemption(redemptionUsd: number, paxgUsd: number) {
  if (!Number.isFinite(redemptionUsd) || redemptionUsd <= 0) {
    throw new RangeError("Redemption value must be positive.");
  }
  if (!Number.isFinite(paxgUsd) || paxgUsd <= 0) {
    throw new RangeError("PAXG price must be positive.");
  }
  return redemptionUsd / paxgUsd;
}

export function tierOddsPct(tier: RelicTier) {
  return Number(((tier.count / GENESIS_BATCH_SIZE) * 100).toFixed(2));
}
