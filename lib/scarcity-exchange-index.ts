import "server-only";
import { address, getAddressEncoder, type Address } from "@solana/kit";
import {
  decodeExchangeConfigAccount,
  decodeLimitOrderAccount,
  decodeScarcityMarketAccount,
  deriveConfigAddress,
  limitOrderDiscriminatorBase64,
  SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
  SCARCITY_ORDER_ACCOUNT_SIZE,
  SCARCITY_ORDER_MAKER_OFFSET,
  SCARCITY_ORDER_MARKET_OFFSET,
  TOKEN_PROGRAM_ADDRESS,
  type DecodedLimitOrder,
  type DecodedScarcityMarket,
} from "@/lib/scarcity-exchange";
import {
  loadScarcityDeployment,
  scarcityRpcUrls,
  type ResolvedScarcityDeployment,
} from "@/lib/scarcity-deployment";
import { getStoredScarcityMarket } from "@/lib/scarcity-market-store";
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

export interface PublicScarcityOrder {
  address: string;
  maker: string;
  side: "bid" | "ask";
  outcome: "yes" | "no";
  orderId: string;
  priceMicroUsdc: string;
  originalQuantity: string;
  remainingQuantity: string;
  quoteFilled: string;
  feePaid: string;
  feeBps: number;
  expiresAt: string;
  state?: "open" | "expired" | "filled";
}

export interface ScarcityMarketChainState {
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
    yesMint: string;
    noMint: string;
    vault: string;
    creationSignature: string;
  };
  market: {
    status: DecodedScarcityMarket["status"];
    opensAt: string;
    closesAt: string;
    resolveAfter: string;
    resolvedAt: string;
    openInterest: string;
    totalRedeemed: string;
    resolutionReportHash: string;
  };
  orders: PublicScarcityOrder[];
  asOf: string;
}

const addressEncoder = getAddressEncoder();

function decodeRpcData(account: RpcAccountData) {
  if (!Array.isArray(account.data) || account.data[1] !== "base64") {
    throw new Error("Solana RPC returned an unsupported account encoding.");
  }
  return Uint8Array.from(Buffer.from(account.data[0], "base64"));
}

function assertProgramOwnedAccount(account: RpcAccountData, label: string) {
  if (account.owner !== String(SCARCITY_EXCHANGE_PROGRAM_ADDRESS) || account.executable) {
    throw new Error(`${label} is not a non-executable account owned by the reviewed scarcity program.`);
  }
}

async function verifyDeploymentConfig(deployment: ResolvedScarcityDeployment) {
  const [configAddress] = await deriveConfigAddress();
  const response = await solanaRpcRequestFrom<{ value: RpcAccountData | null }>(
    scarcityRpcUrls(deployment.cluster),
    "getAccountInfo",
    [String(configAddress), { encoding: "base64", commitment: "confirmed" }],
    { id: "scarcity-config" },
  );
  if (!response.value) throw new Error("The scarcity exchange config account does not exist.");
  assertProgramOwnedAccount(response.value, "Scarcity exchange config");
  const config = decodeExchangeConfigAccount(decodeRpcData(response.value));
  if (
    config.version !== 1 ||
    String(config.admin) !== deployment.admin ||
    String(config.resolver) !== deployment.resolver ||
    String(config.collateralMint) !== deployment.collateralMint ||
    String(config.feeRecipient) !== deployment.feeRecipient ||
    config.tradingFeeBps !== deployment.tradingFeeBps
  ) {
    throw new Error("Onchain scarcity configuration does not match the reviewed deployment manifest.");
  }
  return config;
}

function base64Address(value: string) {
  return Buffer.from(addressEncoder.encode(address(value))).toString("base64");
}

