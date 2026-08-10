export type QuoteFreshness = "live" | "delayed" | "closed" | "unavailable";

export interface LiveQuote {
  id: string;
  priceUsd: number | null;
  change24h: number | null;
  confidenceUsd: number | null;
  publishedAt: string | null;
  freshness: QuoteFreshness;
  source: "Pyth Core" | "Jupiter Swap V2" | "Unavailable";
  sourceSymbol: string | null;
  kind: "metal-spot" | "underlying-security" | "venue-probe" | "unavailable";
  note: string;
}

export interface MetalQuoteResponse {
  asOf: string;
  refreshAfterMs: number;
  markets: Record<string, LiveQuote>;
  products: Record<string, LiveQuote>;
  providerState: "online" | "degraded";
  providerMessage?: string;
}
