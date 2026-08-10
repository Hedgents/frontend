import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { loadOnlineDetectorState } from "@/lib/scarcity-detector-store";
import { onlineDetectorSummary } from "@/lib/scarcity/online-detector";
import { getScarcityMetal } from "@/lib/scarcity/registry";
import { loadReviewedMarketSpecifications } from "@/lib/scarcity-market-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-online-detector", limit: 120, windowMs: 60_000 }).headers;
    const url = new URL(request.url);
    const metalValue = url.searchParams.get("metal");
    const metal = metalValue ? getScarcityMetal(metalValue) : null;
    if (metalValue && !metal) throw new Error("Unknown metal filter.");
    const [state, reviewedMarkets] = await Promise.all([
      loadOnlineDetectorState(),
      loadReviewedMarketSpecifications(),
    ]);
    const evidence = state.evidence.filter((item) => !metal || item.metalIds.includes(metal.id));
    const signals = state.signals.filter((item) => !metal || item.metalId === metal.id);
    const candidates = state.candidates.filter((item) => !metal || item.metalId === metal.id);
    return NextResponse.json({
      asOf: new Date().toISOString(),
      summary: onlineDetectorSummary(state),
      latestRun: state.runs[0] ?? null,
      sources: state.sources,
      alerts: state.alerts,
      evidence: evidence.slice(0, 100),
      signals: signals.slice(0, 200),
      candidates: candidates.slice(0, 100),
      publishedCandidateIds: reviewedMarkets.map((entry) => entry.candidateId),
    }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Online detector state is unavailable.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