function orderToPublic(
  accountAddress: string,
  order: DecodedLimitOrder,
  market: DecodedScarcityMarket,
): PublicScarcityOrder {
  const outcome = order.outcomeMint === market.yesMint
    ? "yes"
    : order.outcomeMint === market.noMint ? "no" : null;
  if (!outcome) throw new Error(`Order ${accountAddress} references an unknown outcome mint.`);
  return {
    address: accountAddress,
    maker: String(order.maker),
    side: order.side,
    outcome,
    orderId: order.orderId,
    priceMicroUsdc: order.priceMicroUsdc.toString(),
    originalQuantity: order.originalQuantity.toString(),
    remainingQuantity: order.remainingQuantity.toString(),
    quoteFilled: order.quoteFilled.toString(),
    feePaid: order.feePaid.toString(),
    feeBps: order.feeBps,
    expiresAt: order.expiresAt.toString(),
  };
}

async function verifyMarketCommitments(input: {
  slug: string;
  decoded: DecodedScarcityMarket;
  deployment: ResolvedScarcityDeployment;
}) {
  const catalog = await getStoredScarcityMarket(input.slug);
  const manifest = input.deployment.markets[input.slug];
  if (!catalog || !manifest) throw new Error("The scarcity market is not present in the deployment manifest.");
  const decoded = input.decoded;
  const [configAddress] = await deriveConfigAddress();
  if (
    decoded.marketId !== catalog.marketId ||
    decoded.questionHash !== catalog.questionHash ||
    decoded.rulesHash !== catalog.rulesHash
  ) {
    throw new Error("Onchain market commitments do not match the published canonical documents.");
  }
  if (
    String(decoded.config) !== String(configAddress) ||
    String(decoded.creator) !== input.deployment.admin ||
    String(decoded.collateralMint) !== input.deployment.collateralMint ||
    String(decoded.resolver) !== manifest.resolver ||
    String(decoded.yesMint) !== manifest.yesMint ||
    String(decoded.noMint) !== manifest.noMint ||
    String(decoded.vault) !== manifest.vault
  ) {
    throw new Error("Onchain market accounts do not match the deployment manifest.");
  }
}

function verifyOrderCommitments(
  accountAddress: string,
  order: DecodedLimitOrder,
  deployment: ResolvedScarcityDeployment,
) {
  if (
    String(order.collateralMint) !== deployment.collateralMint ||
    String(order.feeRecipient) !== deployment.feeRecipient
  ) {
    throw new Error(`Order ${accountAddress} does not match the reviewed deployment configuration.`);
  }
}

async function fetchDecodedMarket(
  deployment: ResolvedScarcityDeployment,
  slug: string,
) {
  const manifest = deployment.markets[slug];
  if (!manifest) return null;
  const endpoints = scarcityRpcUrls(deployment.cluster);
  const response = await solanaRpcRequestFrom<{ value: RpcAccountData | null }>(
    endpoints,
    "getAccountInfo",
    [manifest.market, { encoding: "base64", commitment: "confirmed" }],
    { id: `scarcity-market-${slug}` },
  );
  if (!response.value) throw new Error(`Deployed market account ${manifest.market} does not exist.`);
  assertProgramOwnedAccount(response.value, `Deployed market account ${manifest.market}`);
  const decoded = decodeScarcityMarketAccount(decodeRpcData(response.value));
  if (decoded.version !== 1) throw new Error(`Deployed market account ${manifest.market} uses an unsupported version.`);
  await verifyMarketCommitments({ slug, decoded, deployment });
  return decoded;
}

async function fetchOrdersForMarket(
  deployment: ResolvedScarcityDeployment,
  marketAddress: string,
) {
  const endpoints = scarcityRpcUrls(deployment.cluster);
  return solanaRpcRequestFrom<ProgramAccount[]>(
    endpoints,
    "getProgramAccounts",
    [String(SCARCITY_EXCHANGE_PROGRAM_ADDRESS), {
      encoding: "base64",
      commitment: "confirmed",
      filters: [
        { dataSize: SCARCITY_ORDER_ACCOUNT_SIZE },
        { memcmp: { offset: 0, bytes: limitOrderDiscriminatorBase64(), encoding: "base64" } },
        { memcmp: { offset: SCARCITY_ORDER_MARKET_OFFSET, bytes: base64Address(marketAddress), encoding: "base64" } },
      ],
    }],
    { id: `scarcity-orders-${marketAddress}`, timeoutMs: 12_000 },
  );
}

