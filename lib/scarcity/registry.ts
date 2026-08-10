import { PERIODIC_ELEMENTS } from "./periodic-table";
import {
  TRACKED_METALLOID_IDS,
  TRACKED_NONMETAL_COMMODITY_IDS,
  USGS_MAPPING_BY_METAL_ID,
} from "./commodity-coverage";
import type { MetalDefinition, MetalFamily } from "./types";

const initialMetalDefinitions: Record<string, Pick<MetalDefinition, "families" | "commercialUnit" | "description">> = {
  gold: {
    families: ["precious"],
    commercialUnit: "fine troy ounce",
    description: "Precious metal with deep physical, futures, and tokenized markets.",
  },
  silver: {
    families: ["precious", "strategic"],
    commercialUnit: "fine troy ounce",
    description: "Precious and industrial metal with substantial electronics and solar demand.",
  },
  copper: {
    families: ["base", "strategic"],
    commercialUnit: "metric tonne of defined deliverable grade",
    description: "Base metal central to electrification, construction, grids, and transport.",
  },
  uranium: {
    families: ["nuclear", "strategic"],
    commercialUnit: "pound U3O8 equivalent",
    description: "Nuclear fuel material with periodic assessed pricing and specialized custody.",
  },
  cobalt: {
    families: ["battery", "strategic"],
    commercialUnit: "metric tonne of defined deliverable grade",
    description: "Battery and alloy metal with concentrated supply and material by-product dependency.",
  },
  lithium: {
    families: ["battery", "strategic"],
    commercialUnit: "metric tonne lithium-carbonate equivalent",
    description: "Battery material traded through multiple chemical forms, grades, and regional assessments.",
  },
  platinum: {
    families: ["precious", "strategic"],
    commercialUnit: "fine troy ounce",
    description: "Platinum-group metal used in autocatalysts, industry, jewelry, and investment.",
  },
  palladium: {
    families: ["precious", "strategic"],
    commercialUnit: "fine troy ounce",
    description: "Platinum-group metal with concentrated production and significant substitution dynamics.",
  },
};

export const INITIAL_SCARCITY_METAL_IDS = Object.freeze([
  "gold",
  "silver",
  "copper",
  "uranium",
  "cobalt",
  "lithium",
  "platinum",
  "palladium",
] as const);

const batteryMetals = new Set(["lithium", "cobalt", "nickel", "manganese"]);
const preciousMetals = new Set([
  "gold",
  "silver",
  "platinum",
  "palladium",
  "rhodium",
  "ruthenium",
  "iridium",
  "osmium",
]);

const nonCommercialAtomicNumbers = new Set([43, 61, 84, 87, 88, 89, 91]);
const commercialReferenceOnlyIds = new Set(["boron", "germanium"]);

function hasNoOpenCommodityMarket(atomicNumber: number) {
  return nonCommercialAtomicNumbers.has(atomicNumber) || atomicNumber > 92;
}

function genericFamilies(name: string, category: string): MetalFamily[] {
  const id = name.toLowerCase();
  const families = new Set<MetalFamily>();
  if (preciousMetals.has(id)) families.add("precious");
  if (batteryMetals.has(id)) families.add("battery");
  if (category === "actinide") families.add("nuclear");
  if (category === "transition-metal" || category === "post-transition-metal") families.add("base");
  families.add("strategic");
  return [...families];
}

const metals: MetalDefinition[] = PERIODIC_ELEMENTS
  .filter((element) => {
    const id = element.name.toLowerCase();
    return element.isMetal
      || TRACKED_METALLOID_IDS.has(id)
      || TRACKED_NONMETAL_COMMODITY_IDS.has(id);
  })
  .map((element) => {
    const id = element.name.toLowerCase();
    const initial = initialMetalDefinitions[id];
    const sourceMapping = USGS_MAPPING_BY_METAL_ID[id];
    const marketStatus = hasNoOpenCommodityMarket(element.atomicNumber)
      ? "non-commercial" as const
      : sourceMapping || commercialReferenceOnlyIds.has(id)
        ? "commercial" as const
        : "specialized" as const;
    const dataMode = sourceMapping?.reportingMode ?? "none";
    const sourceCommodity = sourceMapping ? {
      sourceId: "usgs-mcs-2026-v1.3",
      chapter: sourceMapping.chapter,
      commodity: sourceMapping.commodity,
      commercialForm: sourceMapping.commercialForm,
    } : null;
    const genericDescription = marketStatus === "non-commercial"
      ? `${element.name} has no open, continuously observable physical commodity market. The cell is retained for scientific completeness and never receives a fabricated scarcity score.`
      : sourceMapping
        ? sourceMapping.reportingMode === "group"
          ? `${element.name} is observed through the explicitly labeled ${sourceMapping.commodity} group because the official source does not publish an element-level production series.`
          : `${element.name} is covered by the USGS annual ${sourceMapping.commodity} series in the form “${sourceMapping.commercialForm}.”`
        : `${element.name} has specialized or form-specific commercial use, but no normalized annual observation has passed the Hedgents source mapping yet.`;
    return {
      id,
      symbol: element.symbol,
      name: element.name,
      atomicNumber: element.atomicNumber,
      families: initial?.families ?? genericFamilies(element.name, element.category),
      commercialUnit: initial?.commercialUnit ?? sourceMapping?.commercialForm ?? "no normalized commercial unit",
      description: initial?.description ?? genericDescription,
      marketStatus,
      dataMode,
      sourceCommodity,
    };
  });

export const SCARCITY_METALS = Object.freeze(metals);

export const SCARCITY_TRACKED_ELEMENT_COUNT = SCARCITY_METALS.length;

export const INITIAL_SCARCITY_METALS = Object.freeze(
  INITIAL_SCARCITY_METAL_IDS.map((id) => {
    const metal = metals.find((candidate) => candidate.id === id);
    if (!metal) throw new Error(`Initial scarcity metal ${id} is missing from the periodic registry.`);
    return metal;
  }),
);

export const SCARCITY_METAL_BY_ID = Object.freeze(
  Object.fromEntries(metals.map((metal) => [metal.id, metal])) as Record<string, MetalDefinition>,
);

export function getScarcityMetal(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  return metals.find(
    (metal) => metal.id === normalized || metal.symbol.toLowerCase() === normalized,
  ) ?? null;
}
