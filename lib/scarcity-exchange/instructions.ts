import {
  AccountRole,
  getAddressEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import idl from "./generated/scarcity_exchange.json";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  assertBytes32,
  deriveConfigAddress,
  deriveCurveMarketAddresses,
  deriveCurvePositionAddress,
  deriveProgramDataAddress,
  deriveMarketAddresses,
  deriveOrderAddresses,
  RENT_SYSVAR_ADDRESS,
  SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "./addresses";

type InstructionName =
  | "initialize_config"
  | "create_curve_market"
  | "open_curve_position"
  | "add_curve_stake"
  | "withdraw_curve_stake"
  | "resolve_curve_market"
  | "invalidate_curve_market"
  | "recover_curve_market"
  | "claim_curve_position"
  | "create_market"
  | "mint_complete_set"
  | "merge_complete_set"
  | "resolve_market"
  | "redeem"
  | "set_paused"
  | "set_resolver"
  | "close_market"
  | "place_order"
  | "fill_ask"
  | "fill_bid"
  | "cancel_order";

export type ResolutionOutcome = "yes" | "no" | "invalid";
export type OrderSide = "bid" | "ask";

export const CURVE_VALUE_SCALE = 1_000_000;
export const MIN_CURVE_BUCKETS = 3;
export const MAX_CURVE_BUCKETS = 41;
export const MAX_CURVE_JACKPOT_BPS = 5_000;

const addressEncoder = getAddressEncoder();

function instructionDiscriminator(name: InstructionName) {
  const instruction = idl.instructions.find((candidate) => candidate.name === name);
  if (!instruction) throw new Error(`Generated IDL does not contain ${name}.`);
  return Uint8Array.from(instruction.discriminator);
}

function concatBytes(...parts: ReadonlyArray<ArrayLike<number>>) {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function encodeU64(value: bigint) {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error("u64 value is outside the supported range.");
  }
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, value, true);
  return output;
}

function encodeI64(value: bigint) {
  if (value < -0x8000_0000_0000_0000n || value > 0x7fff_ffff_ffff_ffffn) {
    throw new Error("i64 value is outside the supported range.");
  }
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigInt64(0, value, true);
  return output;
}

function encodeI32(value: number) {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw new Error("i32 value is outside the supported range.");
  }
  const output = new Uint8Array(4);
  new DataView(output.buffer).setInt32(0, value, true);
  return output;
}

function encodeU16(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error("u16 value is outside the supported range.");
  }
  const output = new Uint8Array(2);
  new DataView(output.buffer).setUint16(0, value, true);
  return output;
}

function encodeU8(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error("u8 value is outside the supported range.");
  }
  return Uint8Array.of(value);
}

function assertCurveBucketCount(bucketCount: number) {
  if (
    !Number.isInteger(bucketCount)
    || bucketCount < MIN_CURVE_BUCKETS
    || bucketCount > MAX_CURVE_BUCKETS
    || bucketCount % 2 === 0
  ) {
    throw new Error("Curve bucket count must be an odd integer from 3 through 41.");
  }
}

function assertCurveBucket(bucket: number) {
  if (!Number.isInteger(bucket) || bucket < 0 || bucket >= MAX_CURVE_BUCKETS) {
    throw new Error("Curve bucket must be an integer from 0 through 40.");
  }
}

const readonly = (accountAddress: Address) => ({
  address: accountAddress,
  role: AccountRole.READONLY,
}) as const;
const writable = (accountAddress: Address) => ({
  address: accountAddress,
  role: AccountRole.WRITABLE,
}) as const;
const readonlySigner = (accountAddress: Address) => ({
  address: accountAddress,
  role: AccountRole.READONLY_SIGNER,
}) as const;
const writableSigner = (accountAddress: Address) => ({
  address: accountAddress,
  role: AccountRole.WRITABLE_SIGNER,
}) as const;

export async function getInitializeConfigInstruction(input: {
  admin: Address;
  resolver: Address;
  collateralMint: Address;
  feeRecipient: Address;
  tradingFeeBps: number;
}): Promise<Instruction> {
  const [config] = await deriveConfigAddress();
  const [programData] = await deriveProgramDataAddress();
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      writable(config),
      writableSigner(input.admin),
      readonly(SCARCITY_EXCHANGE_PROGRAM_ADDRESS),
      readonly(programData),
      readonly(input.collateralMint),
      readonly(input.feeRecipient),
      readonly(SYSTEM_PROGRAM_ADDRESS),
    ],
    data: concatBytes(
      instructionDiscriminator("initialize_config"),
      addressEncoder.encode(input.resolver),
      encodeU16(input.tradingFeeBps),
    ),
  };
}