export async function getScarcityMarketChainState(slug: string): Promise<ScarcityMarketChainState | null> {
  const deployment = await loadScarcityDeployment();
  const deployed = deployment?.markets[slug];
  if (!deployment || !deployed) return null;
  const config = await verifyDeploymentConfig(deployment);
  const market = await fetchDecodedMarket(deployment, slug);
  if (!market) return null;
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const orders = (await fetchOrdersForMarket(deployment, deployed.market))
    .map((candidate) => ({
      address: candidate.pubkey,
      order: (() => {
        assertProgramOwnedAccount(candidate.account, `Order ${candidate.pubkey}`);
        const decoded = decodeLimitOrderAccount(decodeRpcData(candidate.account));
        if (decoded.version !== 1) throw new Error(`Order ${candidate.pubkey} uses an unsupported version.`);
        verifyOrderCommitments(candidate.pubkey, decoded, deployment);
        return decoded;
      })(),
    }))
    .filter(({ order }) => order.remainingQuantity > 0n && order.expiresAt > now)
    .map(({ address: accountAddress, order }) => orderToPublic(accountAddress, order, market))
    .sort((left, right) => {
      if (left.outcome !== right.outcome) return left.outcome.localeCompare(right.outcome);
      if (left.side !== right.side) return left.side.localeCompare(right.side);
      const priceDelta = BigInt(left.priceMicroUsdc) - BigInt(right.priceMicroUsdc);
      if (priceDelta === 0n) return left.address.localeCompare(right.address);
      return left.side === "bid" ? (priceDelta > 0n ? -1 : 1) : (priceDelta > 0n ? 1 : -1);
    });
  return {
    deployment: {
      cluster: deployment.cluster,
      programAddress: deployment.programAddress,
      collateralMint: deployment.collateralMint,
      feeRecipient: deployment.feeRecipient,
      tradingFeeBps: deployment.tradingFeeBps,
      currentResolver: deployment.resolver,
      paused: config.paused,
      ...deployed,
    },
    market: {
      status: market.status,
      opensAt: market.opensAt.toString(),
      closesAt: market.closesAt.toString(),
      resolveAfter: market.resolveAfter.toString(),
      resolvedAt: market.resolvedAt.toString(),
      openInterest: market.openInterest.toString(),
      totalRedeemed: market.totalRedeemed.toString(),
      resolutionReportHash: market.resolutionReportHash,
    },
    orders,
    asOf: new Date().toISOString(),
  };
}

interface ParsedTokenAccount {
  account: {
    data: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: { amount?: string };
        };
      };
    };
  };
}

function ceilMulDiv(left: bigint, right: bigint, denominator: bigint) {
  return (left * right + denominator - 1n) / denominator;
}

