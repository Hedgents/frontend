import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import {
  MINIMUM_DIMENSION_COVERAGE,
  SCARCITY_METRICS,
  SCARCITY_METHODOLOGY_VERSION,
  SOURCE_RELIABILITY,
} from "@/lib/scarcity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let responseHeaders: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    responseHeaders = enforceRateLimit(request, {
      key: "scarcity-methodology",
      limit: 60,
      windowMs: 60_000,
    }).headers;
    return NextResponse.json(
      {
        version: SCARCITY_METHODOLOGY_VERSION,
        principles: [
          "Market tightness, structural scarcity, and data confidence remain separate.",
          "Missing metrics reduce coverage and confidence; they are never silently imputed.",
          "Stale observations decay in confidence and eventually become unusable.",
          "The calculation is deterministic for a fixed dataset, methodology version, and as-of timestamp.",
          "Sample observations are explicitly labeled and are not market data.",
        ],
        minimumDimensionCoverage: MINIMUM_DIMENSION_COVERAGE,
        sourceReliability: SOURCE_RELIABILITY,
        metrics: SCARCITY_METRICS,
      },
      { headers: { ...responseHeaders, "cache-control": "public, max-age=300" } },
    );
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Methodology unavailable." },
      {
        status: security?.status ?? 500,
        headers: {
          ...responseHeaders,
          ...(security?.headers ?? {}),
          "cache-control": "no-store",
        },
      },
    );
  }
}
