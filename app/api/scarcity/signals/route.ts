import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { getScarcityMetal, listMetalIntelligence, loadScarcityDataset } from "@/lib/scarcity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "scarcity-signals", limit: 120, windowMs: 60_000 }).headers;
    const url = new URL(request.url);
    const dataset = await loadScarcityDataset(url.searchParams.get("dataset"));
    const metalValue = url.searchParams.get("metal");
    const metal = metalValue ? getScarcityMetal(metalValue) : null;
    if (metalValue && !metal) throw new Error("Unknown metal filter.");
    const status = url.searchParams.get("status");
    if (status && status !== "active" && status !== "expired") throw new Error("Unknown signal status filter.");
    const severity = url.searchParams.get("severity");
    if (severity && !new Set(["info", "watch", "material", "critical"]).has(severity)) throw new Error("Unknown signal severity filter.");
    const asOfValue = url.searchParams.get("asOf");
    if (asOfValue && !Number.isFinite(Date.parse(asOfValue))) throw new Error("The asOf query must be an ISO timestamp.");
    const asOf = asOfValue ? new Date(asOfValue).toISOString() : new Date().toISOString();
    const signals = listMetalIntelligence({ dataset, asOf })
      .flatMap((entry) => entry.signals)
      .filter((signal) => !metal || signal.metalId === metal.id)
      .filter((signal) => !status || signal.status === status)
      .filter((signal) => !severity || signal.severity === severity);
    return NextResponse.json({
      asOf,
      dataset: { id: dataset.id, kind: dataset.kind, label: dataset.label },
      count: signals.length,
      signals,
    }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scarcity signals are unavailable." },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
