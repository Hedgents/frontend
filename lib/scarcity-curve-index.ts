import "server-only";

import { address, getAddressEncoder } from "@solana/kit";
import {
  CURVE_MARKET_ACCOUNT_SIZE,
  CURVE_POSITION_ACCOUNT_SIZE,
  CURVE_POSITION_OWNER_OFFSET,
  decodeCurveMarketAccount,
  decodeCurvePositionAccount,
  decodeExchangeConfigAccount,
  deriveConfigAddress,
  deriveCurvePositionAddress,
  SCARCITY_CONFIG_ACCOUNT_SIZE,
  SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
  curvePositionDiscriminatorBase64,
  type DecodedCurveMarket,
} from "@/lib/scarcity-exchange";
import {
  loadScarcityDeployment,
  resolveStoredCurveMarket,
  scarcityRpcUrls,
  type ResolvedScarcityDeployment,
} from "@/lib/scarcity-deployment";
import { curveWeight, normalizedToCurveBucket } from "@/lib/scarcity-curve-math";
import { calculateCurvePositionClaimable } from "@/lib/scarcity-curve-payout";
import { solanaRpcRequestFrom } from "@/lib/solana-rpc";

interface RpcAccountData {
  data: [string, string];
  executable: boolean;
  lamports: number;
  owner: string;
  rentEpoch: number;
  space: number;
}

interface ProgramAccount {
  pubkey: string;
  account: RpcAccountData;
}

export interface ScarcityCurveChainState {
  deployment: {
    cluster: "devnet" | "mainnet-beta";
    programAddress: string;
    collateralMint: string;
    feeRecipient: string;
    resolver: string;
    currentResolver: string;
    paused: boolean;
    tradingFeeBps: number;
    market: string;
    vault: string;
    creationSignature: string;
  };
  market: {
    status: DecodedCurveMarket["status"];
    opensAt: string;
    closesAt: string;
    resolveAfter: string;
    resolvedAt: string;
    normalizedOutcome: number;
    bucketCount: number;
    winningBucket: number;
    jackpotBps: number;
    jackpotLeverageCap: number;
    feeBps: number;
    totalStaked: string;
    protocolFee: string;
    payoutPool: string;
    jackpotPool: string;
    curvePool: string;
    exactStake: string;
    weightedStake: string;
    totalClaimed: string;
    bucketStakes: string[];
    resolutionReportHash: string;
  };
  asOf: string;
}

export interface ScarcityCurvePortfolio {
  deployment: null | {
    cluster: "devnet" | "mainnet-beta";
    programAddress: string;
    collateralMint: string;
    paused: boolean;
  };
  positions: Array<{
    slug: string;
    market: string;
    bucket: number;
    stake: string;
    payout: string;
    claimable: string;
    claimed: boolean;
    status: DecodedCurveMarket["status"];
    winningBucket: number;
    normalizedOutcome: number;
    bucketCount: number;
    /** Set for positions in markets retired via the manifest's supersededMarkets. */
    superseded?: boolean;
    /** The manifest-recorded retirement reason, shown to the holder. */
    note?: string;
  }>;
  totals: { totalStaked: string; claimable: string };
  asOf: string;
}

const addressEncoder = getAddressEncoder();

function decodeRpcData(account: RpcAccountData, expectedSize: number, label: string) {
  if (!Array.isArray(account.data) || account.data[1] !== "base64") {
    throw new Error("Solana RPC returned an unsupported account encoding.");
  }
  const data = Uint8Array.from(Buffer.from(account.data[0], "base64"));
  if (data.length !== expectedSize || account.space !== expectedSize) {
    throw new Error(`${label} is not the expected ${expectedSize}-byte account.`);
  }
  return data;
}

function assertProgramOwnedAccount(account: RpcAccountData, label: string) {
  if (account.owner !== String(SCARCITY_EXCHANGE_PROGRAM_ADDRESS) || account.executable) {
    throw new Error(`${label} is not a non-executable account owned by the reviewed scarcity program.`);
  }
}

