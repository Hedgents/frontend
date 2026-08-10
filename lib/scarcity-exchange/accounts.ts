import { getAddressDecoder, type Address } from "@solana/kit";
import idl from "./generated/scarcity_exchange.json";

export type ScarcityMarketStatus = "unresolved" | "resolved-yes" | "resolved-no" | "invalid";
export type ScarcityOrderSide = "bid" | "ask";
export type CurveMarketStatus = "unresolved" | "resolved" | "invalid";

export interface DecodedExchangeConfig {
  version: number;
  bump: number;
  paused: boolean;
  admin: Address;
  resolver: Address;
  collateralMint: Address;
  feeRecipient: Address;
  tradingFeeBps: number;
}

export interface DecodedScarcityMarket {
  version: number;
  bump: number;
  vaultBump: number;
  status: ScarcityMarketStatus;
  config: Address;
  creator: Address;
  resolver: Address;
  collateralMint: Address;
  yesMint: Address;
  noMint: Address;
  vault: Address;
  marketId: string;
  questionHash: string;
  rulesHash: string;
  resolutionReportHash: string;
  opensAt: bigint;
  closesAt: bigint;
  resolveAfter: bigint;
  resolvedAt: bigint;
  openInterest: bigint;
  totalRedeemed: bigint;
}

export interface DecodedLimitOrder {
  version: number;
  bump: number;
  vaultBump: number;
  side: ScarcityOrderSide;
  market: Address;
  maker: Address;
  collateralMint: Address;
  outcomeMint: Address;
  escrowMint: Address;
  vault: Address;
  feeRecipient: Address;
  orderId: string;
  priceMicroUsdc: bigint;
  originalQuantity: bigint;
  remainingQuantity: bigint;
  quoteFilled: bigint;
  feePaid: bigint;
  feeBps: number;
  expiresAt: bigint;
}

export interface DecodedCurveMarket {
  version: number;
  bump: number;
  vaultBump: number;
  status: CurveMarketStatus;
  kernelVersion: number;
  jackpotLeverageCap: number;
  config: Address;
  creator: Address;
  resolver: Address;
  collateralMint: Address;
  vault: Address;
  feeRecipient: Address;
  marketId: string;
  metricHash: string;
  rulesHash: string;
  resolutionReportHash: string;
  opensAt: bigint;
  closesAt: bigint;
  resolveAfter: bigint;
  resolvedAt: bigint;
  normalizedOutcome: number;
  bucketCount: number;
  winningBucket: number;
  jackpotBps: number;
  feeBps: number;
  totalStaked: bigint;
  protocolFee: bigint;
  payoutPool: bigint;
  jackpotPool: bigint;
  curvePool: bigint;
  exactStake: bigint;
  weightedStake: bigint;
  totalClaimed: bigint;
  bucketStakes: readonly bigint[];
}

export interface DecodedCurvePosition {
  version: number;
  bump: number;
  market: Address;
  owner: Address;
  bucket: number;
  claimed: boolean;
  stake: bigint;
  payout: bigint;
}

const addressDecoder = getAddressDecoder();

function discriminator(
  name: "ExchangeConfig" | "ScarcityMarket" | "LimitOrder" | "CurveMarket" | "CurvePosition",
) {
  const account = idl.accounts.find((candidate) => candidate.name === name);
  if (!account) throw new Error(`IDL account ${name} is missing.`);
  return Uint8Array.from(account.discriminator);
}

const CONFIG_DISCRIMINATOR = discriminator("ExchangeConfig");
const MARKET_DISCRIMINATOR = discriminator("ScarcityMarket");
const ORDER_DISCRIMINATOR = discriminator("LimitOrder");
const CURVE_MARKET_DISCRIMINATOR = discriminator("CurveMarket");
const CURVE_POSITION_DISCRIMINATOR = discriminator("CurvePosition");

