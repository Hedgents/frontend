export type ActivePulseCadence = "real-time" | "weekly" | "annual";

export interface CftcMetalContract {
  metalId: string;
  code: string;
  commodity: string;
  market: string;
}

/**
 * Pyth Core references already consumed by the terminal quote service. These
 * are market references, not physical scarcity observations.
 */
export const REALTIME_REFERENCE_METAL_IDS = Object.freeze(new Set([
  "gold",
  "silver",
  "platinum",
  "palladium",
]));

/**
 * Exact CFTC contract market codes. Name matching is deliberately forbidden so
 * renamed, micro, regional-premium, and inactive contracts cannot be mixed in.
 */
export const CFTC_WEEKLY_CONTRACTS = Object.freeze([
  { metalId: "cobalt", code: "188691", commodity: "COBALT", market: "COBALT - COMMODITY EXCHANGE INC." },
  { metalId: "copper", code: "085692", commodity: "COPPER", market: "COPPER- #1 - COMMODITY EXCHANGE INC." },
  { metalId: "gold", code: "088691", commodity: "GOLD", market: "GOLD - COMMODITY EXCHANGE INC." },
  { metalId: "lithium", code: "189691", commodity: "LITHIUM", market: "LITHIUM HYDROXIDE - COMMODITY EXCHANGE INC." },
  { metalId: "palladium", code: "075651", commodity: "PALLADIUM", market: "PALLADIUM - NEW YORK MERCANTILE EXCHANGE" },
  { metalId: "platinum", code: "076651", commodity: "PLATINUM", market: "PLATINUM - NEW YORK MERCANTILE EXCHANGE" },
  { metalId: "silver", code: "084691", commodity: "SILVER", market: "SILVER - COMMODITY EXCHANGE INC." },
] satisfies readonly CftcMetalContract[]);

export const CFTC_CONTRACT_BY_METAL_ID = Object.freeze(
  Object.fromEntries(CFTC_WEEKLY_CONTRACTS.map((contract) => [contract.metalId, contract])) as Record<string, CftcMetalContract>,
);

/**
 * USGS Mineral Industry Surveys have monthly or quarterly physical releases
 * for these metal cells. Posting is currently paused during the ScienceBase
 * migration, so this is surfaced as monitored future coverage, never as live.
 */
export const USGS_MIS_MONITORED_METAL_IDS = Object.freeze(new Set([
  "aluminium",
  "chromium",
  "cobalt",
  "copper",
  "gold",
  "iron",
  "lead",
  "magnesium",
  "manganese",
  "molybdenum",
  "palladium",
  "platinum",
  "silicon",
  "silver",
  "tin",
  "titanium",
  "tungsten",
  "vanadium",
]));

export function frequencyCoverageForMetal(metalId: string) {
  const realtimeReference = REALTIME_REFERENCE_METAL_IDS.has(metalId);
  const weeklyPositioning = Boolean(CFTC_CONTRACT_BY_METAL_ID[metalId]);
  return {
    highestActiveCadence: realtimeReference ? "real-time" as const : weeklyPositioning ? "weekly" as const : "annual" as const,
    realtimeReference,
    weeklyPositioning,
    monthlyPhysicalMonitor: USGS_MIS_MONITORED_METAL_IDS.has(metalId),
    monthlyPhysicalState: USGS_MIS_MONITORED_METAL_IDS.has(metalId) ? "source-paused" as const : "not-mapped" as const,
  };
}

export const ACTIVE_FREQUENCY_COVERAGE = Object.freeze({
  realtimeMetalCount: REALTIME_REFERENCE_METAL_IDS.size,
  weeklyMetalCount: CFTC_WEEKLY_CONTRACTS.length,
  activeMetalCount: new Set([
    ...REALTIME_REFERENCE_METAL_IDS,
    ...CFTC_WEEKLY_CONTRACTS.map((contract) => contract.metalId),
  ]).size,
  monitoredPhysicalMetalCount: USGS_MIS_MONITORED_METAL_IDS.size,
});