function base64Address(value: string) {
  return Buffer.from(addressEncoder.encode(address(value))).toString("base64");
}

async function verifyDeploymentConfig(deployment: ResolvedScarcityDeployment) {
  const [configAddress] = await deriveConfigAddress();
  const response = await solanaRpcRequestFrom<{ value: RpcAccountData | null }>(
    scarcityRpcUrls(deployment.cluster),
    "getAccountInfo",
    [String(configAddress), { encoding: "base64", commitment: "confirmed" }],
    { id: "scarcity-curve-config" },
  );
  if (!response.value) throw new Error("The scarcity exchange config account does not exist.");
  assertProgramOwnedAccount(response.value, "Scarcity exchange config");
  const config = decodeExchangeConfigAccount(decodeRpcData(response.value, SCARCITY_CONFIG_ACCOUNT_SIZE, "Scarcity exchange config"));
  if (
    config.version !== 1
    || String(config.admin) !== deployment.admin
    || String(config.resolver) !== deployment.resolver
    || String(config.collateralMint) !== deployment.collateralMint
    || String(config.feeRecipient) !== deployment.feeRecipient
    || config.tradingFeeBps !== deployment.tradingFeeBps
  ) {
    throw new Error("Onchain scarcity configuration does not match the reviewed deployment manifest.");
  }
  return config;
}

function verifyCurveAccounting(market: DecodedCurveMarket) {
  if (market.bucketCount < 3 || market.bucketCount > 41 || market.bucketCount % 2 === 0) {
    throw new Error("Onchain curve market has an invalid bucket count.");
  }
  const activeStakes = market.bucketStakes.slice(0, market.bucketCount);
  if (market.bucketStakes.slice(market.bucketCount).some((stake) => stake !== 0n)) {
    throw new Error("Onchain curve market records stake outside its active buckets.");
  }
  const recordedStake = activeStakes.reduce((total, stake) => total + stake, 0n);
  if (recordedStake !== market.totalStaked) {
    throw new Error("Onchain curve stake totals are internally inconsistent.");
  }
  if (market.totalClaimed > market.payoutPool) {
    throw new Error("Onchain curve claims exceed the committed payout pool.");
  }
  if (market.status === "unresolved") return;
  if (market.status === "invalid") {
    if (
      market.protocolFee !== 0n
      || market.payoutPool !== market.totalStaked
      || market.jackpotPool !== 0n
      || market.curvePool !== market.totalStaked
      || market.exactStake !== 0n
      || market.weightedStake !== 0n
      || market.winningBucket !== 0xff
    ) {
      throw new Error("Invalid curve market refund accounting is inconsistent.");
    }
    return;
  }
  if (market.winningBucket >= market.bucketCount) {
    throw new Error("Resolved curve market has an invalid winning bucket.");
  }
  if (normalizedToCurveBucket(market.normalizedOutcome, market.bucketCount) !== market.winningBucket) {
    throw new Error("Resolved curve outcome does not map to its recorded winning bucket.");
  }
  const exactStake = activeStakes[market.winningBucket] ?? 0n;
  const weightedStake = activeStakes.reduce(
    (total, stake, bucket) => total + stake * BigInt(curveWeight(bucket, market.winningBucket, market.bucketCount)),
    0n,
  );
  const protocolFee = market.totalStaked * BigInt(market.feeBps) / 10_000n;
  const payoutPool = market.totalStaked - protocolFee;
  const targetJackpot = payoutPool * BigInt(market.jackpotBps) / 10_000n;
  const jackpotCap = exactStake * BigInt(market.jackpotLeverageCap);
  const jackpotPool = targetJackpot < jackpotCap ? targetJackpot : jackpotCap;
  if (
    market.protocolFee !== protocolFee
    || market.payoutPool !== payoutPool
    || market.jackpotPool !== jackpotPool
    || market.curvePool !== payoutPool - jackpotPool
    || market.exactStake !== exactStake
    || market.weightedStake !== weightedStake
  ) {
    throw new Error("Resolved curve market payout accounting is inconsistent.");
  }
}