export const SCARCITY_CONFIG_ACCOUNT_SIZE = 141;
export const SCARCITY_MARKET_ACCOUNT_SIZE = 412;
export const SCARCITY_ORDER_ACCOUNT_SIZE = 318;
export const CURVE_MARKET_ACCOUNT_SIZE = 768;
export const CURVE_POSITION_ACCOUNT_SIZE = 92;
export const SCARCITY_ORDER_MARKET_OFFSET = 12;
export const SCARCITY_ORDER_MAKER_OFFSET = 44;
export const CURVE_POSITION_MARKET_OFFSET = 10;
export const CURVE_POSITION_OWNER_OFFSET = 42;

function assertDiscriminator(data: Uint8Array, expected: Uint8Array, label: string) {
  if (data.length < expected.length || !expected.every((value, index) => data[index] === value)) {
    throw new Error(`${label} discriminator does not match the generated IDL.`);
  }
}

class AccountReader {
  private offset = 8;
  private readonly view: DataView;

  constructor(private readonly data: Uint8Array, minimumLength: number, label: string) {
    if (data.length < minimumLength) throw new Error(`${label} account data is truncated.`);
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  u8() {
    return this.view.getUint8(this.offset++);
  }

  u16() {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u64() {
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  i64() {
    const value = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return value;
  }

  i32() {
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  bytes(length: number) {
    const value = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  pubkey() {
    return addressDecoder.decode(this.bytes(32));
  }

  hex32() {
    return Buffer.from(this.bytes(32)).toString("hex");
  }
}

export function decodeExchangeConfigAccount(data: Uint8Array): DecodedExchangeConfig {
  assertDiscriminator(data, CONFIG_DISCRIMINATOR, "Exchange config");
  const reader = new AccountReader(data, SCARCITY_CONFIG_ACCOUNT_SIZE, "Exchange config");
  return {
    version: reader.u8(),
    bump: reader.u8(),
    paused: reader.u8() !== 0,
    admin: reader.pubkey(),
    resolver: reader.pubkey(),
    collateralMint: reader.pubkey(),
    feeRecipient: reader.pubkey(),
    tradingFeeBps: reader.u16(),
  };
}

export function decodeScarcityMarketAccount(data: Uint8Array): DecodedScarcityMarket {
  assertDiscriminator(data, MARKET_DISCRIMINATOR, "Scarcity market");
  const reader = new AccountReader(data, SCARCITY_MARKET_ACCOUNT_SIZE, "Scarcity market");
  const version = reader.u8();
  const bump = reader.u8();
  const vaultBump = reader.u8();
  const statusCode = reader.u8();
  const statuses: ScarcityMarketStatus[] = ["unresolved", "resolved-yes", "resolved-no", "invalid"];
  const status = statuses[statusCode];
  if (!status) throw new Error("Scarcity market status is not recognized.");
  return {
    version,
    bump,
    vaultBump,
    status,
    config: reader.pubkey(),
    creator: reader.pubkey(),
    resolver: reader.pubkey(),
    collateralMint: reader.pubkey(),
    yesMint: reader.pubkey(),
    noMint: reader.pubkey(),
    vault: reader.pubkey(),
    marketId: reader.hex32(),
    questionHash: reader.hex32(),
    rulesHash: reader.hex32(),
    resolutionReportHash: reader.hex32(),
    opensAt: reader.i64(),
    closesAt: reader.i64(),
    resolveAfter: reader.i64(),
    resolvedAt: reader.i64(),
    openInterest: reader.u64(),
    totalRedeemed: reader.u64(),
  };
}

export function decodeLimitOrderAccount(data: Uint8Array): DecodedLimitOrder {
  assertDiscriminator(data, ORDER_DISCRIMINATOR, "Limit order");
  const reader = new AccountReader(data, SCARCITY_ORDER_ACCOUNT_SIZE, "Limit order");
  const version = reader.u8();
  const bump = reader.u8();
  const vaultBump = reader.u8();
  const sideCode = reader.u8();
  if (sideCode !== 0 && sideCode !== 1) throw new Error("Limit order side is not recognized.");
  return {
    version,
    bump,
    vaultBump,
    side: sideCode === 0 ? "bid" : "ask",
    market: reader.pubkey(),
    maker: reader.pubkey(),
    collateralMint: reader.pubkey(),
    outcomeMint: reader.pubkey(),
    escrowMint: reader.pubkey(),
    vault: reader.pubkey(),
    feeRecipient: reader.pubkey(),
    orderId: reader.hex32(),
    priceMicroUsdc: reader.u64(),
    originalQuantity: reader.u64(),
    remainingQuantity: reader.u64(),
    quoteFilled: reader.u64(),
    feePaid: reader.u64(),
    feeBps: reader.u16(),
    expiresAt: reader.i64(),
  };
}

export function decodeCurveMarketAccount(data: Uint8Array): DecodedCurveMarket {
  assertDiscriminator(data, CURVE_MARKET_DISCRIMINATOR, "Curve market");
  const reader = new AccountReader(data, CURVE_MARKET_ACCOUNT_SIZE, "Curve market");
  const version = reader.u8();
  const bump = reader.u8();
  const vaultBump = reader.u8();
  const statusCode = reader.u8();
  const statuses: CurveMarketStatus[] = ["unresolved", "resolved", "invalid"];
  const status = statuses[statusCode];
  if (!status) throw new Error("Curve market status is not recognized.");
  const kernelVersion = reader.u8();
  const jackpotLeverageCap = reader.u8();
  const config = reader.pubkey();
  const creator = reader.pubkey();
  const resolver = reader.pubkey();
  const collateralMint = reader.pubkey();
  const vault = reader.pubkey();
  const feeRecipient = reader.pubkey();
  const marketId = reader.hex32();
  const metricHash = reader.hex32();
  const rulesHash = reader.hex32();
  const resolutionReportHash = reader.hex32();
  const opensAt = reader.i64();
  const closesAt = reader.i64();
  const resolveAfter = reader.i64();
  const resolvedAt = reader.i64();
  const normalizedOutcome = reader.i32();
  const bucketCount = reader.u8();
  const winningBucket = reader.u8();
  const jackpotBps = reader.u16();
  const feeBps = reader.u16();
  const totalStaked = reader.u64();
  const protocolFee = reader.u64();
  const payoutPool = reader.u64();
  const jackpotPool = reader.u64();
  const curvePool = reader.u64();
  const exactStake = reader.u64();
  const weightedStake = reader.u64();
  const totalClaimed = reader.u64();
  const bucketStakes = Array.from({ length: 41 }, () => reader.u64());
  return {
    version,
    bump,
    vaultBump,
    status,
    kernelVersion,
    jackpotLeverageCap,
    config,
    creator,
    resolver,
    collateralMint,
    vault,
    feeRecipient,
    marketId,
    metricHash,
    rulesHash,
    resolutionReportHash,
    opensAt,
    closesAt,
    resolveAfter,
    resolvedAt,
    normalizedOutcome,
    bucketCount,
    winningBucket,
    jackpotBps,
    feeBps,
    totalStaked,
    protocolFee,
    payoutPool,
    jackpotPool,
    curvePool,
    exactStake,
    weightedStake,
    totalClaimed,
    bucketStakes,
  };
}

export function decodeCurvePositionAccount(data: Uint8Array): DecodedCurvePosition {
  assertDiscriminator(data, CURVE_POSITION_DISCRIMINATOR, "Curve position");
  const reader = new AccountReader(data, CURVE_POSITION_ACCOUNT_SIZE, "Curve position");
  return {
    version: reader.u8(),
    bump: reader.u8(),
    market: reader.pubkey(),
    owner: reader.pubkey(),
    bucket: reader.u8(),
    claimed: reader.u8() !== 0,
    stake: reader.u64(),
    payout: reader.u64(),
  };
}

export function scarcityMarketDiscriminatorBase64() {
  return Buffer.from(MARKET_DISCRIMINATOR).toString("base64");
}

export function limitOrderDiscriminatorBase64() {
  return Buffer.from(ORDER_DISCRIMINATOR).toString("base64");
}

export function curveMarketDiscriminatorBase64() {
  return Buffer.from(CURVE_MARKET_DISCRIMINATOR).toString("base64");
}

export function curvePositionDiscriminatorBase64() {
  return Buffer.from(CURVE_POSITION_DISCRIMINATOR).toString("base64");
}
