import type { SettlementAssetId } from "@/lib/product-registry";
import type { RouteAvailabilityReason } from "@/lib/route-availability";

export type TradeSide = "buy" | "sell";
export type ExecutionSubmissionState = "submitted" | "not-submitted" | "unknown";

export interface JupiterOrderQuote {
  productId: string;
  side: TradeSide;
  settlementAssetId: SettlementAssetId;
  requestId: string;
  authorization: string;
  recoveryAuthorization: string;
  transaction: string;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  minimumOutputAmount: string;
  inputDecimals: number;
  outputDecimals: number;
  router: string;
  slippageBps: number | null;
  priceImpactPct: number | null;
  feeBps: number | null;
  feeMint: string | null;
  lastValidBlockHeight: number | null;
  expiresAt: string | null;
  simulated: true;
  simulationUnitsConsumed: number | null;
  quotedAt: string;
}

export interface JupiterExecutionResult {
  status: "Success" | "Failed" | "Pending";
  submissionState?: ExecutionSubmissionState;
  signature: string | null;
  code: number | null;
  error: string | null;
  inputAmount: string | null;
  outputAmount: string | null;
  settlement: SettlementVerification | null;
}

export interface SettlementVerification {
  status: "verified" | "pending" | "failed";
  errorCode?: "expired_unlanded" | "transaction_failed" | "verification_failed";
  receivedAmount: string | null;
  expectedMinimumAmount: string;
  verifiedAt: string | null;
  error: string | null;
}

export interface ProductRouteComparison {
  productId: string;
  side: TradeSide;
  settlementAssetId: SettlementAssetId;
  symbol: string;
  comparisonGroup: string;
  available: boolean;
  availabilityReason: RouteAvailabilityReason;
  inputAmount: string;
  inputMint: string;
  inputDecimals: number;
  outputAmount: string | null;
  outputMint: string;
  outputDecimals: number;
  minimumOutputAmount: string | null;
  router: string | null;
  priceImpactPct: number | null;
  feeBps: number | null;
  feeMint: string | null;
  error: string | null;
  checkedAt: string;
}

export interface RouteComparisonResponse {
  side: TradeSide;
  amount: string;
  amountUsd: string;
  checkedAt: string;
  routes: ProductRouteComparison[];
}

export interface RegistryHealth {
  productId: string;
  checkedAt: string;
  identity: {
    status: "verified" | "failed" | "unavailable";
    mint: string;
    symbol: string | null;
    decimals: number | null;
    tokenProgram: string | null;
    directoryVerified: boolean;
  };
  onchain: {
    status: "verified" | "failed" | "unavailable";
    accountExists: boolean;
    owner: string | null;
  };
  controls: {
    mintAuthority: string | null;
    freezeAuthority: string | null;
    permanentDelegate: string | null;
    note: string;
  };
  liquidity: {
    status: "verified" | "failed" | "configuration-required" | "unavailable";
    directoryLiquidityUsd: number | null;
    probeInputUsd: number;
    probeOutputAmount: string | null;
    impliedUnitPriceUsd: number | null;
    note: string;
  };
  ready: boolean;
}

export interface ExecutionRecord {
  id: string;
  productId: string;
  metal: string;
  ticker: string;
  side?: TradeSide;
  settlementAssetId?: SettlementAssetId;
  inputUsd?: number;
  inputAmount?: string;
  inputDecimals?: number;
  inputSymbol?: string;
  outputAmount: string | null;
  outputDecimals?: number;
  outputSymbol?: string;
  source: string;
  destination: string;
  status: "Success" | "Failed" | "Pending";
  submissionState?: ExecutionSubmissionState;
  walletSigned?: boolean;
  signature: string | null;
  timestamp: string;
  requestId?: string;
  recoveryAuthorization?: string;
  router?: string;
  priceImpactPct?: number | null;
  minimumOutputAmount?: string;
  lastValidBlockHeight?: number | null;
  error?: string | null;
  errorCode?: string | null;
  settlement?: SettlementVerification | null;
  eligibilityAcknowledged?: boolean;
}

export interface PortfolioAssetBalance {
  kind: "metal" | "stablecoin";
  productId: string | null;
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  tokenProgram: "Token-2022" | "SPL Token";
  rawAmount: string;
  amount: string;
}

export interface PortfolioSnapshot {
  owner: string;
  checkedAt: string;
  balances: PortfolioAssetBalance[];
}

export interface PortfolioAccountingPosition {
  productId: string;
  coveredUnits: number;
  walletUnits: number;
  averageCostUsd: number | null;
  costBasisUsd: number;
  marketValueUsd: number | null;
  unrealizedPnlUsd: number | null;
  realizedPnlUsd: number;
  coverage: "complete" | "partial" | "none";
}