export async function getCreateCurveMarketInstruction(input: {
  admin: Address;
  collateralMint: Address;
  feeRecipient: Address;
  marketId: Uint8Array;
  metricHash: Uint8Array;
  rulesHash: Uint8Array;
  opensAt: bigint;
  closesAt: bigint;
  resolveAfter: bigint;
  bucketCount: number;
  jackpotBps: number;
}): Promise<Instruction> {
  assertBytes32(input.marketId, "curve market ID");
  assertBytes32(input.metricHash, "metric hash");
  assertBytes32(input.rulesHash, "rules hash");
  assertCurveBucketCount(input.bucketCount);
  if (
    !Number.isInteger(input.jackpotBps)
    || input.jackpotBps < 0
    || input.jackpotBps > MAX_CURVE_JACKPOT_BPS
  ) {
    throw new Error("Curve jackpot basis points must be between 0 and 5000.");
  }
  const addresses = await deriveCurveMarketAddresses(input.marketId);
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(addresses.config),
      writableSigner(input.admin),
      readonly(input.collateralMint),
      readonly(input.feeRecipient),
      writable(addresses.market),
      writable(addresses.vault),
      readonly(TOKEN_PROGRAM_ADDRESS),
      readonly(SYSTEM_PROGRAM_ADDRESS),
      readonly(RENT_SYSVAR_ADDRESS),
    ],
    data: concatBytes(
      instructionDiscriminator("create_curve_market"),
      input.marketId,
      input.metricHash,
      input.rulesHash,
      encodeI64(input.opensAt),
      encodeI64(input.closesAt),
      encodeI64(input.resolveAfter),
      encodeU8(input.bucketCount),
      encodeU16(input.jackpotBps),
    ),
  };
}

export async function getOpenCurvePositionInstruction(input: {
  owner: Address;
  collateralMint: Address;
  ownerCollateral: Address;
  marketId: Uint8Array;
  bucket: number;
  amount: bigint;
}): Promise<Instruction> {
  assertCurveBucket(input.bucket);
  const market = await deriveCurveMarketAddresses(input.marketId);
  const [position] = await deriveCurvePositionAddress({
    market: market.market,
    owner: input.owner,
    bucket: input.bucket,
  });
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(market.config),
      writable(market.market),
      writableSigner(input.owner),
      readonly(input.collateralMint),
      writable(input.ownerCollateral),
      writable(position),
      writable(market.vault),
      readonly(TOKEN_PROGRAM_ADDRESS),
      readonly(SYSTEM_PROGRAM_ADDRESS),
    ],
    data: concatBytes(
      instructionDiscriminator("open_curve_position"),
      encodeU8(input.bucket),
      encodeU64(input.amount),
    ),
  };
}

async function getUpdateCurveStakeInstruction(input: {
  owner: Address;
  collateralMint: Address;
  ownerCollateral: Address;
  marketId: Uint8Array;
  bucket: number;
  amount: bigint;
  instruction: "add_curve_stake" | "withdraw_curve_stake";
}): Promise<Instruction> {
  assertCurveBucket(input.bucket);
  const market = await deriveCurveMarketAddresses(input.marketId);
  const [position] = await deriveCurvePositionAddress({
    market: market.market,
    owner: input.owner,
    bucket: input.bucket,
  });
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(market.config),
      writable(market.market),
      writableSigner(input.owner),
      readonly(input.collateralMint),
      writable(input.ownerCollateral),
      writable(position),
      writable(market.vault),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: concatBytes(instructionDiscriminator(input.instruction), encodeU64(input.amount)),
  };
}

export async function getAddCurveStakeInstruction(input: {
  owner: Address;
  collateralMint: Address;
  ownerCollateral: Address;
  marketId: Uint8Array;
  bucket: number;
  amount: bigint;
}): Promise<Instruction> {
  return getUpdateCurveStakeInstruction({ ...input, instruction: "add_curve_stake" });
}

export async function getWithdrawCurveStakeInstruction(input: {
  owner: Address;
  collateralMint: Address;
  ownerCollateral: Address;
  marketId: Uint8Array;
  bucket: number;
  amount: bigint;
}): Promise<Instruction> {
  return getUpdateCurveStakeInstruction({ ...input, instruction: "withdraw_curve_stake" });
}

