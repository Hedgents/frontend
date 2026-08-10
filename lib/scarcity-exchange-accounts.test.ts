import assert from "node:assert/strict";
import test from "node:test";
import { address, getAddressEncoder, type Address } from "@solana/kit";
import idl from "./scarcity-exchange/generated/scarcity_exchange.json";
import {
  CURVE_MARKET_ACCOUNT_SIZE,
  CURVE_POSITION_ACCOUNT_SIZE,
  decodeCurveMarketAccount,
  decodeCurvePositionAccount,
  decodeExchangeConfigAccount,
  decodeLimitOrderAccount,
  decodeScarcityMarketAccount,
  SCARCITY_CONFIG_ACCOUNT_SIZE,
  SCARCITY_MARKET_ACCOUNT_SIZE,
  SCARCITY_ORDER_ACCOUNT_SIZE,
} from "./scarcity-exchange";

const addressEncoder = getAddressEncoder();
const firstAddress = address("11111111111111111111111111111111");
const secondAddress = address("SysvarRent111111111111111111111111111111111");

function discriminator(
  name: "ExchangeConfig" | "ScarcityMarket" | "LimitOrder" | "CurveMarket" | "CurvePosition",
) {
  const account = idl.accounts.find((candidate) => candidate.name === name);
  assert(account);
  return Uint8Array.from(account.discriminator);
}

class Writer {
  offset = 8;
  view: DataView;
  constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer); }
  u8(value: number) { this.view.setUint8(this.offset++, value); }
  u16(value: number) { this.view.setUint16(this.offset, value, true); this.offset += 2; }
  u64(value: bigint) { this.view.setBigUint64(this.offset, value, true); this.offset += 8; }
  i64(value: bigint) { this.view.setBigInt64(this.offset, value, true); this.offset += 8; }
  i32(value: number) { this.view.setInt32(this.offset, value, true); this.offset += 4; }
  raw(value: ArrayLike<number>) { this.bytes.set(Uint8Array.from(value), this.offset); this.offset += value.length; }
  pubkey(value: Address) { this.raw(addressEncoder.encode(value)); }
}

test("decodes the protocol configuration at exact Anchor offsets", () => {
  const bytes = new Uint8Array(SCARCITY_CONFIG_ACCOUNT_SIZE);
  bytes.set(discriminator("ExchangeConfig"));
  const writer = new Writer(bytes);
  writer.u8(1); writer.u8(9); writer.u8(1);
  writer.pubkey(firstAddress);
  writer.pubkey(secondAddress);
  writer.pubkey(firstAddress);
  writer.pubkey(secondAddress);
  writer.u16(25);
  const config = decodeExchangeConfigAccount(bytes);
  assert.equal(config.version, 1);
  assert.equal(config.bump, 9);
  assert.equal(config.paused, true);
  assert.equal(config.admin, firstAddress);
  assert.equal(config.resolver, secondAddress);
  assert.equal(config.tradingFeeBps, 25);
});

test("decodes a scarcity market account with exact Anchor offsets", () => {
  const bytes = new Uint8Array(SCARCITY_MARKET_ACCOUNT_SIZE);
  bytes.set(discriminator("ScarcityMarket"));
  const writer = new Writer(bytes);
  writer.u8(1); writer.u8(7); writer.u8(8); writer.u8(1);
  for (let index = 0; index < 7; index++) writer.pubkey(index % 2 ? secondAddress : firstAddress);
  writer.raw(new Uint8Array(32).fill(1));
  writer.raw(new Uint8Array(32).fill(2));
  writer.raw(new Uint8Array(32).fill(3));
  writer.raw(new Uint8Array(32).fill(4));
  writer.i64(10n); writer.i64(20n); writer.i64(30n); writer.i64(40n);
  writer.u64(50n); writer.u64(6n);

  const market = decodeScarcityMarketAccount(bytes);
  assert.equal(market.status, "resolved-yes");
  assert.equal(market.creator, secondAddress);
  assert.equal(market.resolver, firstAddress);
  assert.equal(market.marketId, "01".repeat(32));
  assert.equal(market.questionHash, "02".repeat(32));
  assert.equal(market.openInterest, 50n);
  assert.equal(market.totalRedeemed, 6n);
});