export async function getScarcityPortfolio(ownerValue: string) {
  const owner = address(ownerValue);
  const deployment = await loadScarcityDeployment();
  if (!deployment) return { deployment: null, positions: [], orders: [], totals: { openOrders: 0, collateralBalance: "0", usdcEscrow: "0", claimable: "0" }, asOf: new Date().toISOString() };
  const config = await verifyDeploymentConfig(deployment);
  const endpoints = scarcityRpcUrls(deployment.cluster);
  const [tokenResponse, orderAccounts, marketEntries] = await Promise.all([
    solanaRpcRequestFrom<{ value: ParsedTokenAccount[] }>(endpoints, "getTokenAccountsByOwner", [
      String(owner),
      { programId: String(TOKEN_PROGRAM_ADDRESS) },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ], { id: "scarcity-portfolio-tokens" }),
    solanaRpcRequestFrom<ProgramAccount[]>(endpoints, "getProgramAccounts", [
      String(SCARCITY_EXCHANGE_PROGRAM_ADDRESS),
      {
        encoding: "base64",
        commitment: "confirmed",
        filters: [
          { dataSize: SCARCITY_ORDER_ACCOUNT_SIZE },
          { memcmp: { offset: 0, bytes: limitOrderDiscriminatorBase64(), encoding: "base64" } },
          { memcmp: { offset: SCARCITY_ORDER_MAKER_OFFSET, bytes: base64Address(String(owner)), encoding: "base64" } },
        ],
      },
    ], { id: "scarcity-portfolio-orders", timeoutMs: 12_000 }),
    Promise.all(Object.keys(deployment.markets).map(async (slug) => [slug, await fetchDecodedMarket(deployment, slug)] as const)),
  ]);

  const tokenBalances = new Map<string, bigint>();
  for (const candidate of tokenResponse.value) {
    const mint = candidate.account.data.parsed?.info?.mint;
    const amount = candidate.account.data.parsed?.info?.tokenAmount?.amount;
    if (mint && amount && /^\d+$/.test(amount)) {
      tokenBalances.set(mint, (tokenBalances.get(mint) ?? 0n) + BigInt(amount));
    }
  }
  const marketByAddress = new Map<string, { slug: string; market: DecodedScarcityMarket }>();
  for (const [slug, market] of marketEntries) {
    if (market) marketByAddress.set(deployment.markets[slug].market, { slug, market });
  }
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const orders = orderAccounts.map((candidate) => ({
    address: candidate.pubkey,
    decoded: (() => {
      assertProgramOwnedAccount(candidate.account, `Order ${candidate.pubkey}`);
      const decoded = decodeLimitOrderAccount(decodeRpcData(candidate.account));
      if (decoded.version !== 1) throw new Error(`Order ${candidate.pubkey} uses an unsupported version.`);
      verifyOrderCommitments(candidate.pubkey, decoded, deployment);
      return decoded;
    })(),
  }));
  let usdcEscrow = 0n;
  let openOrders = 0;
  const publicOrders = orders.flatMap(({ address: accountAddress, decoded }) => {
    const entry = marketByAddress.get(String(decoded.market));
    if (!entry) return [];
    const state = decoded.remainingQuantity === 0n ? "filled" : decoded.expiresAt <= now ? "expired" : "open";
    if (state === "open") openOrders += 1;
    if (decoded.side === "bid") {
      const fullQuote = ceilMulDiv(decoded.originalQuantity, decoded.priceMicroUsdc, 1_000_000n);
      const fullFee = decoded.feeBps === 0 ? 0n : ceilMulDiv(fullQuote, BigInt(decoded.feeBps), 10_000n);
      usdcEscrow += fullQuote + fullFee - decoded.quoteFilled - decoded.feePaid;
    }
    return [{ slug: entry.slug, ...orderToPublic(accountAddress, decoded, entry.market), state }];
  });
  let claimable = 0n;
  const positions = marketEntries.flatMap(([slug, market]) => {
    if (!market) return [];
    const yes = tokenBalances.get(String(market.yesMint)) ?? 0n;
    const no = tokenBalances.get(String(market.noMint)) ?? 0n;
    const claim = market.status === "resolved-yes"
      ? yes
      : market.status === "resolved-no" ? no : market.status === "invalid" ? (yes + no) / 2n : 0n;
    claimable += claim;
    return [{ slug, yes: yes.toString(), no: no.toString(), claimable: claim.toString(), status: market.status }];
  });
  return {
    deployment: { cluster: deployment.cluster, programAddress: deployment.programAddress, collateralMint: deployment.collateralMint, paused: config.paused },
    positions,
    orders: publicOrders,
    totals: {
      openOrders,
      collateralBalance: (tokenBalances.get(deployment.collateralMint) ?? 0n).toString(),
      usdcEscrow: usdcEscrow.toString(),
      claimable: claimable.toString(),
    },
    asOf: new Date().toISOString(),
  };
}
