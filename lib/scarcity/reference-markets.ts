import { SCARCITY_METALS } from "./registry";
import type { MetalDefinition } from "./types";

export type ReferenceRelationship =
  | "commercial-form"
  | "compound"
  | "group"
  | "application"
  | "isotope"
  | "scientific";

export type ReferenceCadence =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "event-driven";

export type ReferenceCoverageStage = "observed" | "mapped" | "scientific";

export interface MetalReferenceMarket {
  metalId: string;
  referenceName: string;
  relationship: ReferenceRelationship;
  coverageStage: ReferenceCoverageStage;
  cadence: ReferenceCadence;
  referenceUnit: string;
  signalMetric: string;
  binaryQuestion: string;
  source: {
    id: string;
    name: string;
    operator: string;
    url: string;
  };
  caveat: string;
  marketUse: "physical-signal" | "application-signal" | "scientific-event-only";
  settlementReadiness: "research-only";
}

type SpecializedReference = Omit<MetalReferenceMarket, "metalId" | "coverageStage" | "settlementReadiness">;

const USGS_MCS_SOURCE = Object.freeze({
  id: "usgs-mcs-reference",
  name: "USGS Mineral Commodity Summaries",
  operator: "U.S. Geological Survey, National Minerals Information Center",
  url: "https://pubs.usgs.gov/publication/mcs2026",
});

const IAEA_LIVECHART_SOURCE = Object.freeze({
  id: "iaea-livechart-reference",
  name: "IAEA LiveChart of Nuclides",
  operator: "International Atomic Energy Agency, Nuclear Data Section",
  url: "https://nucleus.iaea.org/Pages/livechart-of-nuclides-av.aspx",
});

