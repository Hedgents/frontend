import { METAL_REFERENCE_MARKETS, type MetalReferenceMarket } from "./reference-markets";
import { SCARCITY_METALS } from "./registry";
import type { MetalDefinition } from "./types";

export type CatalystCategory = "price-data" | "supply-projects" | "policy" | "science";
export type MarketPath = "data" | "event";

export interface MetalMarketNamespace {
  id: string;
  metalId: string;
  primaryPath: MarketPath;
  primaryCategory: CatalystCategory;
  primaryQuestion: string;
  eligibleCategories: CatalystCategory[];
  paths: Array<{
    kind: MarketPath;
    eligible: boolean;
    state: "reference-mapped" | "event-eligible" | "requires-catalyst";
    description: string;
  }>;
  resolver: {
    primarySourceId: string;
    primarySourceName: string;
    primarySourceUrl: string;
    evidenceHierarchy: readonly string[];
    invalidWhen: string;
  };
}

export const CATALYST_CATEGORY_LABELS: Readonly<Record<CatalystCategory, string>> = Object.freeze({
  "price-data": "Price & data",
  "supply-projects": "Supply & projects",
  policy: "Policy",
  science: "Science",
});

export const EVENT_EVIDENCE_HIERARCHY = Object.freeze([
  "Named government, regulator, or intergovernmental authority",
  "Named exchange filing or official company publication",
  "Named scientific institution or peer-reviewed journal",
  "Named major newswire only when the primary authority is unavailable",
]);

function primaryCategory(reference: MetalReferenceMarket): CatalystCategory {
  if (reference.marketUse === "scientific-event-only") return "science";
  if (/price|unit value|premium/i.test(reference.signalMetric)) return "price-data";
  return "supply-projects";
}

function namespaceForMetal(metal: MetalDefinition, reference: MetalReferenceMarket): MetalMarketNamespace {
  const dataEligible = reference.marketUse !== "scientific-event-only";
  const commercialEventEligible = metal.marketStatus !== "non-commercial";
  const category = primaryCategory(reference);
  const categories = new Set<CatalystCategory>([category, "science"]);
  if (dataEligible) categories.add("price-data");
  if (commercialEventEligible) {
    categories.add("supply-projects");
    categories.add("policy");
  }

  return {
    id: `${metal.id}-market-namespace`,
    metalId: metal.id,
    primaryPath: dataEligible ? "data" : "event",
    primaryCategory: category,
    primaryQuestion: reference.binaryQuestion,
    eligibleCategories: [...categories],
    paths: [
      {
        kind: "data",
        eligible: dataEligible,
        state: dataEligible ? "reference-mapped" : "requires-catalyst",
        description: dataEligible
          ? `A numerical contract can resolve from the frozen ${reference.referenceName} observation.`
          : "No defensible commodity observation exists for this element; do not manufacture a price proxy.",
      },
      {
        kind: "event",
        eligible: true,
        state: "event-eligible",
        description: commercialEventEligible
          ? "A named policy decision, supply milestone, project event, or scientific publication can become a contract without a numerical scarcity signal."
          : "A named scientific publication or official evaluated-record event can become a contract without a commodity price.",
      },
    ],
    resolver: {
      primarySourceId: reference.source.id,
      primarySourceName: reference.source.name,
      primarySourceUrl: reference.source.url,
      evidenceHierarchy: EVENT_EVIDENCE_HIERARCHY,
      invalidWhen: "The frozen outcome is not conclusively confirmed by the named resolver before the resolution deadline.",
    },
  };
}

const referenceByMetalId = new Map(METAL_REFERENCE_MARKETS.map((reference) => [reference.metalId, reference]));

export const METAL_MARKET_NAMESPACES = Object.freeze(SCARCITY_METALS.map((metal) => {
  const reference = referenceByMetalId.get(metal.id);
  if (!reference) throw new Error(`Metal market namespace ${metal.id} requires an objective reference.`);
  return namespaceForMetal(metal, reference);
}));

export const METAL_MARKET_NAMESPACE_BY_ID = Object.freeze(
  Object.fromEntries(METAL_MARKET_NAMESPACES.map((namespace) => [namespace.metalId, namespace])) as Record<string, MetalMarketNamespace>,
);

export const METAL_MARKET_NAMESPACE_COVERAGE = Object.freeze({
  mapped: METAL_MARKET_NAMESPACES.length,
  dataEligible: METAL_MARKET_NAMESPACES.filter((namespace) => namespace.paths.some((path) => path.kind === "data" && path.eligible)).length,
  eventEligible: METAL_MARKET_NAMESPACES.filter((namespace) => namespace.paths.some((path) => path.kind === "event" && path.eligible)).length,
  categories: Object.fromEntries(
    (Object.keys(CATALYST_CATEGORY_LABELS) as CatalystCategory[]).map((category) => [
      category,
      METAL_MARKET_NAMESPACES.filter((namespace) => namespace.eligibleCategories.includes(category)).length,
    ]),
  ) as Record<CatalystCategory, number>,
});

export function getMetalMarketNamespace(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  const metal = SCARCITY_METALS.find((candidate) =>
    candidate.id === normalized || candidate.symbol.toLowerCase() === normalized,
  );
  return metal ? METAL_MARKET_NAMESPACE_BY_ID[metal.id] : null;
}
