import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";
import idl from "./generated/scarcity_exchange.json";

export const SCARCITY_EXCHANGE_PROGRAM_ADDRESS = address(idl.address);
export const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");
export const TOKEN_PROGRAM_ADDRESS = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const RENT_SYSVAR_ADDRESS = address("SysvarRent111111111111111111111111111111111");
export const UPGRADEABLE_LOADER_PROGRAM_ADDRESS = address("BPFLoaderUpgradeab1e11111111111111111111111");
export const MAINNET_USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const addressEncoder = getAddressEncoder();

export type ScarcityMarketAddresses = {
  config: Address;
  market: Address;
  yesMint: Address;
  noMint: Address;
  vault: Address;
};

export type ScarcityOrderAddresses = {
  order: Address;
  vault: Address;
};

export type CurveMarketAddresses = {
  config: Address;
  market: Address;
  vault: Address;
};

export async function deriveConfigAddress() {
  return getProgramDerivedAddress({
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    seeds: ["config"],
  });
}

export async function deriveProgramDataAddress() {
  return getProgramDerivedAddress({
    programAddress: UPGRADEABLE_LOADER_PROGRAM_ADDRESS,
    seeds: [addressEncoder.encode(SCARCITY_EXCHANGE_PROGRAM_ADDRESS)],
  });
}

export async function deriveMarketAddress(marketId: Uint8Array) {
  assertBytes32(marketId, "market ID");
  return getProgramDerivedAddress({
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    seeds: ["market", marketId],
  });
}

export async function deriveMarketAddresses(marketId: Uint8Array): Promise<ScarcityMarketAddresses> {
  const [config] = await deriveConfigAddress();
  const [market] = await deriveMarketAddress(marketId);
  const [yesMint] = await getProgramDerivedAddress({
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    seeds: ["yes_mint", addressEncoder.encode(market)],
  });
  const [noMint] = await getProgramDerivedAddress({
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    seeds: ["no_mint", addressEncoder.encode(market)],
  });
  const [vault] = await getProgramDerivedAddress({
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    seeds: ["vault", addressEncoder.encode(market)],
  });

  return { config, market, yesMint, noMint, vault };
}

export async function deriveCurveMarketAddress(marketId: Uint8Array) {
  assertBytes32(marketId, "curve market ID");
  return getProgramDerivedAddress({
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    seeds: ["curve_market", marketId],
  });
}

export async function deriveCurveMarketAddresses(
  marketId: Uint8Array,
): Promise<CurveMarketAddresses> {
  const [config] = await deriveConfigAddress();
  const [market] = await deriveCurveMarketAddress(marketId);
  const [vault] = await getProgramDerivedAddress({
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    seeds: ["curve_vault", addressEncoder.encode(market)],
  });
  return { config, market, vault };
}

export async function deriveCurvePositionAddress(input: {
  market: Address;
  owner: Address;
  bucket: number;
}) {
  assertU8(input.bucket, "curve bucket");
  return getProgramDerivedAddress({
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    seeds: [
      "curve_position",
      addressEncoder.encode(input.market),
      addressEncoder.encode(input.owner),
      Uint8Array.of(input.bucket),
    ],
  });
}

export async function deriveAssociatedTokenAddress(owner: Address, mint: Address) {
  return getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      addressEncoder.encode(owner),
      addressEncoder.encode(TOKEN_PROGRAM_ADDRESS),
      addressEncoder.encode(mint),
    ],
  });
}

export async function deriveOrderAddresses(input: {
  market: Address;
  maker: Address;
  orderId: Uint8Array;
}): Promise<ScarcityOrderAddresses> {
  assertBytes32(input.orderId, "order ID");
  const [order] = await getProgramDerivedAddress({
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    seeds: [
      "order",
      addressEncoder.encode(input.market),
      addressEncoder.encode(input.maker),
      input.orderId,
    ],
  });
  const [vault] = await getProgramDerivedAddress({
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    seeds: ["order_vault", addressEncoder.encode(order)],
  });
  return { order, vault };
}

export function assertBytes32(value: Uint8Array, label: string): asserts value is Uint8Array {
  if (value.length !== 32) {
    throw new Error(`${label} must contain exactly 32 bytes.`);
  }
}

function assertU8(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`${label} must be an unsigned 8-bit integer.`);
  }
}

/**
 * Decode a 32-byte hexadecimal id.
 *
 * The canonicalisation module has a copy of this, but it imports `node:crypto` and so cannot be
 * pulled into a browser bundle. Market ids and order ids are needed on both sides of the wire, so
 * the decoder lives here with the rest of the client-safe address plumbing.
 */
export function hexToBytes(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("Expected a 32-byte hexadecimal value.");
  return Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}
