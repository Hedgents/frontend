import { NextResponse } from "next/server";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { requireInviteAccess } from "@/lib/access-auth";
import type { LiveQuote, MetalQuoteResponse, QuoteFreshness } from "@/lib/quote-types";
import { readBoundedUpstreamJson } from "@/lib/safe-upstream-response";

export const dynamic = "force-dynamic";

interface FeedSpec {
  id: string;
  symbol: string;
  kind: LiveQuote["kind"];
  transform?: (price: number) => number;
}

interface ParsedPythPrice {
  id: string;
  price: {
    price: string;
    conf: string;
    expo: number;
    publish_time: number;
  };
}

interface PythResponse {
  parsed?: ParsedPythPrice[];
}

const PER_METRIC_TON_TO_PER_POUND = 1 / 2204.62262185;

const feeds = {
  xau: {
    id: "765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2",
    symbol: "XAU/USD",
    kind: "metal-spot",
  },
  xag: {
    id: "f2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e",
    symbol: "XAG/USD",
    kind: "metal-spot",
  },
  xpt: {
    id: "398e4bbc7cbf89d6648c21e08019d878967677753b3096799595c78f805a34e5",
    symbol: "XPT/USD",
    kind: "metal-spot",
  },
  xpd: {
    id: "80367e9664197f37d89a07a804dffd2101c479c7c4e8490501bc9d9e1e7f9021",
    symbol: "XPD/USD",
    kind: "metal-spot",
  },
  xcu: {
    id: "636bedafa14a37912993f265eda22431a2be363ad41a10276424bbe1b7f508c4",
    symbol: "XCU/USD",
    kind: "metal-spot",
    transform: (price: number) => price * PER_METRIC_TON_TO_PER_POUND,
  },
  xni: {
    id: "a41da02810f3993706dca86e32582d40de376116eff24342353c33a0a8f9c083",
    symbol: "XNI/USD",
    kind: "metal-spot",
    transform: (price: number) => price * PER_METRIC_TON_TO_PER_POUND,
  },
  gld: {
    id: "e190f467043db04548200354889dfe0d9d314c08b8d4e62fabf4d5a3140fecca",
    symbol: "GLD/USD",
    kind: "underlying-security",
  },
  slv: {
    id: "6fc08c9963d266069cbd9780d98383dabf2668322a5bef0b9491e11d67e5d7e7",
    symbol: "SLV/USD",
    kind: "underlying-security",
  },
  pplt: {
    id: "782410278b6c8aa2d437812281526012808404aa14c243f73fb9939eeb88d430",
    symbol: "PPLT/USD",
    kind: "underlying-security",
  },
  pall: {
    id: "feeb371f721e75853604c47104967f0ab3fa92b988837013f5004f749a8a0599",
    symbol: "PALL/USD",
    kind: "underlying-security",
  },
  cper: {
    id: "34b7613ec0b7388fc491162ef6d2b211ef311ea90d35863a7f03017d259c3cd4",
    symbol: "CPER/USD",
    kind: "underlying-security",
  },
} satisfies Record<string, FeedSpec>;

const marketFeeds: Record<string, FeedSpec | null> = {
  gold: feeds.xau,
  silver: feeds.xag,
  uranium: null,
  platinum: feeds.xpt,
  copper: feeds.xcu,
  palladium: feeds.xpd,
  nickel: feeds.xni,
};

const productFeeds: Record<string, FeedSpec | null> = {
  "gold-paxg": feeds.xau,
  "gold-oro": feeds.xau,
  "gold-xaum": feeds.xau,
  "gold-gldx": feeds.gld,
  "gold-gldon": feeds.gld,
  "silver-slvx": feeds.slv,
  "silver-slvon": feeds.slv,
  "uranium-urax": null,
  "uranium-uraon": null,
  "uranium-urnmon": null,
  "platinum-pplton": feeds.pplt,
  "platinum-ppltx": feeds.pplt,
  "copper-copxx": null,
  "copper-copxon": null,
  "copper-cperon": feeds.cper,
  "palladium-pallx": feeds.pall,
  "palladium-pallon": feeds.pall,
  "nickel-research": null,
};

function pythNumber(value: ParsedPythPrice["price"], field: "price" | "conf") {
  return Number(value[field]) * 10 ** value.expo;
}

function pythConfig() {
  const apiKey = process.env.PYTH_API_KEY?.trim();
  return apiKey
    ? {
        baseUrl: "https://pyth.dourolabs.app/hermes",
        headers: { Authorization: `Bearer ${apiKey}` } as Record<string, string>,
      }
    : { baseUrl: "https://hermes.pyth.network", headers: {} as Record<string, string> };
}

