"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MetalQuoteResponse } from "@/lib/quote-types";

export function useMetalQuotes() {
  const [data, setData] = useState<MetalQuoteResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/quotes", {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as MetalQuoteResponse;
      setData(payload);
      setError(response.ok ? null : payload.providerMessage ?? "Live quote feed unavailable");
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "Live quote feed unavailable");
    } finally {
      if (activeRequest.current === controller) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    const refreshOnFocus = () => void refresh();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
      activeRequest.current?.abort();
    };
  }, [refresh]);

  return { data, error, isLoading, isRefreshing, refresh };
}
