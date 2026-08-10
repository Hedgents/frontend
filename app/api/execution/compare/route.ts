import { NextResponse } from "next/server";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { requireInviteAccess } from "@/lib/access-auth";
import type {
  ProductRouteComparison,
  RouteComparisonResponse,
  TradeSide,
} from "@/lib/execution-types";
import {
  ExecutionValidationError,
  normalizeJupiterPriceImpact,
  parseDecimalToBaseUnits,
  parseTokenAmountToBaseUnits,
} from "@/lib/execution-validation";
import { getJupiterOrder } from "@/lib/jupiter-server";
import {
  assertUsdBaseUnitAmountWithinBetaCap,
  effectiveBuyMaximumUsd,
  requireNewExecutionEnabled,
} from "@/lib/execution-controls";
import { classifyRouteAvailability } from "@/lib/route-availability";
import {
  getSolanaExecutionProduct,
  getSolanaSettlementAsset,
  solanaSettlementAssets,
  type SolanaSettlementAsset,
  type SolanaExecutionProduct,
} from "@/lib/product-registry";

export const dynamic = "force-dynamic";

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function recordField(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unavailableRoute(
  product: SolanaExecutionProduct,
  settlementAsset: SolanaSettlementAsset,
  side: TradeSide,
  inputAmount: string,
  error: unknown,
): ProductRouteComparison {
  const isBuy = side === "buy";
  return {
    productId: product.productId,
    side,
    settlementAssetId: settlementAsset.id,
    symbol: product.symbol,
    comparisonGroup: product.execution.comparisonGroup,
    available: false,
    availabilityReason: classifyRouteAvailability(error),
    inputAmount,
    inputMint: isBuy ? settlementAsset.mint : product.mint,
    inputDecimals: isBuy ? settlementAsset.decimals : product.decimals,
    outputAmount: null,
    outputMint: isBuy ? product.mint : settlementAsset.mint,
    outputDecimals: isBuy ? product.decimals : settlementAsset.decimals,
    minimumOutputAmount: null,
    router: null,
    priceImpactPct: null,
    feeBps: null,
    feeMint: null,
    error: error instanceof Error ? error.message : "No executable route is available at this size.",
    checkedAt: new Date().toISOString(),
  };
}

async function compareProduct(
  product: SolanaExecutionProduct,
  settlementAsset: SolanaSettlementAsset,
  side: TradeSide,
  amount: unknown,
  betaMaximumUsd: number,
): Promise<ProductRouteComparison> {
  let inputAmount = "0";
  const isBuy = side === "buy";
  const inputMint = isBuy ? settlementAsset.mint : product.mint;
  const outputMint = isBuy ? product.mint : settlementAsset.mint;
  const inputDecimals = isBuy ? settlementAsset.decimals : product.decimals;
  const outputDecimals = isBuy ? product.decimals : settlementAsset.decimals;
  try {
    inputAmount = isBuy
      ? parseDecimalToBaseUnits(
          amount,
          settlementAsset.decimals,
          product.execution.minimumUsd,
          effectiveBuyMaximumUsd(product.execution.maximumUsd, betaMaximumUsd),
        )
      : parseTokenAmountToBaseUnits(amount, product.decimals, product.symbol);
    const raw = await getJupiterOrder(new URLSearchParams({
      inputMint,
      outputMint,
      amount: inputAmount,
    }));
    const outputAmount = nullableString(raw.outAmount);
    const minimumOutputAmount = nullableString(raw.otherAmountThreshold) ?? outputAmount;
    if (
      nullableString(raw.inputMint) !== inputMint ||
      nullableString(raw.outputMint) !== outputMint ||
      nullableString(raw.inAmount) !== inputAmount
    ) {
      throw new ExecutionValidationError("The router returned an unexpected asset or amount.", 502);
    }
    if (
      !outputAmount || !minimumOutputAmount ||
      !/^\d+$/.test(outputAmount) || !/^\d+$/.test(minimumOutputAmount) ||
      BigInt(outputAmount) <= 0n || BigInt(minimumOutputAmount) <= 0n ||
      BigInt(minimumOutputAmount) > BigInt(outputAmount)
    ) {
      throw new ExecutionValidationError("The router returned no protected output at this size.");
    }
    if (!isBuy) {
      assertUsdBaseUnitAmountWithinBetaCap(outputAmount, settlementAsset.decimals, {
        enabled: true,
        maxUsd: betaMaximumUsd,
        rejectionOnly: false,
      });
    }
    const priceImpactPct = normalizeJupiterPriceImpact(raw);
    if (priceImpactPct === null) {
      throw new ExecutionValidationError("The router did not report price impact.", 502);
    }
    if (priceImpactPct > product.execution.maximumPriceImpactPct) {
      throw new ExecutionValidationError(
        `${priceImpactPct.toFixed(2)}% price impact exceeds the ${product.execution.maximumPriceImpactPct}% guardrail.`,
      );
    }
    const platformFee = recordField(raw, "platformFee");
    return {
      productId: product.productId,
      side,
      settlementAssetId: settlementAsset.id,
      symbol: product.symbol,
      comparisonGroup: product.execution.comparisonGroup,
      available: true,
      availabilityReason: "available",
      inputAmount,
      inputMint,
      inputDecimals,
      outputAmount,
      outputMint,
      outputDecimals,
      minimumOutputAmount,
      router: nullableString(raw.router) ?? "Jupiter Meta Aggregator",
      priceImpactPct,
      feeBps: nullableNumber(raw.feeBps) ?? (platformFee ? nullableNumber(platformFee.feeBps) : null),
      feeMint: nullableString(raw.feeMint) ?? (platformFee ? nullableString(platformFee.feeMint) : null),
      error: null,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return unavailableRoute(product, settlementAsset, side, inputAmount, error);
  }
}

export async function POST(request: Request) {
  let responseHeaders: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    const executionControls = requireNewExecutionEnabled();
    responseHeaders = secureMutation(request, { key: "execution-compare", limit: 40, windowMs: 60_000 }).headers;
    const body = await readJsonBody(request, 16_384);
    const side: TradeSide = body.side === "sell" ? "sell" : "buy";
    const productIds = Array.isArray(body.productIds)
      ? [...new Set(body.productIds.filter((value): value is string => typeof value === "string"))]
      : [];
    if (productIds.length === 0 || productIds.length > 8) {
      throw new ExecutionValidationError("Compare between one and eight activated products.");
    }
    const products = productIds.map((productId) => getSolanaExecutionProduct(productId));
    if (products.some((product) => product === null)) {
      throw new ExecutionValidationError("The comparison contains an inactive product adapter.");
    }
    const settlementAssetIds = side === "buy"
      ? ["usdc"]
      : Array.isArray(body.settlementAssetIds)
        ? [...new Set(body.settlementAssetIds.filter((value): value is string => typeof value === "string"))]
        : Object.keys(solanaSettlementAssets);
    if (side === "sell" && productIds.length !== 1) {
      throw new ExecutionValidationError("Compare stablecoin settlement for one metal product at a time.");
    }
    if (settlementAssetIds.length === 0 || settlementAssetIds.length > 3) {
      throw new ExecutionValidationError("Choose between one and three supported settlement assets.");
    }
    const settlementAssets = settlementAssetIds.map((assetId) => getSolanaSettlementAsset(assetId));
    if (settlementAssets.some((asset) => asset === null)) {
      throw new ExecutionValidationError("The comparison contains an unsupported settlement asset.");
    }
    const amount = side === "buy" ? body.amountUsd : body.amountToken;
    const routes = await Promise.all(
      (products as SolanaExecutionProduct[]).flatMap((product) =>
        (settlementAssets as SolanaSettlementAsset[]).map((asset) =>
          compareProduct(product, asset, side, amount, executionControls.maxUsd),
        ),
      ),
    );
    const payload: RouteComparisonResponse = {
      side,
      amount: typeof amount === "string" ? amount : "",
      amountUsd: side === "buy" && typeof body.amountUsd === "string" ? body.amountUsd : "",
      checkedAt: new Date().toISOString(),
      routes,
    };
    return NextResponse.json(payload, { headers: { ...responseHeaders, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    const status = security?.status ?? (error instanceof ExecutionValidationError ? error.status : 500);
    const message = error instanceof Error ? error.message : "Live route comparison is unavailable.";
    return NextResponse.json(
      { error: message },
      { status, headers: { ...responseHeaders, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