async function verifyCurveCommitments(input: {
  slug: string;
  decoded: DecodedCurveMarket;
  deployment: ResolvedScarcityDeployment;
}) {
  const manifest = input.deployment.curveMarkets[input.slug];
  if (!manifest) throw new Error("The curve market is not present in the deployment manifest.");
  // Recompile through the same resolver the deployment loader used. Going straight to the catalog
  // silently excludes the lithium rounds, which compile from their own frozen index rather than from
  // a stored catalog record, so every one of them failed this check and could never be traded.
  const resolved = await resolveStoredCurveMarket(input.slug);
  const compiled = resolved?.compiled ?? null;
  if (!compiled || compiled.slug !== input.slug) {
    throw new Error("The deployed curve no longer compiles from its canonical source market.");
  }
  const decoded = input.decoded;
  const [configAddress] = await deriveConfigAddress();
  if (
    decoded.marketId !== compiled.marketId
    || decoded.metricHash !== compiled.metricHash
    || decoded.rulesHash !== compiled.rulesHash
  ) {
    throw new Error("Onchain curve commitments do not match the published canonical documents.");
  }
  if (
    String(decoded.config) !== String(configAddress)
    || String(decoded.creator) !== input.deployment.admin
    || String(decoded.collateralMint) !== input.deployment.collateralMint
    || String(decoded.resolver) !== manifest.resolver
    || String(decoded.vault) !== manifest.vault
    || String(decoded.feeRecipient) !== input.deployment.feeRecipient
    || decoded.feeBps !== input.deployment.tradingFeeBps
    || decoded.bucketCount !== compiled.rules.engine.bucketCount
    || decoded.kernelVersion !== compiled.rules.engine.kernelVersion
    || decoded.jackpotBps !== compiled.rules.engine.targetJackpotBps
    || decoded.jackpotLeverageCap !== compiled.rules.engine.jackpotLeverageCap
  ) {
    throw new Error("Onchain curve accounts do not match the reviewed deployment manifest.");
  }
  verifyCurveAccounting(decoded);
}

async function fetchDecodedCurveMarket(
  deployment: ResolvedScarcityDeployment,
  slug: string,
) {
  const manifest = deployment.curveMarkets[slug];
  if (!manifest) return null;
  const response = await solanaRpcRequestFrom<{ value: RpcAccountData | null }>(
    scarcityRpcUrls(deployment.cluster),
    "getAccountInfo",
    [manifest.market, { encoding: "base64", commitment: "confirmed" }],
    { id: `scarcity-curve-market-${slug}` },
  );
  if (!response.value) throw new Error(`Deployed curve market account ${manifest.market} does not exist.`);
  assertProgramOwnedAccount(response.value, `Deployed curve market account ${manifest.market}`);
  const decoded = decodeCurveMarketAccount(decodeRpcData(response.value, CURVE_MARKET_ACCOUNT_SIZE, `Curve market ${manifest.market}`));
  if (decoded.version !== 1) throw new Error(`Deployed curve market account ${manifest.market} uses an unsupported version.`);
  await verifyCurveCommitments({ slug, decoded, deployment });
  return decoded;
}

/**
 * Decode a superseded (retired) curve market account by address. Deliberately
 * skips verifyCurveCommitments: the committed rules are exactly why these
 * markets were retired, so a mismatch is expected, not an error. Used only by
 * the portfolio so holders see "superseded · refund pending" instead of their
 * position silently disappearing.
 */
async function fetchSupersededCurveMarket(
  deployment: ResolvedScarcityDeployment,
  key: string,
): Promise<DecodedCurveMarket | null> {
  const entry = deployment.supersededMarkets[key];
  if (!entry) return null;
  const response = await solanaRpcRequestFrom<{ value: RpcAccountData | null }>(
    scarcityRpcUrls(deployment.cluster),
    "getAccountInfo",
    [entry.market, { encoding: "base64", commitment: "confirmed" }],
    { id: `scarcity-curve-superseded-${key}` },
  );
  if (!response.value) return null;
  assertProgramOwnedAccount(response.value, `Superseded curve market account ${entry.market}`);
  const decoded = decodeCurveMarketAccount(decodeRpcData(response.value, CURVE_MARKET_ACCOUNT_SIZE, `Superseded curve market ${entry.market}`));
  if (decoded.version !== 1) throw new Error(`Superseded curve market account ${entry.market} uses an unsupported version.`);
  return decoded;
}

