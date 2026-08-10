import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import {
  decodeCurveMarketAccount,
  decodeCurvePositionAccount,
  deriveAssociatedTokenAddress,
  deriveCurveMarketAddresses,
  deriveCurvePositionAddress,
  deriveMarketAddresses,
  deriveOrderAddresses,
  getAddCurveStakeInstruction,
  getCancelOrderInstruction,
  getClaimCurvePositionInstruction,
  getCreateCurveMarketInstruction,
  getCreateMarketInstruction,
  getFillAskInstruction,
  getFillBidInstruction,
  getInitializeConfigInstruction,
  getInvalidateCurveMarketInstruction,
  getMergeCompleteSetInstruction,
  getMintCompleteSetInstruction,
  getOpenCurvePositionInstruction,
  getPlaceOrderInstruction,
  getRedeemInstruction,
  getRecoverCurveMarketInstruction,
  getResolveCurveMarketInstruction,
  getResolveMarketInstruction,
  getSetResolverInstruction,
  getWithdrawCurveStakeInstruction,
} from "@/lib/scarcity-exchange";
import { pulseRoundStart, METAL_PULSE_INTERVAL_SECONDS } from "@/lib/metal-pulse";
import { buildMetalPulseCreatePacket } from "@/lib/metal-pulse-market";

const rpcUrl = required("SCARCITY_RPC_URL");
const wsUrl = required("SCARCITY_WS_URL");
const adminKeypairPath = required("SCARCITY_ADMIN_KEYPAIR");
const takerKeypairPath = required("SCARCITY_TAKER_KEYPAIR");
const collateralMint = address(required("SCARCITY_COLLATERAL_MINT"));
const feeRecipient = address(required("SCARCITY_FEE_ACCOUNT"));
const splToken = process.env.SPL_TOKEN_BIN ?? "spl-token";

const rpc = createSolanaRpc(rpcUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function loadSigner(path: string) {
  const bytes = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]);
  return createKeyPairSignerFromBytes(bytes);
}

function hash32(label: string) {
  return Uint8Array.from(createHash("sha256").update(label, "utf8").digest());
}

function runSpl(args: string[]) {
  return execFileSync(splToken, [...args, "--url", rpcUrl], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function createTokenAccount(owner: KeyPairSigner, mint: Address, feePayerPath: string) {
  const [tokenAccount] = await deriveAssociatedTokenAddress(owner.address, mint);
  runSpl([
    "create-account",
    String(mint),
    "--owner",
    String(owner.address),
    "--fee-payer",
    feePayerPath,
  ]);
  return tokenAccount;
}

async function tokenBalance(tokenAccount: Address) {
  const response = await rpc.getTokenAccountBalance(tokenAccount, { commitment: "confirmed" }).send();
  return BigInt(response.value.amount);
}

async function accountExists(accountAddress: Address) {
  const response = await rpc.getAccountInfo(accountAddress, { encoding: "base64", commitment: "confirmed" }).send();
  return response.value !== null;
}

async function accountData(accountAddress: Address) {
  const response = await rpc.getAccountInfo(accountAddress, {
    encoding: "base64",
    commitment: "confirmed",
  }).send();
  assert(response.value, `Account ${accountAddress} does not exist.`);
  const encoded = response.value.data;
  assert(Array.isArray(encoded) && encoded[1] === "base64", "RPC account encoding is not base64.");
  return Uint8Array.from(Buffer.from(encoded[0], "base64"));
}

async function submit(signer: KeyPairSigner, instruction: Instruction, label: string) {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (current) => setTransactionMessageFeePayerSigner(signer, current),
    (current) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, current),
    (current) => appendTransactionMessageInstruction(instruction, current),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  await sendAndConfirm(
    transaction as Parameters<typeof sendAndConfirm>[0],
    { commitment: "confirmed", skipPreflight: false },
  );
  const signature = getSignatureFromTransaction(transaction);
  process.stdout.write(`ok ${label} ${signature}\n`);
  return signature;
}

async function expectSubmitFailure(signer: KeyPairSigner, instruction: Instruction, label: string) {
  try {
    await submit(signer, instruction, label);
  } catch {
    process.stdout.write(`ok rejected ${label}\n`);
    return;
  }
  assert.fail(`${label} unexpectedly succeeded.`);
}

function withAccount(instruction: Instruction, index: number, accountAddress: Address): Instruction {
  const accounts = [...(instruction.accounts ?? [])];
  const current = accounts[index];
  assert(current, `Instruction account ${index} does not exist.`);
  accounts[index] = { ...current, address: accountAddress };
  return { ...instruction, accounts };
}

async function createOutcomeAccounts(
  marketId: Uint8Array,
  admin: KeyPairSigner,
  taker: KeyPairSigner,
  includeTaker: boolean,
) {
  const market = await deriveMarketAddresses(marketId);
  const adminYes = await createTokenAccount(admin, market.yesMint, adminKeypairPath);
  const adminNo = await createTokenAccount(admin, market.noMint, adminKeypairPath);
  const takerYes = includeTaker
    ? await createTokenAccount(taker, market.yesMint, takerKeypairPath)
    : null;
  const takerNo = includeTaker
    ? await createTokenAccount(taker, market.noMint, takerKeypairPath)
    : null;
  return { market, adminYes, adminNo, takerYes, takerNo };
}

async function waitUntil(unixSeconds: number) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const slot = await rpc.getSlot({ commitment: "confirmed" }).send();
    const chainTime = await rpc.getBlockTime(slot).send();
    if (chainTime !== null && Number(chainTime) >= unixSeconds) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Local validator time did not reach the resolution timestamp.");
}