async function fetchPrices(path: string, ids: string[], signal: AbortSignal) {
  const { baseUrl, headers } = pythConfig();
  const params = new URLSearchParams({ parsed: "true", ignore_invalid_price_ids: "true" });
  ids.forEach((id) => params.append("ids[]", id));
  const response = await fetch(`${baseUrl}${path}?${params}`, {
    headers,
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Pyth returned ${response.status}`);
  const payload = await readBoundedUpstreamJson<PythResponse>(response, 2_000_000, "Pyth");
  return new Map((payload.parsed ?? []).map((item) => [item.id, item]));
}

function unavailableQuote(id: string, note: string): LiveQuote {
  return {
    id,
    priceUsd: null,
    change24h: null,
    confidenceUsd: null,
    publishedAt: null,
    freshness: "unavailable",
    source: "Unavailable",
    sourceSymbol: null,
    kind: "unavailable",
    note,
  };
}

function freshnessFor(publishedAt: number, kind: LiveQuote["kind"], now: number): QuoteFreshness {
  const ageSeconds = Math.max(0, now - publishedAt);
  if (kind === "underlying-security") {
    if (ageSeconds <= 120) return "live";
    if (ageSeconds <= 86_400 * 4) return "closed";
    return "delayed";
  }
  if (ageSeconds <= 60) return "live";
  if (ageSeconds <= 900) return "delayed";
  return "closed";
}

function buildQuote(
  id: string,
  spec: FeedSpec,
  latest: ParsedPythPrice | undefined,
  historical: ParsedPythPrice | undefined,
  now: number,
): LiveQuote {
  if (!latest) return unavailableQuote(id, "The configured feed did not return a price.");
  const transform = spec.transform ?? ((value: number) => value);
  const priceUsd = transform(pythNumber(latest.price, "price"));
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || latest.price.publish_time <= 0) {
    return unavailableQuote(id, "The configured feed is present but is not publishing a valid price.");
  }
  const previousPrice = historical ? transform(pythNumber(historical.price, "price")) : null;
  const change24h = previousPrice && previousPrice > 0
    ? ((priceUsd - previousPrice) / previousPrice) * 100
    : null;
  const freshness = freshnessFor(latest.price.publish_time, spec.kind, now);
  return {
    id,
    priceUsd,
    change24h,
    confidenceUsd: transform(pythNumber(latest.price, "conf")),
    publishedAt: new Date(latest.price.publish_time * 1000).toISOString(),
    freshness,
    source: "Pyth Core",
    sourceSymbol: spec.symbol,
    kind: spec.kind,
    note:
      spec.kind === "underlying-security"
        ? "Live reference for the security underlying the tokenized product; not an executable venue quote."
        : "Live metal reference; venue spread, token premium, fees, and price impact are not included.",
  };
}

export async function GET(request: Request) {
  let responseHeaders: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    responseHeaders = enforceRateLimit(request, { key: "quotes", limit: 60, windowMs: 60_000 }).headers;
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Quote requests are temporarily limited." },
      { status: security?.status ?? 429, headers: { ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const uniqueIds = [...new Set(Object.values(feeds).map((feed) => feed.id))];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const [latest, historical] = await Promise.all([
      fetchPrices("/v2/updates/price/latest", uniqueIds, controller.signal),
      fetchPrices(`/v2/updates/price/${now - 86_400}`, uniqueIds, controller.signal).catch(
        () => new Map<string, ParsedPythPrice>(),
      ),
    ]);

    const markets = Object.fromEntries(
      Object.entries(marketFeeds).map(([id, spec]) => [
        id,
        spec
          ? buildQuote(id, spec, latest.get(spec.id), historical.get(spec.id), now)
          : unavailableQuote(id, "No institutional real-time reference feed is configured yet."),
      ]),
    );
    const products = Object.fromEntries(
      Object.entries(productFeeds).map(([id, spec]) => [
        id,
        spec
          ? buildQuote(id, spec, latest.get(spec.id), historical.get(spec.id), now)
          : unavailableQuote(id, "No verified live product feed or venue quote is configured yet."),
      ]),
    );

    const payload: MetalQuoteResponse = {
      asOf: new Date().toISOString(),
      refreshAfterMs: 5_000,
      markets,
      products,
      providerState: "online",
    };
    return NextResponse.json(payload, {
      headers: { ...responseHeaders, "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quote provider unavailable";
    const markets = Object.fromEntries(
      Object.keys(marketFeeds).map((id) => [id, unavailableQuote(id, message)]),
    );
    const products = Object.fromEntries(
      Object.keys(productFeeds).map((id) => [id, unavailableQuote(id, message)]),
    );
    const payload: MetalQuoteResponse = {
      asOf: new Date().toISOString(),
      refreshAfterMs: 10_000,
      markets,
      products,
      providerState: "degraded",
      providerMessage: message,
    };
    return NextResponse.json(payload, {
      status: 503,
      headers: { ...responseHeaders, "Cache-Control": "no-store, max-age=0" },
    });
  } finally {
    clearTimeout(timeout);
  }
}