const specializedReferences: Readonly<Record<string, SpecializedReference>> = Object.freeze({
  boron: {
    referenceName: "Commercial borates (B2O3 basis)",
    relationship: "compound",
    cadence: "annual",
    referenceUnit: "dollars per metric ton of combined borate imports",
    signalMetric: "USGS annual average unit value of combined borate imports",
    binaryQuestion: "Will the next USGS boron release report a higher average unit value for combined borate imports than the preceding annual release?",
    source: {
      id: "usgs-boron-reference",
      name: "USGS Boron Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/boron-statistics-and-information",
    },
    caveat: "Elemental boron has limited commercial use. Borates are sold on a B2O3 basis, and different ores and compounds are not interchangeable; this reference is not an elemental-boron spot price.",
    marketUse: "physical-signal",
  },
  germanium: {
    referenceName: "Refined germanium metal",
    relationship: "commercial-form",
    cadence: "annual",
    referenceUnit: "dollars per kilogram of germanium metal",
    signalMetric: "USGS annual average germanium-metal price",
    binaryQuestion: "Will the next USGS germanium release report a higher annual average germanium-metal price than the preceding annual release?",
    source: {
      id: "usgs-germanium-reference",
      name: "USGS Germanium Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/germanium-statistics-and-information",
    },
    caveat: "The contract must freeze the germanium-metal price row. Germanium metal, dioxide, tetrachloride, concentrates, and recycled material are distinct forms and must not be combined.",
    marketUse: "physical-signal",
  },
  sodium: {
    referenceName: "Soda ash (sodium carbonate)",
    relationship: "compound",
    cadence: "monthly",
    referenceUnit: "metric tons of soda ash",
    signalMetric: "U.S. monthly soda-ash production",
    binaryQuestion: "Will the next USGS monthly soda-ash release report higher U.S. production than the preceding release?",
    source: {
      id: "usgs-soda-ash-reference",
      name: "USGS Soda Ash Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/soda-ash-statistics-and-information",
    },
    caveat: "Soda ash is sodium carbonate. Its production is an industrial sodium-demand reference, not a price for elemental sodium.",
    marketUse: "physical-signal",
  },
  potassium: {
    referenceName: "Potash (K2O equivalent)",
    relationship: "compound",
    cadence: "annual",
    referenceUnit: "metric tons K2O equivalent",
    signalMetric: "annual potash production",
    binaryQuestion: "Will the next USGS potash release report lower world production than the preceding annual release?",
    source: {
      id: "usgs-potash-reference",
      name: "USGS Potash Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/potash-statistics-and-information",
    },
    caveat: "Potash is a family of potassium-bearing salts reported as K2O equivalent, not elemental potassium.",
    marketUse: "physical-signal",
  },
  calcium: {
    referenceName: "Coral bleaching stress extent",
    relationship: "application",
    cadence: "daily",
    referenceUnit: "percent of global reef pixels",
    signalMetric: "NOAA 365-day Bleaching Stress Extent",
    binaryQuestion: "Will NOAA's global 365-day Bleaching Stress Extent exceed its frozen opening value on the specified settlement date?",
    source: {
      id: "noaa-coral-reef-watch-reference",
      name: "NOAA Coral Reef Watch 5 km products",
      operator: "U.S. National Oceanic and Atmospheric Administration",
      url: "https://coralreefwatch.noaa.gov/product/5km/index_5km_bse-365d.php",
    },
    caveat: "Coral skeletons are primarily calcium carbonate. Bleaching stress is an application/ecosystem signal and must never be presented as calcium supply, scarcity, or price.",
    marketUse: "application-signal",
  },
  scandium: {
    referenceName: "Scandium oxide and metal",
    relationship: "commercial-form",
    cadence: "annual",
    referenceUnit: "frozen reported scandium grade",
    signalMetric: "USGS scandium supply, demand, and reported price range",
    binaryQuestion: "Will the next USGS scandium release report a higher price for the frozen scandium-oxide grade than the preceding release?",
    source: {
      id: "usgs-scandium-reference",
      name: "USGS Scandium Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/scandium-statistics-and-information",
    },
    caveat: "The contract must freeze one reported grade and form; scandium oxide, alloys, and metal are not interchangeable.",
    marketUse: "physical-signal",
  },
  rubidium: {
    referenceName: "Rubidium compounds",
    relationship: "compound",
    cadence: "annual",
    referenceUnit: "frozen reported compound grade",
    signalMetric: "USGS rubidium availability and reported unit value",
    binaryQuestion: "Will the next USGS rubidium release report a higher unit value for the frozen compound grade than the preceding release?",
    source: {
      id: "usgs-cesium-rubidium-reference",
      name: "USGS Cesium and Rubidium Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/cesium-and-rubidium-statistics-and-information",
    },
    caveat: "Official production data can be absent or withheld. A market is valid only when its exact compound grade is published in both comparison periods.",
    marketUse: "physical-signal",
  },
  yttrium: {
    referenceName: "Yttrium-bearing rare-earth products",
    relationship: "group",
    cadence: "annual",
    referenceUnit: "rare-earth-oxide equivalent",
    signalMetric: "USGS heavy rare-earth group production",
    binaryQuestion: "Will the next USGS heavy rare-earth release report lower group production than the preceding annual release?",
    source: {
      id: "usgs-rare-earths-reference",
      name: "USGS Rare Earths Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/rare-earths-statistics-and-information",
    },
    caveat: "This is group context for yttrium-bearing supply unless the source publishes a separate yttrium observation.",
    marketUse: "physical-signal",
  },
  ruthenium: {
    referenceName: "Ruthenium in the platinum-group market",
    relationship: "group",
    cadence: "annual",
    referenceUnit: "kilograms of metal content",
    signalMetric: "USGS ruthenium consumption, trade, or reported price",
    binaryQuestion: "Will the next USGS platinum-group release report higher ruthenium consumption than the preceding comparable release?",
    source: {
      id: "usgs-pgm-reference",
      name: "USGS Platinum-Group Metals Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/platinum-group-metals-statistics-and-information",
    },
    caveat: "The PGM group series is not an elemental ruthenium inventory. Resolution must use a specifically labeled ruthenium row.",
    marketUse: "physical-signal",
  },
  rhodium: {
    referenceName: "Rhodium in the platinum-group market",
    relationship: "group",
    cadence: "annual",
    referenceUnit: "kilograms of metal content",
    signalMetric: "USGS rhodium consumption, trade, or reported price",
    binaryQuestion: "Will the next USGS platinum-group release report a higher rhodium reference price than the preceding comparable release?",
    source: {
      id: "usgs-pgm-reference",
      name: "USGS Platinum-Group Metals Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/platinum-group-metals-statistics-and-information",
    },
    caveat: "The contract must name the exact rhodium price row and unit; a general PGM move cannot settle a rhodium market.",
    marketUse: "physical-signal",
  },
  caesium: {
    referenceName: "Cesium compounds and formate brines",
    relationship: "compound",
    cadence: "annual",
    referenceUnit: "frozen reported compound grade",
    signalMetric: "USGS cesium availability and reported unit value",
    binaryQuestion: "Will the next USGS cesium release report a higher unit value for the frozen compound grade than the preceding release?",
    source: {
      id: "usgs-cesium-rubidium-reference",
      name: "USGS Cesium and Rubidium Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/cesium-and-rubidium-statistics-and-information",
    },
    caveat: "Cesium forms have different markets and official production may be unavailable. The contract must freeze one form and invalidate missing observations.",
    marketUse: "physical-signal",
  },
  barium: {
    referenceName: "Barite (barium sulfate)",
    relationship: "compound",
    cadence: "annual",
    referenceUnit: "metric tons of barite",
    signalMetric: "USGS barite production and import reliance",
    binaryQuestion: "Will the next USGS barite release report lower world production than the preceding annual release?",
    source: {
      id: "usgs-barite-reference",
      name: "USGS Barite Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/barite-statistics-and-information",
    },
    caveat: "Barite is barium sulfate and the principal traded barium mineral; it is not a price for elemental barium.",
    marketUse: "physical-signal",
  },
  hafnium: {
    referenceName: "Zircon-derived hafnium supply",
    relationship: "group",
    cadence: "annual",
    referenceUnit: "frozen hafnium product form",
    signalMetric: "USGS zirconium-hafnium supply and unit value",
    binaryQuestion: "Will the next USGS zirconium-hafnium release report a higher value for the frozen hafnium product than the preceding release?",
    source: {
      id: "usgs-zirconium-hafnium-reference",
      name: "USGS Zirconium and Hafnium Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/zirconium-and-hafnium-statistics-and-information",
    },
    caveat: "Hafnium is recovered from zirconium supply. Zircon output is a supply-chain proxy unless a separate hafnium row is published.",
    marketUse: "physical-signal",
  },
  osmium: {
    referenceName: "Osmium in the platinum-group market",
    relationship: "group",
    cadence: "annual",
    referenceUnit: "kilograms of metal content",
    signalMetric: "USGS osmium consumption, trade, or reported price",
    binaryQuestion: "Will the next USGS platinum-group release report higher osmium consumption than the preceding comparable release?",
    source: {
      id: "usgs-pgm-reference",
      name: "USGS Platinum-Group Metals Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/platinum-group-metals-statistics-and-information",
    },
    caveat: "Osmium observations are sparse. A missing or aggregated PGM row must invalidate the market rather than be estimated.",
    marketUse: "physical-signal",
  },
  iridium: {
    referenceName: "Iridium in the platinum-group market",
    relationship: "group",
    cadence: "annual",
    referenceUnit: "kilograms of metal content",
    signalMetric: "USGS iridium consumption, trade, or reported price",
    binaryQuestion: "Will the next USGS platinum-group release report higher iridium consumption than the preceding comparable release?",
    source: {
      id: "usgs-pgm-reference",
      name: "USGS Platinum-Group Metals Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/platinum-group-metals-statistics-and-information",
    },
    caveat: "The PGM group series is only context unless a specifically labeled iridium observation is present.",
    marketUse: "physical-signal",
  },
  thallium: {
    referenceName: "Thallium metal and compounds",
    relationship: "commercial-form",
    cadence: "annual",
    referenceUnit: "frozen reported thallium form",
    signalMetric: "USGS thallium supply, demand, and unit value",
    binaryQuestion: "Will the next USGS thallium release report a higher value for the frozen thallium form than the preceding release?",
    source: {
      id: "usgs-thallium-reference",
      name: "USGS Thallium Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/thallium-statistics-and-information",
    },
    caveat: "Thallium is commonly recovered as a by-product. The exact metal or compound form must be frozen in market rules.",
    marketUse: "physical-signal",
  },
  thorium: {
    referenceName: "Thorium and monazite supply",
    relationship: "commercial-form",
    cadence: "annual",
    referenceUnit: "metric tons thorium content",
    signalMetric: "USGS thorium resources, imports, or reported unit value",
    binaryQuestion: "Will the next USGS thorium release report a higher thorium import unit value than the preceding release?",
    source: {
      id: "usgs-thorium-reference",
      name: "USGS Thorium Statistics and Information",
      operator: "U.S. Geological Survey, National Minerals Information Center",
      url: "https://www.usgs.gov/centers/national-minerals-information-center/thorium-statistics-and-information",
    },
    caveat: "Thorium has no deep continuous spot market. Only the exact official annual row named by the rules can be used.",
    marketUse: "physical-signal",
  },
  uranium: {
    referenceName: "Uranium (U3O8 equivalent)",
    relationship: "commercial-form",
    cadence: "quarterly",
    referenceUnit: "pounds U3O8 equivalent",
    signalMetric: "EIA uranium production, purchases, price, and inventories",
    binaryQuestion: "Will the next EIA quarterly uranium report show higher U.S. concentrate production than the preceding quarter?",
    source: {
      id: "eia-uranium-reference",
      name: "EIA Nuclear and Uranium Data",
      operator: "U.S. Energy Information Administration",
      url: "https://www.eia.gov/nuclear/data.php",
    },
    caveat: "The reference is U3O8-equivalent nuclear fuel data. Contract-price, spot-price, inventory, and production rows are separate variables.",
    marketUse: "physical-signal",
  },
});

