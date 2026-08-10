export type CommodityReportingMode = "direct" | "group";

export interface UsgsCommodityMapping {
  metalIds: readonly string[];
  chapter: string;
  commodity: string;
  commercialForm: string;
  reportingMode: CommodityReportingMode;
  productionDetails: readonly string[];
  reserveDetails?: readonly string[];
  reserveUnitOverride?: string;
  notes?: string;
}

const rareEarthMetalIds = [
  "lanthanum",
  "cerium",
  "praseodymium",
  "neodymium",
  "samarium",
  "europium",
  "gadolinium",
  "terbium",
  "dysprosium",
  "holmium",
  "erbium",
  "thulium",
  "ytterbium",
  "lutetium",
] as const;

/**
 * The mapping is deliberately commodity-form aware. USGS reports several metals
 * as oxides, concentrates, or groups; those rows must never be presented as a
 * pure-element spot price or as element-specific production when the mode is
 * `group`.
 */
export const USGS_MCS_2026_COMMODITY_MAPPINGS: readonly UsgsCommodityMapping[] = Object.freeze([
  { metalIds: ["aluminium"], chapter: "ALUMINUM", commodity: "Aluminum", commercialForm: "primary smelter metal", reportingMode: "direct", productionDetails: ["Smelter production"] },
  { metalIds: ["antimony"], chapter: "ANTIMONY", commodity: "Antimony", commercialForm: "antimony content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["arsenic"], chapter: "ARSENIC", commodity: "Arsenic", commercialForm: "arsenic trioxide, gross weight", reportingMode: "direct", productionDetails: ["Production (arsenic trioxide, gross weight)"] },
  { metalIds: ["beryllium"], chapter: "BERYLLIUM", commodity: "Beryllium", commercialForm: "beryllium content", reportingMode: "direct", productionDetails: ["Mine production"] },
  { metalIds: ["bismuth"], chapter: "BISMUTH", commodity: "Bismuth", commercialForm: "refined bismuth", reportingMode: "direct", productionDetails: ["Refinery production"] },
  { metalIds: ["cadmium"], chapter: "CADMIUM", commodity: "Cadmium", commercialForm: "refined cadmium", reportingMode: "direct", productionDetails: ["Refinery production"] },
  { metalIds: ["chromium"], chapter: "CHROMIUM", commodity: "Chromium", commercialForm: "chromite ore", reportingMode: "direct", productionDetails: ["Mine production"], notes: "USGS reserve totals are reported as lower bounds and are not converted into point reserve-life estimates." },
  { metalIds: ["cobalt"], chapter: "COBALT", commodity: "Cobalt", commercialForm: "cobalt content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["copper"], chapter: "COPPER", commodity: "Copper", commercialForm: "mine copper content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["gallium"], chapter: "GALLIUM", commodity: "Gallium", commercialForm: "low-purity primary gallium", reportingMode: "direct", productionDetails: ["Primary production"] },
  { metalIds: ["gold"], chapter: "GOLD", commodity: "Gold", commercialForm: "mine gold content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["indium"], chapter: "INDIUM", commodity: "Indium", commercialForm: "refined indium", reportingMode: "direct", productionDetails: ["Refinery production"] },
  { metalIds: ["iron"], chapter: "IRON ORE", commodity: "Iron Ore", commercialForm: "contained iron in ore", reportingMode: "direct", productionDetails: ["Mine production: Iron content"], reserveDetails: ["Reserves (million metric tons): Iron content"] },
  { metalIds: ["lead"], chapter: "LEAD", commodity: "Lead", commercialForm: "mine lead content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["lithium"], chapter: "LITHIUM", commodity: "Lithium", commercialForm: "lithium content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["magnesium"], chapter: "MAGNESIUM METAL", commodity: "Magnesium Metal", commercialForm: "primary magnesium metal", reportingMode: "direct", productionDetails: ["Smelter production"] },
  { metalIds: ["manganese"], chapter: "MANGANESE", commodity: "Manganese", commercialForm: "manganese content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["mercury"], chapter: "MERCURY", commodity: "Mercury", commercialForm: "mine mercury content", reportingMode: "direct", productionDetails: ["Mine production"] },
  { metalIds: ["molybdenum"], chapter: "MOLYBDENUM", commodity: "Molybdenum", commercialForm: "molybdenum content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves (thousand metric tons)"] },
  { metalIds: ["nickel"], chapter: "NICKEL", commodity: "Nickel", commercialForm: "mine nickel content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["niobium"], chapter: "NIOBIUM (COLUMBIUM)", commodity: "Niobium (Columbium)", commercialForm: "niobium content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["palladium"], chapter: "PLATINUM-GROUP METALS", commodity: "Palladium", commercialForm: "mine palladium content", reportingMode: "direct", productionDetails: ["Mine production: Palladium"] },
  { metalIds: ["platinum"], chapter: "PLATINUM-GROUP METALS", commodity: "Platinum", commercialForm: "mine platinum content", reportingMode: "direct", productionDetails: ["Mine production: Platinum"] },
  { metalIds: rareEarthMetalIds, chapter: "RARE EARTHS", commodity: "Rare Earths", commercialForm: "rare-earth-oxide equivalent, group total", reportingMode: "group", productionDetails: ["Mine production"], notes: "USGS reports the lanthanides as a rare-earth group. Group observations are repeated across member cells only as explicitly labeled group context." },
  { metalIds: ["rhenium"], chapter: "RHENIUM", commodity: "Rhenium", commercialForm: "mine rhenium content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["selenium"], chapter: "SELENIUM", commodity: "Selenium", commercialForm: "refinery selenium", reportingMode: "direct", productionDetails: ["Refinery production"] },
  { metalIds: ["silicon"], chapter: "SILICON", commodity: "Silicon", commercialForm: "silicon metal", reportingMode: "direct", productionDetails: ["Silicon metal"] },
  { metalIds: ["silver"], chapter: "SILVER", commodity: "Silver", commercialForm: "mine silver content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["strontium"], chapter: "STRONTIUM", commodity: "Strontium", commercialForm: "celestite mineral concentrate", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["tantalum"], chapter: "TANTALUM", commodity: "Tantalum", commercialForm: "tantalum content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["tellurium"], chapter: "TELLURIUM", commodity: "Tellurium", commercialForm: "refinery tellurium", reportingMode: "direct", productionDetails: ["Refinery production"] },
  { metalIds: ["tin"], chapter: "TIN", commodity: "Tin", commercialForm: "mine tin content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["titanium"], chapter: "TITANIUM MINERAL CONCENTRATES", commodity: "Titanium Mineral Concentrates", commercialForm: "ilmenite mineral concentrate", reportingMode: "direct", productionDetails: ["Mine production: Ilmenite"], notes: "The baseline uses ilmenite only so country values and world totals remain comparable; rutile is retained in the source artifact but not added to this metric." },
  { metalIds: ["tungsten"], chapter: "TUNGSTEN", commodity: "Tungsten", commercialForm: "tungsten content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["vanadium"], chapter: "VANADIUM", commodity: "Vanadium", commercialForm: "vanadium content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"], reserveUnitOverride: "thousand metric tons", notes: "The USGS table header reports reserves in thousand metric tons; the CSV row unit omits that table-level qualifier, so the importer applies the published header explicitly." },
  { metalIds: ["zinc"], chapter: "ZINC", commodity: "Zinc", commercialForm: "mine zinc content", reportingMode: "direct", productionDetails: ["Mine production"], reserveDetails: ["Reserves"] },
  { metalIds: ["zirconium"], chapter: "ZIRCONIUM AND HAFNIUM", commodity: "Zirconium", commercialForm: "zirconium mineral concentrates", reportingMode: "direct", productionDetails: ["Zirconium mineral concentrates, mine production (thousand metric tons, gross weight)"], reserveDetails: ["Zirconium reserves(thousand metric tons, ZrO2 content)"], notes: "Reserve and production forms differ, so the importer refuses to derive reserve life unless units and forms are explicitly compatible." },
]);

export const USGS_MAPPING_BY_METAL_ID = Object.freeze(
  Object.fromEntries(USGS_MCS_2026_COMMODITY_MAPPINGS.flatMap((mapping) =>
    mapping.metalIds.map((metalId) => [metalId, mapping]),
  )) as Record<string, UsgsCommodityMapping>,
);

/**
 * Every element classified as a metalloid by the periodic-table registry is
 * intentionally part of the Hedgents material universe. This list is the
 * inclusion policy; USGS mapping availability must never decide whether a
 * cell exists in the product.
 */
export const TRACKED_METALLOID_IDS = Object.freeze(new Set([
  "boron",
  "arsenic",
  "antimony",
  "germanium",
  "silicon",
  "tellurium",
]));

/**
 * Selenium is commonly covered by minor-metal market datasets despite its
 * periodic-table classification as a nonmetal. Keep that exception explicit
 * instead of admitting it accidentally through a source mapping.
 */
export const TRACKED_NONMETAL_COMMODITY_IDS = Object.freeze(new Set([
  "selenium",
]));

/** @deprecated Use TRACKED_METALLOID_IDS. */
export const STRATEGIC_METALLOID_IDS = TRACKED_METALLOID_IDS;
