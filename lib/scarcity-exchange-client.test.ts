import assert from "node:assert/strict";
import test from "node:test";
import { address, AccountRole } from "@solana/kit";
import {
  deriveCurveMarketAddresses,
  deriveCurvePositionAddress,
  deriveMarketAddresses,
  deriveOrderAddresses,
  getCreateCurveMarketInstruction,
  getCreateMarketInstruction,
  getMintCompleteSetInstruction,
  getOpenCurvePositionInstruction,
  getPlaceOrderInstruction,
  getRecoverCurveMarketInstruction,
  getResolveCurveMarketInstruction,
  SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
} from "./scarcity-exchange";

const signer = address("11111111111111111111111111111111");
const collateralMint = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const marketId = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

test("market PDA derivation is stable and produces distinct accounts", async () => {
  const first = await deriveMarketAddresses(marketId);
  const second = await deriveMarketAddresses(marketId);
  assert.deepEqual(first, second);
  assert.equal(new Set(Object.values(first)).size, 5);
});

test("create-market builder follows the generated Anchor account order", async () => {
  const instruction = await getCreateMarketInstruction({
    admin: signer,
    collateralMint,
    marketId,
    questionHash: new Uint8Array(32).fill(2),
    rulesHash: new Uint8Array(32).fill(3),
    opensAt: 1n,
    closesAt: 2n,
    resolveAfter: 3n,
  });

  assert.equal(instruction.programAddress, SCARCITY_EXCHANGE_PROGRAM_ADDRESS);
  assert.equal(instruction.accounts?.length, 10);
  assert.equal(instruction.accounts?.[1].role, AccountRole.WRITABLE_SIGNER);
  assert.deepEqual(Array.from(instruction.data?.slice(0, 8) ?? []), [
    103, 226, 97, 235, 200, 188, 251, 254,
  ]);
  assert.equal(instruction.data?.length, 128);
});

test("curve PDAs are canonical per market, owner, and bucket", async () => {
  const curve = await deriveCurveMarketAddresses(marketId);
  const [first] = await deriveCurvePositionAddress({ market: curve.market, owner: signer, bucket: 20 });
  const [again] = await deriveCurvePositionAddress({ market: curve.market, owner: signer, bucket: 20 });
  const [adjacent] = await deriveCurvePositionAddress({ market: curve.market, owner: signer, bucket: 21 });

  assert.equal(new Set(Object.values(curve)).size, 3);
  assert.equal(first, again);
  assert.notEqual(first, adjacent);
});

test("curve builders preserve exact Anchor account and scalar encoding", async () => {
  const create = await getCreateCurveMarketInstruction({
    admin: signer,
    collateralMint,
    feeRecipient: signer,
    marketId,
    metricHash: new Uint8Array(32).fill(2),
    rulesHash: new Uint8Array(32).fill(3),
    opensAt: 1n,
    closesAt: 2n,
    resolveAfter: 3n,
    bucketCount: 41,
    jackpotBps: 2_000,
  });
  const open = await getOpenCurvePositionInstruction({
    owner: signer,
    collateralMint,
    ownerCollateral: signer,
    marketId,
    bucket: 20,
    amount: 1_000_000n,
  });
  const resolve = await getResolveCurveMarketInstruction({
    resolver: signer,
    collateralMint,
    feeRecipient: signer,
    marketId,
    normalizedOutcome: -250_000,
    resolutionReportHash: new Uint8Array(32).fill(4),
  });
  const recover = await getRecoverCurveMarketInstruction({
    admin: signer,
    marketId,
    resolutionReportHash: new Uint8Array(32).fill(5),
  });

  assert.equal(create.accounts?.length, 9);
  assert.equal(create.accounts?.[1].role, AccountRole.WRITABLE_SIGNER);
  assert.equal(create.data?.length, 131);
  assert.equal(open.accounts?.length, 9);
  assert.equal(open.data?.length, 17);
  assert.equal(resolve.accounts?.length, 7);
  assert.equal(resolve.data?.length, 44);
  assert.deepEqual(Array.from(resolve.data?.slice(8, 12) ?? []), [112, 47, 252, 255]);
  assert.equal(recover.accounts?.length, 4);
  assert.equal(recover.accounts?.[1].role, AccountRole.READONLY_SIGNER);
  assert.equal(recover.data?.length, 40);
});

test("curve builders reject economics outside program bounds", async () => {
  await assert.rejects(
    () => getCreateCurveMarketInstruction({
      admin: signer,
      collateralMint,
      feeRecipient: signer,
      marketId,
      metricHash: new Uint8Array(32).fill(2),
      rulesHash: new Uint8Array(32).fill(3),
      opensAt: 1n,
      closesAt: 2n,
      resolveAfter: 3n,
      bucketCount: 40,
      jackpotBps: 2_000,
    }),
    /odd integer/,
  );
  await assert.rejects(
    () => getResolveCurveMarketInstruction({
      resolver: signer,
      collateralMint,
      feeRecipient: signer,
      marketId,
      normalizedOutcome: 1_000_001,
      resolutionReportHash: new Uint8Array(32).fill(4),
    }),
    /Normalized curve outcome/,
  );
});

test("complete-set builder rejects amounts outside u64", async () => {
  await assert.rejects(
    () =>
      getMintCompleteSetInstruction({
        owner: signer,
        collateralMint,
        marketId,
        ownerCollateral: signer,
        ownerYes: signer,
        ownerNo: signer,
        amount: -1n,
      }),
    /u64/,
  );
});

test("escrow order builder derives protocol-owned order accounts", async () => {
  const market = await deriveMarketAddresses(marketId);
  const orderId = new Uint8Array(32).fill(7);
  const derived = await deriveOrderAddresses({ market: market.market, maker: signer, orderId });
  const instruction = await getPlaceOrderInstruction({
    maker: signer,
    collateralMint,
    feeRecipient: signer,
    marketId,
    orderId,
    outcomeMint: market.yesMint,
    makerSource: signer,
    side: "ask",
    priceMicroUsdc: 640_000n,
    quantity: 1_000_000n,
    expiresAt: 1_800_000_000n,
  });

  assert.notEqual(derived.order, derived.vault);
  assert.equal(instruction.accounts?.length, 13);
  assert.deepEqual(Array.from(instruction.data?.slice(0, 8) ?? []), [
    51, 194, 155, 175, 109, 130, 96, 106,
  ]);
  assert.equal(instruction.data?.length, 65);
});