function observedCommodityReference(metal: MetalDefinition): MetalReferenceMarket {
  const commodity = metal.sourceCommodity;
  if (!commodity) throw new Error(`Observed reference ${metal.id} requires a source commodity.`);
  const group = metal.dataMode === "group";
  return {
    metalId: metal.id,
    referenceName: `${commodity.commodity} — ${commodity.commercialForm}`,
    relationship: group ? "group" : "commercial-form",
    coverageStage: "observed",
    cadence: "annual",
    referenceUnit: commodity.commercialForm,
    signalMetric: `USGS annual ${commodity.commodity.toLowerCase()} production`,
    binaryQuestion: `Will the next USGS ${commodity.commodity} release report lower world production than the preceding annual release?`,
    source: USGS_MCS_SOURCE,
    caveat: group
      ? `The official source reports ${commodity.commodity} as a group. It must not be represented as an element-specific price or inventory.`
      : `The reference follows the named commercial form “${commodity.commercialForm}”; other grades and forms are not interchangeable.`,
    marketUse: "physical-signal",
    settlementReadiness: "research-only",
  };
}

function scientificReference(metal: MetalDefinition): MetalReferenceMarket {
  return {
    metalId: metal.id,
    referenceName: `${metal.name} evaluated nuclide record`,
    relationship: metal.atomicNumber <= 98 ? "isotope" : "scientific",
    coverageStage: "scientific",
    cadence: "event-driven",
    referenceUnit: "evaluated nuclide record",
    signalMetric: "IAEA LiveChart evaluated-record publication",
    binaryQuestion: `Will the IAEA LiveChart dataset add or revise an evaluated nuclide record for ${metal.name} during the specified observation window?`,
    source: IAEA_LIVECHART_SOURCE,
    caveat: `${metal.name} has no open commodity market. This is an objective scientific-event reference only and cannot produce a metal scarcity score or elemental price.`,
    marketUse: "scientific-event-only",
    settlementReadiness: "research-only",
  };
}