test("decodes escrow limit orders and rejects the wrong discriminator", () => {
  const bytes = new Uint8Array(SCARCITY_ORDER_ACCOUNT_SIZE);
  bytes.set(discriminator("LimitOrder"));
  const writer = new Writer(bytes);
  writer.u8(1); writer.u8(2); writer.u8(3); writer.u8(1);
  for (let index = 0; index < 7; index++) writer.pubkey(index % 2 ? secondAddress : firstAddress);
  writer.raw(new Uint8Array(32).fill(9));
  writer.u64(650_000n); writer.u64(1_000_000n); writer.u64(250_000n);
  writer.u64(487_500n); writer.u64(1_219n); writer.u16(25); writer.i64(1_900_000_000n);

  const order = decodeLimitOrderAccount(bytes);
  assert.equal(order.side, "ask");
  assert.equal(order.market, firstAddress);
  assert.equal(order.maker, secondAddress);
  assert.equal(order.remainingQuantity, 250_000n);
  assert.equal(order.feeBps, 25);
  assert.throws(() => decodeLimitOrderAccount(new Uint8Array(SCARCITY_ORDER_ACCOUNT_SIZE)), /discriminator/);
});

test("decodes curve market economics and every fixed bucket", () => {
  const bytes = new Uint8Array(CURVE_MARKET_ACCOUNT_SIZE);
  bytes.set(discriminator("CurveMarket"));
  const writer = new Writer(bytes);
  writer.u8(1); writer.u8(7); writer.u8(8); writer.u8(1); writer.u8(1); writer.u8(10);
  for (let index = 0; index < 6; index++) writer.pubkey(index % 2 ? secondAddress : firstAddress);
  writer.raw(new Uint8Array(32).fill(1));
  writer.raw(new Uint8Array(32).fill(2));
  writer.raw(new Uint8Array(32).fill(3));
  writer.raw(new Uint8Array(32).fill(4));
  writer.i64(10n); writer.i64(20n); writer.i64(30n); writer.i64(40n);
  writer.i32(-250_000); writer.u8(41); writer.u8(15); writer.u16(2_000); writer.u16(25);
  writer.u64(3_000_000n); writer.u64(7_500n); writer.u64(2_992_500n);
  writer.u64(598_500n); writer.u64(2_394_000n); writer.u64(1_000_000n);
  writer.u64(102_000_000n); writer.u64(1_234_567n);
  for (let bucket = 0; bucket < 41; bucket++) writer.u64(BigInt(bucket * 1_000));

  const market = decodeCurveMarketAccount(bytes);
  assert.equal(writer.offset, CURVE_MARKET_ACCOUNT_SIZE);
  assert.equal(market.status, "resolved");
  assert.equal(market.kernelVersion, 1);
  assert.equal(market.jackpotLeverageCap, 10);
  assert.equal(market.normalizedOutcome, -250_000);
  assert.equal(market.winningBucket, 15);
  assert.equal(market.jackpotBps, 2_000);
  assert.equal(market.weightedStake, 102_000_000n);
  assert.equal(market.bucketStakes.length, 41);
  assert.equal(market.bucketStakes[40], 40_000n);
});

test("decodes canonical owner curve positions at stable offsets", () => {
  const bytes = new Uint8Array(CURVE_POSITION_ACCOUNT_SIZE);
  bytes.set(discriminator("CurvePosition"));
  const writer = new Writer(bytes);
  writer.u8(1); writer.u8(9);
  writer.pubkey(firstAddress); writer.pubkey(secondAddress);
  writer.u8(20); writer.u8(1); writer.u64(750_000n); writer.u64(900_000n);

  const position = decodeCurvePositionAccount(bytes);
  assert.equal(writer.offset, CURVE_POSITION_ACCOUNT_SIZE);
  assert.equal(position.market, firstAddress);
  assert.equal(position.owner, secondAddress);
  assert.equal(position.bucket, 20);
  assert.equal(position.claimed, true);
  assert.equal(position.stake, 750_000n);
  assert.equal(position.payout, 900_000n);
});
