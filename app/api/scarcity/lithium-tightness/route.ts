import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { readLithiumTightness } from "@/lib/scarcity/lithium-store";
import { compileLithiumRound, LITHIUM_ROUNDS } from "@/lib/scarcity/lithium-market";
import {
  CURVE_SLOPE_ANCHORS,
  LIQUIDITY_ENTRY,
  LIQUIDITY_EXIT,
  TRAILING_MEDIAN_DAYS,
} from "@/lib/scarcity/lithium-tightness";

export const dynamic = "force-dynamic";

/**
 * The lithium carbonate tightness reading, plus enough of the method to check it.
 *
 * The calculation block is not decoration. A reader holding it and the free GFEX endpoint can
 * recompute the settling number without this API, without a license, and without trusting the
 * operator, which is the property that makes a market on this number defensible.
 */
export async function GET(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-lithium-tightness", limit: 120, windowMs: 60_000 }).headers;
    const url = new URL(request.url);
    const historyValue = Number(url.searchParams.get("historyDays") ?? "260");
    const historyDays = Number.isFinite(historyValue)
      ? Math.min(4_000, Math.max(0, Math.trunc(historyValue)))
      : 260;

    const reading = await readLithiumTightness();
    const rounds = Object.values(LITHIUM_ROUNDS).map((window) => {
      const compiled = compileLithiumRound(window);
      return {
        round: window.round,
        slug: compiled.slug,
        marketId: compiled.marketId,
        metricHash: compiled.metricHash,
        rulesHash: compiled.rulesHash,
        opensAt: window.opensAt,
        closesAt: window.closesAt,
        observedAt: window.observedAt,
        resolveAfter: window.resolveAfter,
      };
    });

    return NextResponse.json({
      asOf: new Date().toISOString(),
      reading: { ...reading, history: reading.history.slice(-historyDays) },
      calculation: {
        parameter: "annualised front-to-third settlement slope",
        formula: "(S_front / S_third - 1) * (365 / (months_between * 30.4375))",
        trailingMedianTradingDays: TRAILING_MEDIAN_DAYS,
        contractSelection: { entry: LIQUIDITY_ENTRY, exit: LIQUIDITY_EXIT },
        anchors: CURVE_SLOPE_ANCHORS.map(([value, score]) => ({ value, score })),
        anchorInterpolation: "piecewise-linear, clamped at both ends",
        interpretation: "Backwardation, meaning the front contract above the deferred one, is the "
          + "physical-tightness signal. The parameter is scale-free, so the score carries no view on "
          + "the price level.",
      },
      source: {
        publisher: "Guangzhou Futures Exchange",
        title: "Lithium carbonate daily quotations",
        url: "http://www.gfex.com.cn/gfex/rihq/hqsj_tjsj.shtml",
        cadence: "Every trading day after the 15:00 CST close",
      },
      rounds,
    }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "The lithium tightness reading is unavailable.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