function referenceForMetal(metal: MetalDefinition): MetalReferenceMarket {
  if (metal.sourceCommodity) return observedCommodityReference(metal);
  const specialized = specializedReferences[metal.id];
  if (specialized) {
    return {
      metalId: metal.id,
      ...specialized,
      coverageStage: "mapped",
      settlementReadiness: "research-only",
    };
  }
  return scientificReference(metal);
}

export const METAL_REFERENCE_MARKETS = Object.freeze(SCARCITY_METALS.map(referenceForMetal));

export const METAL_REFERENCE_MARKET_BY_ID = Object.freeze(
  Object.fromEntries(METAL_REFERENCE_MARKETS.map((reference) => [reference.metalId, reference])) as Record<string, MetalReferenceMarket>,
);

export const METAL_REFERENCE_COVERAGE = Object.freeze({
  mapped: METAL_REFERENCE_MARKETS.length,
  unmapped: SCARCITY_METALS.filter((metal) => !METAL_REFERENCE_MARKET_BY_ID[metal.id]).length,
  observed: METAL_REFERENCE_MARKETS.filter((reference) => reference.coverageStage === "observed").length,
  proxy: METAL_REFERENCE_MARKETS.filter((reference) => reference.coverageStage === "mapped").length,
  scientific: METAL_REFERENCE_MARKETS.filter((reference) => reference.coverageStage === "scientific").length,
});

export function getMetalReferenceMarket(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  const metal = SCARCITY_METALS.find((candidate) =>
    candidate.id === normalized || candidate.symbol.toLowerCase() === normalized,
  );
  return metal ? METAL_REFERENCE_MARKET_BY_ID[metal.id] : null;
}
