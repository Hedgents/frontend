import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import {
  ACTIVE_FREQUENCY_COVERAGE,
  PERIODIC_PIPELINE_AUDIT_BY_ID,
  PERIODIC_PIPELINE_AUDIT_SUMMARY,
  frequencyCoverageForMetal,
  getMetalMarketNamespace,
  getMetalReferenceMarket,
  listMetalIntelligence,
  loadScarcityDataset,
  type MetalFamily,
  METAL_MARKET_NAMESPACE_COVERAGE,
} from "@/lib/scarcity";

export const dynamic = "force-dynamic";

const metalFamilies = new Set<MetalFamily>([
  "precious",
  "base",
  "battery",
  "nuclear",
  "strategic",
]);

function parseAsOf(value: string | null) {
  if (!value) return new Date().toISOString();
  if (!Number.isFinite(Date.parse(value))) throw new Error("The asOf query must be an ISO timestamp.");
  return new Date(value).toISOString();
}

export async function GET(request: Request) {
  let responseHeaders: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    responseHeaders = enforceRateLimit(request, {
      key: "scarcity-metals",
      limit: 120,
      windowMs: 60_000,
    }).headers;
    const url = new URL(request.url);
    const familyValue = url.searchParams.get("family");
    if (familyValue && !metalFamilies.has(familyValue as MetalFamily)) {
      return NextResponse.json(
        { error: "Unknown metal family." },
        { status: 400, headers: { ...responseHeaders, "cache-control": "no-store" } },
      );
    }

    const dataset = await loadScarcityDataset(url.searchParams.get("dataset"));
    const asOf = parseAsOf(url.searchParams.get("asOf"));
    const intelligence = listMetalIntelligence({
      dataset,
      asOf,
    }).filter((entry) => !familyValue || entry.snapshot.metal.families.includes(familyValue as MetalFamily));
    const observedMetalIds = new Set(dataset.observations.map((observation) => observation.metalId));
    const references = intelligence.map((entry) => getMetalReferenceMarket(entry.snapshot.metal.id));

    return NextResponse.json(
      {
        asOf,
        methodologyVersion: intelligence[0]?.snapshot.methodologyVersion ?? null,
        dataset: {
          id: dataset.id,
          label: dataset.label,
          kind: dataset.kind,
          description: dataset.description,
        },
        count: intelligence.length,
        sourceCoverage: {
          observationCount: dataset.observations.length,
          observedMetalCount: observedMetalIds.size,
          sourceCount: dataset.sources.length,
          direct: intelligence.filter((entry) => entry.snapshot.metal.dataMode === "direct").length,
          group: intelligence.filter((entry) => entry.snapshot.metal.dataMode === "group").length,
          specialized: intelligence.filter((entry) => entry.snapshot.metal.marketStatus === "specialized").length,
          nonCommercial: intelligence.filter((entry) => entry.snapshot.metal.marketStatus === "non-commercial").length,
        },
        frequencyCoverage: ACTIVE_FREQUENCY_COVERAGE,
        marketNamespaceCoverage: METAL_MARKET_NAMESPACE_COVERAGE,
        pipelineCoverage: PERIODIC_PIPELINE_AUDIT_SUMMARY,
        referenceCoverage: {
          mapped: references.filter(Boolean).length,
          unmapped: references.filter((reference) => !reference).length,
          observed: references.filter((reference) => reference?.coverageStage === "observed").length,
          proxy: references.filter((reference) => reference?.coverageStage === "mapped").length,
          scientific: references.filter((reference) => reference?.coverageStage === "scientific").length,
        },
        coverage: intelligence.reduce((counts, entry) => {
          counts[entry.state.coverageStatus] += 1;
          return counts;
        }, { verified: 0, partial: 0, uncovered: 0 }),
        activeSignalCount: intelligence.reduce(
          (count, entry) => count + entry.signals.filter((signal) => signal.status === "active").length,
          0,
        ),
        metals: intelligence.map(({ snapshot, state, signals, candidates }) => ({
          metal: snapshot.metal,
          reference: getMetalReferenceMarket(snapshot.metal.id),
          marketNamespace: getMetalMarketNamespace(snapshot.metal.id),
          frequency: frequencyCoverageForMetal(snapshot.metal.id),
          pipeline: PERIODIC_PIPELINE_AUDIT_BY_ID[snapshot.metal.id],
          calculationId: snapshot.calculationId,
          state,
          activeSignalCount: signals.filter((signal) => signal.status === "active").length,
          marketCandidateCount: candidates.length,
          marketReady: candidates.some((candidate) => candidate.readiness === "review-ready"),
          marketTightness: {
            score: snapshot.marketTightness.score,
            confidenceScore: snapshot.marketTightness.confidenceScore,
            confidenceGrade: snapshot.marketTightness.confidenceGrade,
            coverageRatio: snapshot.marketTightness.coverageRatio,
            dataStatus: snapshot.marketTightness.dataStatus,
          },
          structuralScarcity: {
            score: snapshot.structuralScarcity.score,
            confidenceScore: snapshot.structuralScarcity.confidenceScore,
            confidenceGrade: snapshot.structuralScarcity.confidenceGrade,
            coverageRatio: snapshot.structuralScarcity.coverageRatio,
            dataStatus: snapshot.structuralScarcity.dataStatus,
          },
          dataConfidence: snapshot.dataConfidence,
        })),
      },
      { headers: { ...responseHeaders, "cache-control": "no-store" } },
    );
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scarcity data is unavailable." },
      {
        status: security?.status ?? 400,
        headers: {
          ...responseHeaders,
          ...(security?.headers ?? {}),
          "cache-control": "no-store",
        },
      },
    );
  }
}
