"use client";

import { useQuery } from "@tanstack/react-query";
import type { PortfolioSnapshot } from "@/lib/execution-types";

async function fetchPortfolio(owner: string) {
  const response = await fetch(`/api/portfolio?owner=${encodeURIComponent(owner)}`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as PortfolioSnapshot & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Portfolio indexing is unavailable.");
  return payload;
}

export function usePortfolio(owner: string | null) {
  return useQuery({
    queryKey: ["solana-portfolio", owner],
    queryFn: () => fetchPortfolio(owner!),
    enabled: Boolean(owner),
    refetchInterval: 15_000,
    staleTime: 8_000,
    retry: 1,
  });
}