export async function getResolveCurveMarketInstruction(input: {
  resolver: Address;
  collateralMint: Address;
  feeRecipient: Address;
  marketId: Uint8Array;
  normalizedOutcome: number;
  resolutionReportHash: Uint8Array;
}): Promise<Instruction> {
  if (
    !Number.isInteger(input.normalizedOutcome)
    || input.normalizedOutcome < -CURVE_VALUE_SCALE
    || input.normalizedOutcome > CURVE_VALUE_SCALE
  ) {
    throw new Error("Normalized curve outcome must be an integer from -1000000 through 1000000.");
  }
  assertBytes32(input.resolutionReportHash, "resolution report hash");
  const market = await deriveCurveMarketAddresses(input.marketId);
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(market.config),
      readonlySigner(input.resolver),
      writable(market.market),
      readonly(input.collateralMint),
      writable(market.vault),
      writable(input.feeRecipient),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: concatBytes(
      instructionDiscriminator("resolve_curve_market"),
      encodeI32(input.normalizedOutcome),
      input.resolutionReportHash,
    ),
  };
}

export async function getInvalidateCurveMarketInstruction(input: {
  resolver: Address;
  marketId: Uint8Array;
  resolutionReportHash: Uint8Array;
}): Promise<Instruction> {
  assertBytes32(input.resolutionReportHash, "resolution report hash");
  const market = await deriveCurveMarketAddresses(input.marketId);
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(market.config),
      readonlySigner(input.resolver),
      writable(market.market),
      readonly(market.vault),
    ],
    data: concatBytes(
      instructionDiscriminator("invalidate_curve_market"),
      input.resolutionReportHash,
    ),
  };
}

export async function getRecoverCurveMarketInstruction(input: {
  admin: Address;
  marketId: Uint8Array;
  resolutionReportHash: Uint8Array;
}): Promise<Instruction> {
  assertBytes32(input.resolutionReportHash, "resolution report hash");
  const market = await deriveCurveMarketAddresses(input.marketId);
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(market.config),
      readonlySigner(input.admin),
      writable(market.market),
      readonly(market.vault),
    ],
    data: concatBytes(
      instructionDiscriminator("recover_curve_market"),
      input.resolutionReportHash,
    ),
  };
}

export async function getClaimCurvePositionInstruction(input: {
  owner: Address;
  collateralMint: Address;
  ownerCollateral: Address;
  marketId: Uint8Array;
  bucket: number;
}): Promise<Instruction> {
  assertCurveBucket(input.bucket);
  const market = await deriveCurveMarketAddresses(input.marketId);
  const [position] = await deriveCurvePositionAddress({
    market: market.market,
    owner: input.owner,
    bucket: input.bucket,
  });
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      writable(market.market),
      writableSigner(input.owner),
      readonly(input.collateralMint),
      writable(input.ownerCollateral),
      writable(position),
      writable(market.vault),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: instructionDiscriminator("claim_curve_position"),
  };
}

export async function getPlaceOrderInstruction(input: {
  maker: Address;
  collateralMint: Address;
  feeRecipient: Address;
  marketId: Uint8Array;
  orderId: Uint8Array;
  outcomeMint: Address;
  makerSource: Address;
  side: OrderSide;
  priceMicroUsdc: bigint;
  quantity: bigint;
  expiresAt: bigint;
}): Promise<Instruction> {
  assertBytes32(input.orderId, "order ID");
  const market = await deriveMarketAddresses(input.marketId);
  if (input.outcomeMint !== market.yesMint && input.outcomeMint !== market.noMint) {
    throw new Error("The outcome mint does not belong to this market.");
  }
  const order = await deriveOrderAddresses({
    market: market.market,
    maker: input.maker,
    orderId: input.orderId,
  });
  const escrowMint = input.side === "bid" ? input.collateralMint : input.outcomeMint;
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(market.config),
      readonly(market.market),
      writableSigner(input.maker),
      readonly(input.collateralMint),
      readonly(input.outcomeMint),
      readonly(input.feeRecipient),
      writable(input.makerSource),
      readonly(escrowMint),
      writable(order.order),
      writable(order.vault),
      readonly(TOKEN_PROGRAM_ADDRESS),
      readonly(SYSTEM_PROGRAM_ADDRESS),
      readonly(RENT_SYSVAR_ADDRESS),
    ],
    data: concatBytes(
      instructionDiscriminator("place_order"),
      input.orderId,
      Uint8Array.of(input.side === "bid" ? 0 : 1),
      encodeU64(input.priceMicroUsdc),
      encodeU64(input.quantity),
      encodeI64(input.expiresAt),
    ),
  };
}

