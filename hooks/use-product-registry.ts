"use client";

import { useQuery } from "@tanstack/react-query";
import type { RegistryHealth } from "@/lib/execution-types";
import { isSolanaExecutionProduct } from "@/lib/product-registry";

async function fetchRegistryHealth(productId: string) {
  const response = await fetch(`/api/registry?productId=${encodeURIComponent(productId)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Registry validation is unavailable.");
  }
  return (await response.json()) as RegistryHealth;
}

export function useProductRegistry(productId: string) {
  return useQuery({
    queryKey: ["product-registry", productId],
    queryFn: () => fetchRegistryHealth(productId),
    enabled: isSolanaExecutionProduct(productId),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
}
