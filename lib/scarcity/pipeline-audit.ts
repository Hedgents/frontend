import { frequencyCoverageForMetal } from "./frequency-coverage";
import { PERIODIC_ELEMENTS } from "./periodic-table";
import { METAL_REFERENCE_MARKET_BY_ID } from "./reference-markets";
import { SCARCITY_METAL_BY_ID } from "./registry";
import { BUNDLED_USGS_SCARCITY_DATASET } from "./usgs-baseline";
import { ONLINE_DETECTOR_SOURCES } from "./online-detector";

export type PipelineReadiness =
  | "bundled-annual"
  | "reference-only"
  | "scientific-only"
  | "out-of-scope";

export interface PeriodicPipelineAuditEntry {
  atomicNumber: number;
  symbol: string;
  name: string;
  category: string;
  tracked: boolean;
  pipelineReadiness: PipelineReadiness;
  referenceStage: "observed" | "mapped" | "scientific" | null;
  referenceName: string | null;
  referenceCadence: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  observationCount: number;
  observationMetricIds: string[];
  activeMarketPulse: boolean;
  scheduledRefresh: boolean;
  structuralStatus: "pass" | "fail";
  issues: string[];
  remainingWork: string[];
}

const observationsByMetalId = new Map<string, typeof BUNDLED_USGS_SCARCITY_DATASET.observations>();
for (const observation of BUNDLED_USGS_SCARCITY_DATASET.observations) {
  const observations = observationsByMetalId.get(observation.metalId) ?? [];
  observations.push(observation);
  observationsByMetalId.set(observation.metalId, observations);
}

const scheduledMetalIds = new Set(ONLINE_DETECTOR_SOURCES.flatMap((source) => source.metalIds));

export const PERIODIC_PIPELINE_AUDIT: readonly PeriodicPipelineAuditEntry[] = Object.freeze(
  PERIODIC_ELEMENTS.map<PeriodicPipelineAuditEntry>((element) => {
    const metalId = element.name.toLowerCase();
    const metal = SCARCITY_METAL_BY_ID[metalId];
    if (!metal) {
      return {
        atomicNumber: element.atomicNumber,
        symbol: element.symbol,
        name: element.name,
        category: element.category,
        tracked: false,
        pipelineReadiness: "out-of-scope" as const,
        referenceStage: null,
        referenceName: null,
        referenceCadence: null,
        sourceName: null,
        sourceUrl: null,
        observationCount: 0,
        observationMetricIds: [],
        activeMarketPulse: false,
        scheduledRefresh: false,
        structuralStatus: "pass" as const,
        issues: [],
        remainingWork: ["Outside the metal, metalloid, and explicit minor-material scope."],
      };
    }

    const reference = METAL_REFERENCE_MARKET_BY_ID[metalId];
    const observations = observationsByMetalId.get(metalId) ?? [];
    const frequency = frequencyCoverageForMetal(metalId);
    const issues: string[] = [];

    if (!reference) issues.push("Tracked cell has no objective reference.");
    if (reference && !reference.source.url.startsWith("https://")) {
      issues.push("Objective reference does not use an HTTPS primary-source URL.");
    }
    if (reference?.coverageStage === "observed" && observations.length === 0) {
      issues.push("Reference is labeled observed but the bundled source has no observation.");
    }
    if (reference?.coverageStage !== "observed" && observations.length > 0) {
      issues.push("Bundled observations exist but the reference is not labeled observed.");
    }
    if (reference?.coverageStage === "scientific" && metal.marketStatus !== "non-commercial") {
      issues.push("A commercially classified cell falls back to a scientific-only reference.");
    }
    if (reference?.coverageStage === "observed" && !metal.sourceCommodity) {
      issues.push("Observed reference is missing its normalized commodity mapping.");
    }
    if (metal.sourceCommodity && observations.some((observation) => observation.sourceId !== metal.sourceCommodity?.sourceId)) {
      issues.push("Bundled observation source does not match the normalized commodity mapping.");
    }
    if (metal.dataMode === "group" && reference?.relationship !== "group") {
      issues.push("Group-reported observations are not labeled as group context.");
    }
    if (metal.dataMode === "direct" && reference?.coverageStage !== "observed") {
      issues.push("Direct commodity mapping is not exposed as an observed reference.");
    }

    const pipelineReadiness: PipelineReadiness = observations.length > 0
      ? "bundled-annual"
      : reference?.coverageStage === "scientific"
        ? "scientific-only"
        : "reference-only";
    const remainingWork = pipelineReadiness === "bundled-annual"
      ? ["Annual official releases are auto-discovered and parsed behind schema gates; settlement-use approval remains an operator decision."]
      : pipelineReadiness === "reference-only"
        ? ["The primary source is checked daily; detected changes remain quarantined until the exact field and market rules are reviewed."]
        : ["The scientific reference and rotating publication registry are monitored; no commodity scarcity score is manufactured for non-commercial elements."];

    return {
      atomicNumber: element.atomicNumber,
      symbol: element.symbol,
      name: element.name,
      category: element.category,
      tracked: true,
      pipelineReadiness,
      referenceStage: reference?.coverageStage ?? null,
      referenceName: reference?.referenceName ?? null,
      referenceCadence: reference?.cadence ?? null,
      sourceName: reference?.source.name ?? null,
      sourceUrl: reference?.source.url ?? null,
      observationCount: observations.length,
      observationMetricIds: [...new Set(observations.map((observation) => observation.metricId))].sort(),
      activeMarketPulse: frequency.highestActiveCadence !== "annual",
      scheduledRefresh: scheduledMetalIds.has(metal.id),
      structuralStatus: issues.length === 0 ? "pass" : "fail",
      issues,
      remainingWork,
    };
  }),
);

export const PERIODIC_PIPELINE_AUDIT_BY_SYMBOL = Object.freeze(
  Object.fromEntries(PERIODIC_PIPELINE_AUDIT.map((entry) => [entry.symbol.toLowerCase(), entry])) as Record<string, PeriodicPipelineAuditEntry>,
);

export const PERIODIC_PIPELINE_AUDIT_BY_ID = Object.freeze(
  Object.fromEntries(PERIODIC_PIPELINE_AUDIT.map((entry) => [entry.name.toLowerCase(), entry])) as Record<string, PeriodicPipelineAuditEntry>,
);

export const PERIODIC_PIPELINE_AUDIT_SUMMARY = Object.freeze({
  periodicElementCount: PERIODIC_PIPELINE_AUDIT.length,
  trackedElementCount: PERIODIC_PIPELINE_AUDIT.filter((entry) => entry.tracked).length,
  outOfScopeCount: PERIODIC_PIPELINE_AUDIT.filter((entry) => !entry.tracked).length,
  bundledAnnualCount: PERIODIC_PIPELINE_AUDIT.filter((entry) => entry.pipelineReadiness === "bundled-annual").length,
  referenceOnlyCount: PERIODIC_PIPELINE_AUDIT.filter((entry) => entry.pipelineReadiness === "reference-only").length,
  scientificOnlyCount: PERIODIC_PIPELINE_AUDIT.filter((entry) => entry.pipelineReadiness === "scientific-only").length,
  activeMarketPulseCount: PERIODIC_PIPELINE_AUDIT.filter((entry) => entry.activeMarketPulse).length,
  scheduledRefreshCount: PERIODIC_PIPELINE_AUDIT.filter((entry) => entry.scheduledRefresh).length,
  structuralFailureCount: PERIODIC_PIPELINE_AUDIT.filter((entry) => entry.structuralStatus === "fail").length,
});