function curveMarketToPublic(market: DecodedCurveMarket): ScarcityCurveChainState["market"] {
  return {
    status: market.status,
    opensAt: market.opensAt.toString(),
    closesAt: market.closesAt.toString(),
    resolveAfter: market.resolveAfter.toString(),
    resolvedAt: market.resolvedAt.toString(),
    normalizedOutcome: market.normalizedOutcome,
    bucketCount: market.bucketCount,
    winningBucket: market.winningBucket,
    jackpotBps: market.jackpotBps,
    jackpotLeverageCap: market.jackpotLeverageCap,
    feeBps: market.feeBps,
    totalStaked: market.totalStaked.toString(),
    protocolFee: market.protocolFee.toString(),
    payoutPool: market.payoutPool.toString(),
    jackpotPool: market.jackpotPool.toString(),
    curvePool: market.curvePool.toString(),
    exactStake: market.exactStake.toString(),
    weightedStake: market.weightedStake.toString(),
    totalClaimed: market.totalClaimed.toString(),
    bucketStakes: market.bucketStakes.slice(0, market.bucketCount).map((stake) => stake.toString()),
    resolutionReportHash: market.resolutionReportHash,
  };
}

export async function getScarcityCurveMarketChainState(slug: string): Promise<ScarcityCurveChainState | null> {
  const deployment = await loadScarcityDeployment();
  const resolved = await resolveStoredCurveMarket(slug);
  const compiledSlug = resolved?.compiled.slug ?? slug;
  const deployed = deployment?.curveMarkets[compiledSlug];
  if (!deployment || !deployed) return null;
  const config = await verifyDeploymentConfig(deployment);
  const market = await fetchDecodedCurveMarket(deployment, compiledSlug);
  if (!market) return null;
  return {
    deployment: {
      cluster: deployment.cluster,
      programAddress: deployment.programAddress,
      collateralMint: deployment.collateralMint,
      feeRecipient: deployment.feeRecipient,
      tradingFeeBps: deployment.tradingFeeBps,
      currentResolver: deployment.resolver,
      paused: config.paused,
      market: deployed.market,
      vault: deployed.vault,
      resolver: deployed.resolver,
      creationSignature: deployed.creationSignature,
    },
    market: curveMarketToPublic(market),
    asOf: new Date().toISOString(),
  };
}