async function main() {
  const admin = await loadSigner(adminKeypairPath);
  const taker = await loadSigner(takerKeypairPath);
  const adminUsdc = await createTokenAccount(admin, collateralMint, adminKeypairPath);
  const takerUsdc = await createTokenAccount(taker, collateralMint, takerKeypairPath);
  runSpl(["mint", String(collateralMint), "200", String(adminUsdc), "--mint-authority", adminKeypairPath]);
  runSpl(["mint", String(collateralMint), "100", String(takerUsdc), "--mint-authority", adminKeypairPath]);

  await expectSubmitFailure(taker, await getInitializeConfigInstruction({
    admin: taker.address,
    resolver: taker.address,
    collateralMint,
    feeRecipient,
    tradingFeeBps: 25,
  }), "unauthorized first initializer");

  await submit(admin, await getInitializeConfigInstruction({
    admin: admin.address,
    resolver: admin.address,
    collateralMint,
    feeRecipient,
    tradingFeeBps: 25,
  }), "initialize config");
  await expectSubmitFailure(taker, await getSetResolverInstruction({
    admin: taker.address,
    resolver: taker.address,
  }), "unauthorized resolver rotation");

  const now = Math.floor(Date.now() / 1_000);
  const pulseStart = pulseRoundStart(now) + METAL_PULSE_INTERVAL_SECONDS;
  const pulsePacket = await buildMetalPulseCreatePacket({
    startsAtUnix: pulseStart,
    admin: admin.address,
    collateralMint,
  });
  const tradingMarketId = hash32("hedgents-local-trading-market-v1");
  const yesMarketId = hash32("hedgents-local-yes-resolution-v1");
  const invalidMarketId = hash32("hedgents-local-invalid-resolution-v1");
  const curveMarketId = hash32("hedgents-local-curve-market-v1");
  const invalidCurveMarketId = hash32("hedgents-local-invalid-curve-market-v1");
  const noExactCurveMarketId = hash32("hedgents-local-no-exact-curve-market-v1");
  const recoveryCurveMarketId = hash32("hedgents-local-recovery-curve-market-v1");
  const questionHash = hash32("local-question");
  const rulesHash = hash32("local-rules");
  const resolutionAt = now + 24;

  await submit(admin, pulsePacket.createInstruction, "create canonical Gold 15 market");
  assert.equal(await accountExists(pulsePacket.addresses.market), true);

  await submit(admin, await getCreateMarketInstruction({
    admin: admin.address,
    collateralMint,
    marketId: tradingMarketId,
    questionHash,
    rulesHash,
    opensAt: BigInt(now - 30),
    closesAt: BigInt(now + 600),
    resolveAfter: BigInt(now + 600),
  }), "create trading market");
  for (const [label, marketId] of [["yes", yesMarketId], ["invalid", invalidMarketId]] as const) {
    await submit(admin, await getCreateMarketInstruction({
      admin: admin.address,
      collateralMint,
      marketId,
      questionHash: hash32(`${label}-question`),
      rulesHash: hash32(`${label}-rules`),
      opensAt: BigInt(now - 30),
      closesAt: BigInt(resolutionAt),
      resolveAfter: BigInt(resolutionAt),
    }), `create ${label} resolution market`);
  }
  await expectSubmitFailure(taker, await getCreateCurveMarketInstruction({
    admin: taker.address,
    collateralMint,
    feeRecipient,
    marketId: curveMarketId,
    metricHash: hash32("local-curve-metric"),
    rulesHash: hash32("local-curve-rules"),
    opensAt: BigInt(now - 30),
    closesAt: BigInt(resolutionAt),
    resolveAfter: BigInt(resolutionAt),
    bucketCount: 41,
    jackpotBps: 2_000,
  }), "unauthorized curve market creation");
  for (const [label, marketId] of [
    ["resolved", curveMarketId],
    ["invalid", invalidCurveMarketId],
    ["no-exact", noExactCurveMarketId],
  ] as const) {
    await submit(admin, await getCreateCurveMarketInstruction({
      admin: admin.address,
      collateralMint,
      feeRecipient,
      marketId,
      metricHash: hash32(`${label}-curve-metric`),
      rulesHash: hash32(`${label}-curve-rules`),
      opensAt: BigInt(now - 30),
      closesAt: BigInt(resolutionAt),
      resolveAfter: BigInt(resolutionAt),
      bucketCount: 41,
      jackpotBps: 2_000,
    }), `create ${label} curve market`);
  }
  await submit(admin, await getCreateCurveMarketInstruction({
    admin: admin.address,
    collateralMint,
    feeRecipient,
    marketId: recoveryCurveMarketId,
    metricHash: hash32("recovery-curve-metric"),
    rulesHash: hash32("recovery-curve-rules"),
    opensAt: BigInt(now - 8 * 24 * 60 * 60 - 120),
    closesAt: BigInt(now - 8 * 24 * 60 * 60 - 60),
    resolveAfter: BigInt(now - 8 * 24 * 60 * 60 - 60),
    bucketCount: 41,
    jackpotBps: 2_000,
  }), "create elapsed recovery curve market");
  await expectSubmitFailure(admin, await getResolveMarketInstruction({
    resolver: admin.address,
    marketId: yesMarketId,
    outcome: "yes",
    resolutionReportHash: hash32("local-premature-resolution-report"),
  }), "premature market resolution");
  await submit(admin, await getSetResolverInstruction({
    admin: admin.address,
    resolver: taker.address,
  }), "rotate resolver for future markets");

  const trading = await createOutcomeAccounts(tradingMarketId, admin, taker, true);
  const yesMarket = await createOutcomeAccounts(yesMarketId, admin, taker, false);
  const invalidMarket = await createOutcomeAccounts(invalidMarketId, admin, taker, false);
  assert(trading.takerYes && trading.takerNo);

  const curve = await deriveCurveMarketAddresses(curveMarketId);
  const invalidCurve = await deriveCurveMarketAddresses(invalidCurveMarketId);
  const noExactCurve = await deriveCurveMarketAddresses(noExactCurveMarketId);
  const recoveryCurve = await deriveCurveMarketAddresses(recoveryCurveMarketId);
  const [adminExactCurvePosition] = await deriveCurvePositionAddress({
    market: curve.market,
    owner: admin.address,
    bucket: 20,
  });
  const [takerNearCurvePosition] = await deriveCurvePositionAddress({
    market: curve.market,
    owner: taker.address,
    bucket: 19,
  });
  const [adminInvalidCurvePosition] = await deriveCurvePositionAddress({
    market: invalidCurve.market,
    owner: admin.address,
    bucket: 7,
  });
  const [adminNoExactCurvePosition] = await deriveCurvePositionAddress({
    market: noExactCurve.market,
    owner: admin.address,
    bucket: 19,
  });
  await submit(admin, await getOpenCurvePositionInstruction({
    owner: admin.address,
    collateralMint,
    ownerCollateral: adminUsdc,
    marketId: curveMarketId,
    bucket: 20,
    amount: 2_000_000n,
  }), "open exact curve position");
  await submit(admin, await getAddCurveStakeInstruction({
    owner: admin.address,
    collateralMint,
    ownerCollateral: adminUsdc,
    marketId: curveMarketId,
    bucket: 20,
    amount: 500_000n,
  }), "add exact curve stake");
  await submit(admin, await getWithdrawCurveStakeInstruction({
    owner: admin.address,
    collateralMint,
    ownerCollateral: adminUsdc,
    marketId: curveMarketId,
    bucket: 20,
    amount: 500_000n,
  }), "withdraw curve stake before close");
  await submit(taker, await getOpenCurvePositionInstruction({
    owner: taker.address,
    collateralMint,
    ownerCollateral: takerUsdc,
    marketId: curveMarketId,
    bucket: 19,
    amount: 1_000_000n,
  }), "open near curve position");
  const crossOwnerAdd = await getAddCurveStakeInstruction({
    owner: taker.address,
    collateralMint,
    ownerCollateral: takerUsdc,
    marketId: curveMarketId,
    bucket: 20,
    amount: 1n,
  });
  await expectSubmitFailure(
    taker,
    withAccount(crossOwnerAdd, 5, adminExactCurvePosition),
    "cross-owner curve stake addition",
  );
  const crossOwnerWithdraw = await getWithdrawCurveStakeInstruction({
    owner: taker.address,
    collateralMint,
    ownerCollateral: takerUsdc,
    marketId: curveMarketId,
    bucket: 20,
    amount: 1n,
  });
  await expectSubmitFailure(
    taker,
    withAccount(crossOwnerWithdraw, 5, adminExactCurvePosition),
    "cross-owner curve stake withdrawal",
  );
  await submit(admin, await getOpenCurvePositionInstruction({
    owner: admin.address,
    collateralMint,
    ownerCollateral: adminUsdc,
    marketId: invalidCurveMarketId,
    bucket: 7,
    amount: 500_000n,
  }), "open invalid-market curve position");
  await submit(admin, await getOpenCurvePositionInstruction({
    owner: admin.address,
    collateralMint,
    ownerCollateral: adminUsdc,
    marketId: noExactCurveMarketId,
    bucket: 19,
    amount: 1_000_000n,
  }), "open no-exact curve position");
  assert.equal(await tokenBalance(curve.vault), 3_000_000n);
  assert.equal(await tokenBalance(invalidCurve.vault), 500_000n);
  assert.equal(await tokenBalance(noExactCurve.vault), 1_000_000n);
  assert.equal(
    decodeCurvePositionAccount(await accountData(adminExactCurvePosition)).stake,
    2_000_000n,
  );
  await expectSubmitFailure(admin, await getResolveCurveMarketInstruction({
    resolver: admin.address,
    collateralMint,
    feeRecipient,
    marketId: curveMarketId,
    normalizedOutcome: 0,
    resolutionReportHash: hash32("local-premature-curve-resolution-report"),
  }), "premature curve resolution");
  await expectSubmitFailure(admin, await getInvalidateCurveMarketInstruction({
    resolver: admin.address,
    marketId: invalidCurveMarketId,
    resolutionReportHash: hash32("local-premature-curve-invalidation-report"),
  }), "premature curve invalidation");
  await expectSubmitFailure(admin, await getRecoverCurveMarketInstruction({
    admin: admin.address,
    marketId: invalidCurveMarketId,
    resolutionReportHash: hash32("local-premature-curve-recovery-report"),
  }), "curve recovery before seven-day delay");
  await expectSubmitFailure(taker, await getRecoverCurveMarketInstruction({
    admin: taker.address,
    marketId: invalidCurveMarketId,
    resolutionReportHash: hash32("local-unauthorized-curve-recovery-report"),
  }), "unauthorized curve recovery");
  await submit(admin, await getRecoverCurveMarketInstruction({
    admin: admin.address,
    marketId: recoveryCurveMarketId,
    resolutionReportHash: hash32("local-elapsed-curve-recovery-report"),
  }), "recover elapsed curve market as invalid");
  const recoveredCurveState = decodeCurveMarketAccount(await accountData(recoveryCurve.market));
  assert.equal(recoveredCurveState.status, "invalid");
  assert.equal(recoveredCurveState.payoutPool, 0n);
  assert.equal(recoveredCurveState.protocolFee, 0n);
  await expectSubmitFailure(admin, await getClaimCurvePositionInstruction({
    owner: admin.address,
    collateralMint,
    ownerCollateral: adminUsdc,
    marketId: curveMarketId,
    bucket: 20,
  }), "curve claim before resolution");

  await submit(admin, await getMintCompleteSetInstruction({
    owner: admin.address,
    collateralMint,
    marketId: tradingMarketId,
    ownerCollateral: adminUsdc,
    ownerYes: trading.adminYes,
    ownerNo: trading.adminNo,
    amount: 2_000_000n,
  }), "mint two trading complete sets");
  await submit(admin, await getMergeCompleteSetInstruction({
    owner: admin.address,
    collateralMint,
    marketId: tradingMarketId,
    ownerCollateral: adminUsdc,
    ownerYes: trading.adminYes,
    ownerNo: trading.adminNo,
    amount: 500_000n,
  }), "merge half a trading complete set");
  assert.equal(await tokenBalance(trading.market.vault), 1_500_000n);
  assert.equal(await tokenBalance(trading.adminYes), 1_500_000n);
  assert.equal(await tokenBalance(trading.adminNo), 1_500_000n);

  for (const [label, marketId, accounts] of [
    ["yes", yesMarketId, yesMarket],
    ["invalid", invalidMarketId, invalidMarket],
  ] as const) {
    await submit(admin, await getMintCompleteSetInstruction({
      owner: admin.address,
      collateralMint,
      marketId,
      ownerCollateral: adminUsdc,
      ownerYes: accounts.adminYes,
      ownerNo: accounts.adminNo,
      amount: 1_000_000n,
    }), `mint ${label} resolution complete set`);
  }

  const askId = hash32("local-ask-order");
  await submit(admin, await getPlaceOrderInstruction({
    maker: admin.address,
    collateralMint,
    feeRecipient,
    marketId: tradingMarketId,
    orderId: askId,
    outcomeMint: trading.market.yesMint,
    makerSource: trading.adminYes,
    side: "ask",
    priceMicroUsdc: 650_000n,
    quantity: 400_000n,
    expiresAt: BigInt(now + 500),
  }), "place YES ask");
  await expectSubmitFailure(taker, await getFillAskInstruction({
    maker: admin.address,
    taker: taker.address,
    collateralMint,
    feeRecipient,
    marketId: tradingMarketId,
    orderId: askId,
    outcomeMint: trading.market.yesMint,
    makerCollateral: adminUsdc,
    takerCollateral: takerUsdc,
    takerOutcome: trading.takerYes,
    quantity: 400_001n,
  }), "overfill YES ask");
  await submit(taker, await getFillAskInstruction({
    maker: admin.address,
    taker: taker.address,
    collateralMint,
    feeRecipient,
    marketId: tradingMarketId,
    orderId: askId,
    outcomeMint: trading.market.yesMint,
    makerCollateral: adminUsdc,
    takerCollateral: takerUsdc,
    takerOutcome: trading.takerYes,
    quantity: 400_000n,
  }), "fill YES ask");
  assert.equal(await tokenBalance(trading.takerYes), 400_000n);

  const bidId = hash32("local-bid-order");
  await submit(taker, await getPlaceOrderInstruction({
    maker: taker.address,
    collateralMint,
    feeRecipient,
    marketId: tradingMarketId,
    orderId: bidId,
    outcomeMint: trading.market.noMint,
    makerSource: takerUsdc,
    side: "bid",
    priceMicroUsdc: 250_000n,
    quantity: 300_000n,
    expiresAt: BigInt(now + 500),
  }), "place NO bid");
  await submit(admin, await getFillBidInstruction({
    maker: taker.address,
    taker: admin.address,
    collateralMint,
    feeRecipient,
    marketId: tradingMarketId,
    orderId: bidId,
    outcomeMint: trading.market.noMint,
    makerOutcome: trading.takerNo,
    takerCollateral: adminUsdc,
    takerOutcome: trading.adminNo,
    quantity: 300_000n,
  }), "fill NO bid");
  assert.equal(await tokenBalance(trading.takerNo), 300_000n);

  const cancelId = hash32("local-partial-cancel-order");
  await submit(admin, await getPlaceOrderInstruction({
    maker: admin.address,
    collateralMint,
    feeRecipient,
    marketId: tradingMarketId,
    orderId: cancelId,
    outcomeMint: trading.market.yesMint,
    makerSource: trading.adminYes,
    side: "ask",
    priceMicroUsdc: 700_000n,
    quantity: 200_000n,
    expiresAt: BigInt(now + 500),
  }), "place cancellable YES ask");
  await submit(taker, await getFillAskInstruction({
    maker: admin.address,
    taker: taker.address,
    collateralMint,
    feeRecipient,
    marketId: tradingMarketId,
    orderId: cancelId,
    outcomeMint: trading.market.yesMint,
    makerCollateral: adminUsdc,
    takerCollateral: takerUsdc,
    takerOutcome: trading.takerYes,
    quantity: 50_000n,
  }), "partially fill cancellable ask");
  const cancelOrder = await deriveOrderAddresses({
    market: trading.market.market,
    maker: admin.address,
    orderId: cancelId,
  });
  await submit(admin, await getCancelOrderInstruction({
    maker: admin.address,
    marketId: tradingMarketId,
    orderId: cancelId,
    escrowMint: trading.market.yesMint,
    makerRefund: trading.adminYes,
  }), "cancel remaining ask");
  assert.equal(await accountExists(cancelOrder.order), false);
  assert.equal(await accountExists(cancelOrder.vault), false);
  assert.equal(await tokenBalance(feeRecipient), 926n);

  await waitUntil(resolutionAt);
  const feeBeforeCurveResolution = await tokenBalance(feeRecipient);
  await expectSubmitFailure(taker, await getResolveCurveMarketInstruction({
    resolver: taker.address,
    collateralMint,
    feeRecipient,
    marketId: curveMarketId,
    normalizedOutcome: 0,
    resolutionReportHash: hash32("local-wrong-curve-resolver-report"),
  }), "rotated resolver cannot resolve snapshotted curve market");
  await expectSubmitFailure(admin, await getWithdrawCurveStakeInstruction({
    owner: admin.address,
    collateralMint,
    ownerCollateral: adminUsdc,
    marketId: curveMarketId,
    bucket: 20,
    amount: 1n,
  }), "curve stake withdrawal after close");
  await submit(admin, await getResolveCurveMarketInstruction({
    resolver: admin.address,
    collateralMint,
    feeRecipient,
    marketId: curveMarketId,
    normalizedOutcome: 0,
    resolutionReportHash: hash32("local-curve-resolution-report"),
  }), "resolve curve market");
  const resolvedCurve = decodeCurveMarketAccount(await accountData(curve.market));
  assert.equal(resolvedCurve.status, "resolved");
  assert.equal(resolvedCurve.normalizedOutcome, 0);
  assert.equal(resolvedCurve.winningBucket, 20);
  assert.equal(resolvedCurve.totalStaked, 3_000_000n);
  assert.equal(resolvedCurve.protocolFee, 7_500n);
  assert.equal(resolvedCurve.payoutPool, 2_992_500n);
  assert.equal(resolvedCurve.jackpotPool, 598_500n);
  assert.equal(resolvedCurve.curvePool, 2_394_000n);
  assert.equal(resolvedCurve.exactStake, 2_000_000n);
  assert.equal(resolvedCurve.weightedStake, 122_000_000n);
  assert.equal(await tokenBalance(feeRecipient), feeBeforeCurveResolution + 7_500n);

  const crossOwnerClaim = await getClaimCurvePositionInstruction({
    owner: taker.address,
    collateralMint,
    ownerCollateral: takerUsdc,
    marketId: curveMarketId,
    bucket: 20,
  });
  await expectSubmitFailure(
    taker,
    withAccount(crossOwnerClaim, 4, adminExactCurvePosition),
    "cross-owner curve claim",
  );

  const adminBeforeCurveClaim = await tokenBalance(adminUsdc);
  const takerBeforeCurveClaim = await tokenBalance(takerUsdc);
  await submit(admin, await getClaimCurvePositionInstruction({
    owner: admin.address,
    collateralMint,
    ownerCollateral: adminUsdc,
    marketId: curveMarketId,
    bucket: 20,
  }), "claim exact curve position");
  await submit(taker, await getClaimCurvePositionInstruction({
    owner: taker.address,
    collateralMint,
    ownerCollateral: takerUsdc,
    marketId: curveMarketId,
    bucket: 19,
  }), "claim near curve position");
  const exactCurvePosition = decodeCurvePositionAccount(await accountData(adminExactCurvePosition));
  const nearCurvePosition = decodeCurvePositionAccount(await accountData(takerNearCurvePosition));
  assert.equal(exactCurvePosition.claimed, true);
  assert.equal(nearCurvePosition.claimed, true);
  assert.equal(exactCurvePosition.payout, 2_207_581n);
  assert.equal(nearCurvePosition.payout, 784_918n);
  assert.equal(await tokenBalance(adminUsdc), adminBeforeCurveClaim + exactCurvePosition.payout);
  assert.equal(await tokenBalance(takerUsdc), takerBeforeCurveClaim + nearCurvePosition.payout);
  assert.equal(await tokenBalance(curve.vault), 1n);
  await expectSubmitFailure(admin, await getClaimCurvePositionInstruction({
    owner: admin.address,
    collateralMint,
    ownerCollateral: adminUsdc,
    marketId: curveMarketId,
    bucket: 20,
  }), "double curve claim");

  await submit(admin, await getResolveCurveMarketInstruction({
    resolver: admin.address,
    collateralMint,
    feeRecipient,
    marketId: noExactCurveMarketId,
    normalizedOutcome: 0,
    resolutionReportHash: hash32("local-no-exact-curve-resolution-report"),
  }), "resolve no-exact curve market");
  const noExactCurveState = decodeCurveMarketAccount(await accountData(noExactCurve.market));
  assert.equal(noExactCurveState.exactStake, 0n);
  assert.equal(noExactCurveState.jackpotPool, 0n);
  assert.equal(noExactCurveState.curvePool, noExactCurveState.payoutPool);
  await submit(admin, await getClaimCurvePositionInstruction({
    owner: admin.address,
    collateralMint,
    ownerCollateral: adminUsdc,
    marketId: noExactCurveMarketId,
    bucket: 19,
  }), "claim no-exact curve position");
  assert.equal(
    decodeCurvePositionAccount(await accountData(adminNoExactCurvePosition)).claimed,
    true,
  );

  const feeBeforeInvalidCurve = await tokenBalance(feeRecipient);
  await expectSubmitFailure(taker, await getInvalidateCurveMarketInstruction({
    resolver: taker.address,
    marketId: invalidCurveMarketId,
    resolutionReportHash: hash32("local-wrong-resolver-invalidation-report"),
  }), "wrong resolver curve invalidation");
  await submit(admin, await getInvalidateCurveMarketInstruction({
    resolver: admin.address,
    marketId: invalidCurveMarketId,
    resolutionReportHash: hash32("local-invalid-curve-resolution-report"),
  }), "invalidate curve market");
  await expectSubmitFailure(admin, await getInvalidateCurveMarketInstruction({
    resolver: admin.address,
    marketId: invalidCurveMarketId,
    resolutionReportHash: hash32("local-second-curve-invalidation-report"),
  }), "second curve invalidation");
  const invalidCurveState = decodeCurveMarketAccount(await accountData(invalidCurve.market));
  assert.equal(invalidCurveState.status, "invalid");
  assert.equal(invalidCurveState.protocolFee, 0n);
  assert.equal(invalidCurveState.payoutPool, 500_000n);
  const adminBeforeInvalidCurveClaim = await tokenBalance(adminUsdc);
  await submit(admin, await getClaimCurvePositionInstruction({
    owner: admin.address,
    collateralMint,
    ownerCollateral: adminUsdc,
    marketId: invalidCurveMarketId,
    bucket: 7,
  }), "claim invalid curve refund");
  const invalidCurvePosition = decodeCurvePositionAccount(
    await accountData(adminInvalidCurvePosition),
  );
  assert.equal(invalidCurvePosition.claimed, true);
  assert.equal(invalidCurvePosition.payout, 500_000n);
  assert.equal(await tokenBalance(adminUsdc), adminBeforeInvalidCurveClaim + 500_000n);
  assert.equal(await tokenBalance(invalidCurve.vault), 0n);
  assert.equal(await tokenBalance(feeRecipient), feeBeforeInvalidCurve);

  await submit(admin, await getResolveMarketInstruction({
    resolver: admin.address,
    marketId: yesMarketId,
    outcome: "yes",
    resolutionReportHash: hash32("local-yes-resolution-report"),
  }), "resolve YES market");
  await expectSubmitFailure(admin, await getRedeemInstruction({
    owner: admin.address,
    collateralMint,
    marketId: yesMarketId,
    ownerCollateral: adminUsdc,
    claimMint: yesMarket.market.noMint,
    ownerClaim: yesMarket.adminNo,
    amount: 1_000_000n,
  }), "redeem losing NO claim");
  await submit(admin, await getRedeemInstruction({
    owner: admin.address,
    collateralMint,
    marketId: yesMarketId,
    ownerCollateral: adminUsdc,
    claimMint: yesMarket.market.yesMint,
    ownerClaim: yesMarket.adminYes,
    amount: 1_000_000n,
  }), "redeem winning YES");
  assert.equal(await tokenBalance(yesMarket.market.vault), 0n);

  await submit(admin, await getResolveMarketInstruction({
    resolver: admin.address,
    marketId: invalidMarketId,
    outcome: "invalid",
    resolutionReportHash: hash32("local-invalid-resolution-report"),
  }), "invalidate market");
  for (const [claimMint, ownerClaim, label] of [
    [invalidMarket.market.yesMint, invalidMarket.adminYes, "YES"],
    [invalidMarket.market.noMint, invalidMarket.adminNo, "NO"],
  ] as const) {
    await submit(admin, await getRedeemInstruction({
      owner: admin.address,
      collateralMint,
      marketId: invalidMarketId,
      ownerCollateral: adminUsdc,
      claimMint,
      ownerClaim,
      amount: 1_000_000n,
    }), `redeem invalid ${label}`);
  }
  assert.equal(await tokenBalance(invalidMarket.market.vault), 0n);
  assert.equal(await tokenBalance(trading.market.vault), 1_500_000n);
  process.stdout.write("SCARCITY_LOCALNET_E2E_OK\n");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
