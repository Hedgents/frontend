"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { RouteComparisonResponse, TradeSide } from "@/lib/execution-types";
import type { SettlementAssetId } from "@/lib/product-registry";

interface RouteComparisonOptions {
  side?: TradeSide;
  settlementAssetIds?: SettlementAssetId[];
  enabled?: boolean;
}

async function fetchRouteComparison(
  productIds: string[],
  amount: string,
  side: TradeSide,
  settlementAssetIds: SettlementAssetId[],
) {
  const response = await fetch("/api/execution/compare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      productIds,
      side,
      settlementAssetIds,
      ...(side === "buy" ? { amountUsd: amount } : { amountToken: amount }),
    }),
  });
  const payload = (await response.json()) as RouteComparisonResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Live route comparison is unavailable.");
  return payload;
}

export function useRouteComparison(
  productIds: string[],
  amount: string,
  options: RouteComparisonOptions = {},
) {
  const side = options.side ?? "buy";
  const settlementAssetIds = options.settlementAssetIds ?? ["usdc"];
  const settlementKey = settlementAssetIds.join(",");
  const stableSettlementAssetIds = useMemo(
    () => settlementKey.split(",").filter(Boolean) as SettlementAssetId[],
    [settlementKey],
  );
  const [debouncedAmount, setDebouncedAmount] = useState(amount);
  const productKey = productIds.join(",");
  const stableProductIds = useMemo(() => productKey.split(",").filter(Boolean), [productKey]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedAmount(amount), 450);
    return () => window.clearTimeout(timeout);
  }, [amount]);

  const numericAmount = Number(debouncedAmount);
  return useQuery({
    queryKey: ["route-comparison", side, productKey, settlementKey, debouncedAmount],
    queryFn: () => fetchRouteComparison(
      stableProductIds,
      debouncedAmount,
      side,
      stableSettlementAssetIds,
    ),
    enabled: options.enabled !== false && stableProductIds.length > 0 && Number.isFinite(numericAmount) && numericAmount > 0,
    staleTime: 8_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}