export async function getFillAskInstruction(input: {
  maker: Address;
  taker: Address;
  collateralMint: Address;
  feeRecipient: Address;
  marketId: Uint8Array;
  orderId: Uint8Array;
  outcomeMint: Address;
  makerCollateral: Address;
  takerCollateral: Address;
  takerOutcome: Address;
  quantity: bigint;
}): Promise<Instruction> {
  const market = await deriveMarketAddresses(input.marketId);
  const order = await deriveOrderAddresses({ market: market.market, maker: input.maker, orderId: input.orderId });
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(market.market),
      writable(order.order),
      writableSigner(input.taker),
      readonly(input.collateralMint),
      readonly(input.outcomeMint),
      writable(input.makerCollateral),
      writable(input.takerCollateral),
      writable(input.takerOutcome),
      writable(order.vault),
      writable(input.feeRecipient),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: concatBytes(instructionDiscriminator("fill_ask"), encodeU64(input.quantity)),
  };
}

export async function getFillBidInstruction(input: {
  maker: Address;
  taker: Address;
  collateralMint: Address;
  feeRecipient: Address;
  marketId: Uint8Array;
  orderId: Uint8Array;
  outcomeMint: Address;
  makerOutcome: Address;
  takerCollateral: Address;
  takerOutcome: Address;
  quantity: bigint;
}): Promise<Instruction> {
  const market = await deriveMarketAddresses(input.marketId);
  const order = await deriveOrderAddresses({ market: market.market, maker: input.maker, orderId: input.orderId });
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(market.market),
      writable(order.order),
      writableSigner(input.taker),
      readonly(input.collateralMint),
      readonly(input.outcomeMint),
      writable(input.makerOutcome),
      writable(input.takerCollateral),
      writable(input.takerOutcome),
      writable(order.vault),
      writable(input.feeRecipient),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: concatBytes(instructionDiscriminator("fill_bid"), encodeU64(input.quantity)),
  };
}

export async function getCancelOrderInstruction(input: {
  maker: Address;
  marketId: Uint8Array;
  orderId: Uint8Array;
  escrowMint: Address;
  makerRefund: Address;
}): Promise<Instruction> {
  const market = await deriveMarketAddresses(input.marketId);
  const order = await deriveOrderAddresses({ market: market.market, maker: input.maker, orderId: input.orderId });
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(market.market),
      writable(order.order),
      writableSigner(input.maker),
      readonly(input.escrowMint),
      writable(order.vault),
      writable(input.makerRefund),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: instructionDiscriminator("cancel_order"),
  };
}

export async function getCreateMarketInstruction(input: {
  admin: Address;
  collateralMint: Address;
  marketId: Uint8Array;
  questionHash: Uint8Array;
  rulesHash: Uint8Array;
  opensAt: bigint;
  closesAt: bigint;
  resolveAfter: bigint;
}): Promise<Instruction> {
  assertBytes32(input.marketId, "market ID");
  assertBytes32(input.questionHash, "question hash");
  assertBytes32(input.rulesHash, "rules hash");
  const addresses = await deriveMarketAddresses(input.marketId);

  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(addresses.config),
      writableSigner(input.admin),
      readonly(input.collateralMint),
      writable(addresses.market),
      writable(addresses.yesMint),
      writable(addresses.noMint),
      writable(addresses.vault),
      readonly(TOKEN_PROGRAM_ADDRESS),
      readonly(SYSTEM_PROGRAM_ADDRESS),
      readonly(RENT_SYSVAR_ADDRESS),
    ],
    data: concatBytes(
      instructionDiscriminator("create_market"),
      input.marketId,
      input.questionHash,
      input.rulesHash,
      encodeI64(input.opensAt),
      encodeI64(input.closesAt),
      encodeI64(input.resolveAfter),
    ),
  };
}

export async function getMintCompleteSetInstruction(input: {
  owner: Address;
  collateralMint: Address;
  marketId: Uint8Array;
  ownerCollateral: Address;
  ownerYes: Address;
  ownerNo: Address;
  amount: bigint;
}): Promise<Instruction> {
  const addresses = await deriveMarketAddresses(input.marketId);
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(addresses.config),
      writable(addresses.market),
      writableSigner(input.owner),
      readonly(input.collateralMint),
      writable(input.ownerCollateral),
      writable(addresses.yesMint),
      writable(addresses.noMint),
      writable(input.ownerYes),
      writable(input.ownerNo),
      writable(addresses.vault),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: concatBytes(instructionDiscriminator("mint_complete_set"), encodeU64(input.amount)),
  };
}

