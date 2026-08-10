import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { getScarcityMetal, listMetalIntelligence, loadScarcityDataset } from "@/lib/scarcity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-market-candidates", limit: 120, windowMs: 60_000 }).headers;
    const url = new URL(request.url);
    const dataset = await loadScarcityDataset(url.searchParams.get("dataset"));
    const metalValue = url.searchParams.get("metal");
    const metal = metalValue ? getScarcityMetal(metalValue) : null;
    if (metalValue && !metal) throw new Error("Unknown metal filter.");
    const readiness = url.searchParams.get("readiness");
    if (readiness && !new Set(["blocked", "paper-ready", "review-ready"]).has(readiness)) throw new Error("Unknown readiness filter.");
    const candidates = listMetalIntelligence({ dataset })
      .flatMap((entry) => entry.candidates)
      .filter((candidate) => !metal || candidate.metalId === metal.id)
      .filter((candidate) => !readiness || candidate.readiness === readiness);
    return NextResponse.json({
      dataset: { id: dataset.id, kind: dataset.kind, label: dataset.label },
      count: candidates.length,
      candidates,
    }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Market candidates are unavailable." },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