export async function getScarcityCurvePortfolio(ownerValue: string): Promise<ScarcityCurvePortfolio> {
  const owner = address(ownerValue);
  const deployment = await loadScarcityDeployment();
  if (!deployment) {
    return {
      deployment: null,
      positions: [],
      totals: { totalStaked: "0", claimable: "0" },
      asOf: new Date().toISOString(),
    };
  }
  const config = await verifyDeploymentConfig(deployment);
  const marketEntries = await Promise.all(
    Object.keys(deployment.curveMarkets).map(async (slug) => [slug, await fetchDecodedCurveMarket(deployment, slug)] as const),
  );
  const supersededEntries = await Promise.all(
    Object.keys(deployment.supersededMarkets).map(async (key) => {
      const decoded = await fetchSupersededCurveMarket(deployment, key);
      return decoded ? [key, decoded] as const : null;
    }),
  );
  if (marketEntries.length === 0 && supersededEntries.length === 0) {
    return {
      deployment: {
        cluster: deployment.cluster,
        programAddress: deployment.programAddress,
        collateralMint: deployment.collateralMint,
        paused: config.paused,
      },
      positions: [],
      totals: { totalStaked: "0", claimable: "0" },
      asOf: new Date().toISOString(),
    };
  }
  const positionAccounts = await solanaRpcRequestFrom<ProgramAccount[]>(
    scarcityRpcUrls(deployment.cluster),
    "getProgramAccounts",
    [String(SCARCITY_EXCHANGE_PROGRAM_ADDRESS), {
      encoding: "base64",
      commitment: "confirmed",
      filters: [
        { dataSize: CURVE_POSITION_ACCOUNT_SIZE },
        { memcmp: { offset: 0, bytes: curvePositionDiscriminatorBase64(), encoding: "base64" } },
        { memcmp: { offset: CURVE_POSITION_OWNER_OFFSET, bytes: base64Address(String(owner)), encoding: "base64" } },
      ],
    }],
    { id: "scarcity-curve-portfolio", timeoutMs: 12_000 },
  );
  const marketByAddress = new Map<string, { slug: string; market: DecodedCurveMarket }>();
  for (const [slug, market] of marketEntries) {
    if (market) marketByAddress.set(deployment.curveMarkets[slug].market, { slug, market });
  }
  const supersededByAddress = new Map<string, { key: string; market: DecodedCurveMarket; reason: string }>();
  for (const entry of supersededEntries) {
    if (!entry) continue;
    const address = deployment.supersededMarkets[entry[0]].market;
    supersededByAddress.set(address, { key: entry[0], market: entry[1], reason: deployment.supersededMarkets[entry[0]].reason });
  }
  const positions: ScarcityCurvePortfolio["positions"] = [];
  for (const candidate of positionAccounts) {
    assertProgramOwnedAccount(candidate.account, `Curve position ${candidate.pubkey}`);
    const position = decodeCurvePositionAccount(decodeRpcData(candidate.account, CURVE_POSITION_ACCOUNT_SIZE, `Curve position ${candidate.pubkey}`));
    if (position.version !== 1) throw new Error(`Curve position ${candidate.pubkey} uses an unsupported version.`);
    if (String(position.owner) !== String(owner)) throw new Error(`Curve position ${candidate.pubkey} belongs to another owner.`);
    const entry = marketByAddress.get(String(position.market));
    const superseded = !entry ? supersededByAddress.get(String(position.market)) : undefined;
    if (!entry && !superseded) continue;
    const activeMarket = entry?.market ?? superseded!.market;
    const activeSlug = entry?.slug ?? superseded!.key;
    if (position.bucket >= activeMarket.bucketCount) throw new Error(`Curve position ${candidate.pubkey} uses an invalid bucket.`);
    const [expectedPosition] = await deriveCurvePositionAddress({
      market: position.market,
      owner: position.owner,
      bucket: position.bucket,
    });
    if (String(expectedPosition) !== candidate.pubkey) {
      throw new Error(`Curve position ${candidate.pubkey} is not the canonical owner/market/bucket PDA.`);
    }
    if (position.stake === 0n && position.payout === 0n) continue;
    positions.push({
      slug: activeSlug,
      market: String(position.market),
      bucket: position.bucket,
      stake: position.stake.toString(),
      payout: position.payout.toString(),
      claimable: calculateCurvePositionClaimable(activeMarket, position).toString(),
      claimed: position.claimed,
      status: activeMarket.status,
      winningBucket: activeMarket.winningBucket,
      normalizedOutcome: activeMarket.normalizedOutcome,
      bucketCount: activeMarket.bucketCount,
      ...(superseded ? { superseded: true, note: superseded.reason } : {}),
    });
  }
  positions.sort((left, right) => left.slug.localeCompare(right.slug) || left.bucket - right.bucket);
  const totalStaked = positions.reduce((total, position) => total + BigInt(position.stake), 0n);
  const claimable = positions.reduce((total, position) => total + BigInt(position.claimable), 0n);
  return {
    deployment: {
      cluster: deployment.cluster,
      programAddress: deployment.programAddress,
      collateralMint: deployment.collateralMint,
      paused: config.paused,
    },
    positions,
    totals: { totalStaked: totalStaked.toString(), claimable: claimable.toString() },
    asOf: new Date().toISOString(),
  };
}
