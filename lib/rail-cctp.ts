import { RailClient, type FundingIntent, type IntentQuote } from "@hedgents/stablecoin-rail";
import {
  BASE_MAINNET,
  createCctpToSolana,
  ETHEREUM_MAINNET,
  SOLANA_MAINNET,
  type CctpSourceChain,
} from "@hedgents/stablecoin-rail-cctp";
import { parseDecimalToBaseUnits, validateSolanaAddress } from "./execution-validation";

export const CCTP_PROVIDER_ID = "circle-cctp-v2-solana";
export const CCTP_USDC_DECIMALS = 6;

/**
 * The CCTP plugin calls Circle's attestation service directly from the browser. The terminal's
 * page CSP is an explicit allowlist, so this origin has to appear in `connect-src` or the
 * documented "resume an already-broadcast source burn" path fails with a blocked fetch.
 * Keep this in sync with the plugin's default API base URL.
 */
export const CCTP_ATTESTATION_ORIGIN = "https://iris-api.circle.com";

export type CctpSourceId = "ethereum" | "base";

export interface CctpSourceDefinition {
  id: CctpSourceId;
  label: string;
  chain: CctpSourceChain;
  explorerUrl: string;
  status: "mainnet-canary" | "alpha";
  disclosure: string;
}

export const CCTP_SOURCES: Record<CctpSourceId, CctpSourceDefinition> = {
  ethereum: {
    id: "ethereum",
    label: "Ethereum",
    chain: ETHEREUM_MAINNET,
    explorerUrl: "https://etherscan.io/tx/",
    status: "mainnet-canary",
    disclosure:
      "Ethereum → Solana has completed a small-value mainnet canary. The SDK remains unaudited alpha software.",
  },
  base: {
    id: "base",
    label: "Base",
    chain: BASE_MAINNET,
    explorerUrl: "https://basescan.org/tx/",
    status: "alpha",
    disclosure:
      "Base is supported by the CCTP adapter but has not yet completed the SDK's published mainnet canary gate.",
  },
};

const solanaRpcUrl =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

let client: RailClient | null = null;

export function getCctpRailClient() {
  if (!client) {
    client = new RailClient({
      fundingProviders: [
        createCctpToSolana({
          sources: [ETHEREUM_MAINNET, BASE_MAINNET],
          solana: SOLANA_MAINNET,
          rpcUrl: solanaRpcUrl,
        }),
      ],
    });
  }
  return client;
}

export function buildCctpFundingIntent(input: {
  id: string;
  sourceId: CctpSourceId;
  sourceAddress: string;
  destinationAddress: string;
  amountUsd: string;
}): FundingIntent {
  const source = CCTP_SOURCES[input.sourceId].chain;
  const sourceAddress = input.sourceAddress.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(sourceAddress)) {
    throw new Error("Connect a valid EVM source wallet.");
  }

  const destinationAddress = validateSolanaAddress(input.destinationAddress);
  const inputAmountBaseUnits = parseDecimalToBaseUnits(
    input.amountUsd,
    CCTP_USDC_DECIMALS,
    10,
    10_000,
  );

  return {
    id: input.id,
    source: {
      account: {
        chainId: source.chainId,
        address: sourceAddress,
      },
      asset: {
        chainId: source.chainId,
        assetId: `${source.chainId}/erc20:${source.usdcAddress.toLowerCase()}`,
        symbol: "USDC",
        decimals: CCTP_USDC_DECIMALS,
      },
    },
    destination: {
      account: {
        chainId: SOLANA_MAINNET.chainId,
        address: destinationAddress,
      },
      settlementAsset: {
        chainId: SOLANA_MAINNET.chainId,
        assetId: `${SOLANA_MAINNET.chainId}/spl:${SOLANA_MAINNET.usdcMint}`,
        symbol: "USDC",
        decimals: CCTP_USDC_DECIMALS,
      },
    },
    inputAmountBaseUnits,
    slippageBps: 0,
    metadata: {
      application: "hedgents-terminal",
      purpose: "metal-purchase-funding",
    },
  };
}

export async function quoteCctpFunding(input: Parameters<typeof buildCctpFundingIntent>[0]) {
  const intent = buildCctpFundingIntent(input);
  const batch = await getCctpRailClient().quote(intent);
  const quote = batch.quotes.find(
    (candidate) => candidate.funding.providerId === CCTP_PROVIDER_ID,
  );
  if (quote) return quote;

  const failure = batch.failures.find((candidate) => candidate.pluginId === CCTP_PROVIDER_ID);
  throw new Error(failure?.message ?? "No CCTP route is available for this funding request.");
}

export function formatUsdcBaseUnits(value: string, maximumFractionDigits = 6) {
  const padded = value.padStart(CCTP_USDC_DECIMALS + 1, "0");
  const whole = padded.slice(0, -CCTP_USDC_DECIMALS) || "0";
  const fraction = padded
    .slice(-CCTP_USDC_DECIMALS)
    .replace(/0+$/, "")
    .slice(0, maximumFractionDigits);
  return fraction ? `${whole}.${fraction}` : whole;
}

export function totalCctpFeesBaseUnits(quote: IntentQuote) {
  return quote.funding.fees.reduce(
    (total, fee) => total + BigInt(fee.amount.amountBaseUnits),
    0n,
  ).toString();
}

export function sourceExplorerTransaction(sourceId: CctpSourceId, transactionId: string) {
  return `${CCTP_SOURCES[sourceId].explorerUrl}${transactionId}`;
}

export function solanaExplorerTransaction(transactionId: string) {
  return `https://solscan.io/tx/${transactionId}`;
}