export async function getMergeCompleteSetInstruction(input: {
  owner: Address;
  collateralMint: Address;
  marketId: Uint8Array;
  ownerCollateral: Address;
  ownerYes: Address;
  ownerNo: Address;
  amount: bigint;
}): Promise<Instruction> {
  const addresses = await deriveMarketAddresses(input.marketId);
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      writable(addresses.market),
      writableSigner(input.owner),
      readonly(input.collateralMint),
      writable(input.ownerCollateral),
      writable(addresses.yesMint),
      writable(addresses.noMint),
      writable(input.ownerYes),
      writable(input.ownerNo),
      writable(addresses.vault),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: concatBytes(instructionDiscriminator("merge_complete_set"), encodeU64(input.amount)),
  };
}

export async function getResolveMarketInstruction(input: {
  resolver: Address;
  marketId: Uint8Array;
  outcome: ResolutionOutcome;
  resolutionReportHash: Uint8Array;
}): Promise<Instruction> {
  assertBytes32(input.resolutionReportHash, "resolution report hash");
  const addresses = await deriveMarketAddresses(input.marketId);
  const outcome = input.outcome === "yes" ? 0 : input.outcome === "no" ? 1 : 2;
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(addresses.config),
      readonlySigner(input.resolver),
      writable(addresses.market),
    ],
    data: concatBytes(
      instructionDiscriminator("resolve_market"),
      Uint8Array.of(outcome),
      input.resolutionReportHash,
    ),
  };
}

export async function getRedeemInstruction(input: {
  owner: Address;
  collateralMint: Address;
  marketId: Uint8Array;
  ownerCollateral: Address;
  claimMint: Address;
  ownerClaim: Address;
  amount: bigint;
}): Promise<Instruction> {
  const addresses = await deriveMarketAddresses(input.marketId);
  if (input.claimMint !== addresses.yesMint && input.claimMint !== addresses.noMint) {
    throw new Error("The claim mint does not belong to this market.");
  }
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      writable(addresses.market),
      writableSigner(input.owner),
      readonly(input.collateralMint),
      writable(input.ownerCollateral),
      writable(input.claimMint),
      writable(input.ownerClaim),
      writable(addresses.vault),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: concatBytes(instructionDiscriminator("redeem"), encodeU64(input.amount)),
  };
}

/**
 * Reclaim the rent of a settled market whose vault owes nothing.
 *
 * The program refuses unless the market is resolved and `total_redeemed == open_interest`, so a
 * winner who has not redeemed keeps their market open. Recovers the market account and its vault;
 * the two outcome mints cannot be closed by the SPL token program.
 */
export async function getCloseMarketInstruction(input: {
  admin: Address;
  marketId: Uint8Array;
}): Promise<Instruction> {
  assertBytes32(input.marketId, "market ID");
  const [config] = await deriveConfigAddress();
  const addresses = await deriveMarketAddresses(input.marketId);
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [
      readonly(config),
      writableSigner(input.admin),
      writable(addresses.market),
      writable(addresses.vault),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: instructionDiscriminator("close_market"),
  };
}

export async function getSetPausedInstruction(input: {
  admin: Address;
  paused: boolean;
}): Promise<Instruction> {
  const [config] = await deriveConfigAddress();
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [writable(config), readonlySigner(input.admin)],
    data: concatBytes(instructionDiscriminator("set_paused"), Uint8Array.of(input.paused ? 1 : 0)),
  };
}

export async function getSetResolverInstruction(input: {
  admin: Address;
  resolver: Address;
}): Promise<Instruction> {
  const [config] = await deriveConfigAddress();
  return {
    programAddress: SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
    accounts: [writable(config), readonlySigner(input.admin)],
    data: concatBytes(
      instructionDiscriminator("set_resolver"),
      addressEncoder.encode(input.resolver),
    ),
  };
}

/**
 * Create an associated token account if it does not already exist.
 *
 * Discriminator 1 is the token program's `CreateIdempotent`, which succeeds when the account is
 * already there. That matters because a fill has to work for a first-time taker and a returning one
 * from the same instruction list, without a read to tell them apart.
 */
export function getCreateAssociatedTokenIdempotentInstruction(input: {
  payer: Address;
  owner: Address;
  mint: Address;
  associatedToken: Address;
}): Instruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    accounts: [
      writableSigner(input.payer),
      writable(input.associatedToken),
      readonly(input.owner),
      readonly(input.mint),
      readonly(SYSTEM_PROGRAM_ADDRESS),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: Uint8Array.of(1),
  };
}
