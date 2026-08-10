export type ElementCategory =
  | "alkali-metal"
  | "alkaline-earth-metal"
  | "transition-metal"
  | "post-transition-metal"
  | "lanthanide"
  | "actinide"
  | "metalloid"
  | "reactive-nonmetal"
  | "halogen"
  | "noble-gas";

export interface PeriodicElement {
  atomicNumber: number;
  symbol: string;
  name: string;
  period: number;
  group: number | null;
  displayRow: number;
  displayColumn: number;
  category: ElementCategory;
  isMetal: boolean;
}

type ElementSeed = readonly [
  atomicNumber: number,
  symbol: string,
  name: string,
  period: number,
  group: number | null,
  displayRow: number,
  displayColumn: number,
  category: ElementCategory,
];

const seeds: ElementSeed[] = [
  [1, "H", "Hydrogen", 1, 1, 1, 1, "reactive-nonmetal"],
  [2, "He", "Helium", 1, 18, 1, 18, "noble-gas"],
  [3, "Li", "Lithium", 2, 1, 2, 1, "alkali-metal"],
  [4, "Be", "Beryllium", 2, 2, 2, 2, "alkaline-earth-metal"],
  [5, "B", "Boron", 2, 13, 2, 13, "metalloid"],
  [6, "C", "Carbon", 2, 14, 2, 14, "reactive-nonmetal"],
  [7, "N", "Nitrogen", 2, 15, 2, 15, "reactive-nonmetal"],
  [8, "O", "Oxygen", 2, 16, 2, 16, "reactive-nonmetal"],
  [9, "F", "Fluorine", 2, 17, 2, 17, "halogen"],
  [10, "Ne", "Neon", 2, 18, 2, 18, "noble-gas"],
  [11, "Na", "Sodium", 3, 1, 3, 1, "alkali-metal"],
  [12, "Mg", "Magnesium", 3, 2, 3, 2, "alkaline-earth-metal"],
  [13, "Al", "Aluminium", 3, 13, 3, 13, "post-transition-metal"],
  [14, "Si", "Silicon", 3, 14, 3, 14, "metalloid"],
  [15, "P", "Phosphorus", 3, 15, 3, 15, "reactive-nonmetal"],
  [16, "S", "Sulfur", 3, 16, 3, 16, "reactive-nonmetal"],
  [17, "Cl", "Chlorine", 3, 17, 3, 17, "halogen"],
  [18, "Ar", "Argon", 3, 18, 3, 18, "noble-gas"],
  [19, "K", "Potassium", 4, 1, 4, 1, "alkali-metal"],
  [20, "Ca", "Calcium", 4, 2, 4, 2, "alkaline-earth-metal"],
  [21, "Sc", "Scandium", 4, 3, 4, 3, "transition-metal"],
  [22, "Ti", "Titanium", 4, 4, 4, 4, "transition-metal"],
  [23, "V", "Vanadium", 4, 5, 4, 5, "transition-metal"],
  [24, "Cr", "Chromium", 4, 6, 4, 6, "transition-metal"],
  [25, "Mn", "Manganese", 4, 7, 4, 7, "transition-metal"],
  [26, "Fe", "Iron", 4, 8, 4, 8, "transition-metal"],
  [27, "Co", "Cobalt", 4, 9, 4, 9, "transition-metal"],
  [28, "Ni", "Nickel", 4, 10, 4, 10, "transition-metal"],
  [29, "Cu", "Copper", 4, 11, 4, 11, "transition-metal"],
  [30, "Zn", "Zinc", 4, 12, 4, 12, "transition-metal"],
  [31, "Ga", "Gallium", 4, 13, 4, 13, "post-transition-metal"],
  [32, "Ge", "Germanium", 4, 14, 4, 14, "metalloid"],
  [33, "As", "Arsenic", 4, 15, 4, 15, "metalloid"],
  [34, "Se", "Selenium", 4, 16, 4, 16, "reactive-nonmetal"],
  [35, "Br", "Bromine", 4, 17, 4, 17, "halogen"],
  [36, "Kr", "Krypton", 4, 18, 4, 18, "noble-gas"],
  [37, "Rb", "Rubidium", 5, 1, 5, 1, "alkali-metal"],
  [38, "Sr", "Strontium", 5, 2, 5, 2, "alkaline-earth-metal"],
  [39, "Y", "Yttrium", 5, 3, 5, 3, "transition-metal"],
  [40, "Zr", "Zirconium", 5, 4, 5, 4, "transition-metal"],
  [41, "Nb", "Niobium", 5, 5, 5, 5, "transition-metal"],
  [42, "Mo", "Molybdenum", 5, 6, 5, 6, "transition-metal"],
  [43, "Tc", "Technetium", 5, 7, 5, 7, "transition-metal"],
  [44, "Ru", "Ruthenium", 5, 8, 5, 8, "transition-metal"],
  [45, "Rh", "Rhodium", 5, 9, 5, 9, "transition-metal"],
  [46, "Pd", "Palladium", 5, 10, 5, 10, "transition-metal"],
  [47, "Ag", "Silver", 5, 11, 5, 11, "transition-metal"],
  [48, "Cd", "Cadmium", 5, 12, 5, 12, "transition-metal"],
  [49, "In", "Indium", 5, 13, 5, 13, "post-transition-metal"],
  [50, "Sn", "Tin", 5, 14, 5, 14, "post-transition-metal"],
  [51, "Sb", "Antimony", 5, 15, 5, 15, "metalloid"],
  [52, "Te", "Tellurium", 5, 16, 5, 16, "metalloid"],
  [53, "I", "Iodine", 5, 17, 5, 17, "halogen"],
  [54, "Xe", "Xenon", 5, 18, 5, 18, "noble-gas"],
  [55, "Cs", "Caesium", 6, 1, 6, 1, "alkali-metal"],
  [56, "Ba", "Barium", 6, 2, 6, 2, "alkaline-earth-metal"],
  [57, "La", "Lanthanum", 6, 3, 6, 3, "lanthanide"],
  [72, "Hf", "Hafnium", 6, 4, 6, 4, "transition-metal"],
  [73, "Ta", "Tantalum", 6, 5, 6, 5, "transition-metal"],
  [74, "W", "Tungsten", 6, 6, 6, 6, "transition-metal"],
  [75, "Re", "Rhenium", 6, 7, 6, 7, "transition-metal"],
  [76, "Os", "Osmium", 6, 8, 6, 8, "transition-metal"],
  [77, "Ir", "Iridium", 6, 9, 6, 9, "transition-metal"],
  [78, "Pt", "Platinum", 6, 10, 6, 10, "transition-metal"],
  [79, "Au", "Gold", 6, 11, 6, 11, "transition-metal"],
  [80, "Hg", "Mercury", 6, 12, 6, 12, "transition-metal"],
  [81, "Tl", "Thallium", 6, 13, 6, 13, "post-transition-metal"],
  [82, "Pb", "Lead", 6, 14, 6, 14, "post-transition-metal"],
  [83, "Bi", "Bismuth", 6, 15, 6, 15, "post-transition-metal"],
  [84, "Po", "Polonium", 6, 16, 6, 16, "post-transition-metal"],
  [85, "At", "Astatine", 6, 17, 6, 17, "halogen"],
  [86, "Rn", "Radon", 6, 18, 6, 18, "noble-gas"],
  [87, "Fr", "Francium", 7, 1, 7, 1, "alkali-metal"],
  [88, "Ra", "Radium", 7, 2, 7, 2, "alkaline-earth-metal"],
  [89, "Ac", "Actinium", 7, 3, 7, 3, "actinide"],
  [104, "Rf", "Rutherfordium", 7, 4, 7, 4, "transition-metal"],
  [105, "Db", "Dubnium", 7, 5, 7, 5, "transition-metal"],
  [106, "Sg", "Seaborgium", 7, 6, 7, 6, "transition-metal"],
  [107, "Bh", "Bohrium", 7, 7, 7, 7, "transition-metal"],
  [108, "Hs", "Hassium", 7, 8, 7, 8, "transition-metal"],
  [109, "Mt", "Meitnerium", 7, 9, 7, 9, "transition-metal"],
  [110, "Ds", "Darmstadtium", 7, 10, 7, 10, "transition-metal"],
  [111, "Rg", "Roentgenium", 7, 11, 7, 11, "transition-metal"],
  [112, "Cn", "Copernicium", 7, 12, 7, 12, "transition-metal"],
  [113, "Nh", "Nihonium", 7, 13, 7, 13, "post-transition-metal"],
  [114, "Fl", "Flerovium", 7, 14, 7, 14, "post-transition-metal"],
  [115, "Mc", "Moscovium", 7, 15, 7, 15, "post-transition-metal"],
  [116, "Lv", "Livermorium", 7, 16, 7, 16, "post-transition-metal"],
  [117, "Ts", "Tennessine", 7, 17, 7, 17, "halogen"],
  [118, "Og", "Oganesson", 7, 18, 7, 18, "noble-gas"],
  [58, "Ce", "Cerium", 6, null, 8, 4, "lanthanide"],
  [59, "Pr", "Praseodymium", 6, null, 8, 5, "lanthanide"],
  [60, "Nd", "Neodymium", 6, null, 8, 6, "lanthanide"],
  [61, "Pm", "Promethium", 6, null, 8, 7, "lanthanide"],
  [62, "Sm", "Samarium", 6, null, 8, 8, "lanthanide"],
  [63, "Eu", "Europium", 6, null, 8, 9, "lanthanide"],
  [64, "Gd", "Gadolinium", 6, null, 8, 10, "lanthanide"],
  [65, "Tb", "Terbium", 6, null, 8, 11, "lanthanide"],
  [66, "Dy", "Dysprosium", 6, null, 8, 12, "lanthanide"],
  [67, "Ho", "Holmium", 6, null, 8, 13, "lanthanide"],
  [68, "Er", "Erbium", 6, null, 8, 14, "lanthanide"],
  [69, "Tm", "Thulium", 6, null, 8, 15, "lanthanide"],
  [70, "Yb", "Ytterbium", 6, null, 8, 16, "lanthanide"],
  [71, "Lu", "Lutetium", 6, null, 8, 17, "lanthanide"],
  [90, "Th", "Thorium", 7, null, 9, 4, "actinide"],
  [91, "Pa", "Protactinium", 7, null, 9, 5, "actinide"],
  [92, "U", "Uranium", 7, null, 9, 6, "actinide"],
  [93, "Np", "Neptunium", 7, null, 9, 7, "actinide"],
  [94, "Pu", "Plutonium", 7, null, 9, 8, "actinide"],
  [95, "Am", "Americium", 7, null, 9, 9, "actinide"],
  [96, "Cm", "Curium", 7, null, 9, 10, "actinide"],
  [97, "Bk", "Berkelium", 7, null, 9, 11, "actinide"],
  [98, "Cf", "Californium", 7, null, 9, 12, "actinide"],
  [99, "Es", "Einsteinium", 7, null, 9, 13, "actinide"],
  [100, "Fm", "Fermium", 7, null, 9, 14, "actinide"],
  [101, "Md", "Mendelevium", 7, null, 9, 15, "actinide"],
  [102, "No", "Nobelium", 7, null, 9, 16, "actinide"],
  [103, "Lr", "Lawrencium", 7, null, 9, 17, "actinide"],
];

const metalCategories = new Set<ElementCategory>([
  "alkali-metal",
  "alkaline-earth-metal",
  "transition-metal",
  "post-transition-metal",
  "lanthanide",
  "actinide",
]);

export const PERIODIC_ELEMENTS: readonly PeriodicElement[] = Object.freeze(
  seeds
    .map(([atomicNumber, symbol, name, period, group, displayRow, displayColumn, category]) => ({
      atomicNumber,
      symbol,
      name,
      period,
      group,
      displayRow,
      displayColumn,
      category,
      isMetal: metalCategories.has(category),
    }))
    .sort((left, right) => left.atomicNumber - right.atomicNumber),
);

export const PERIODIC_ELEMENT_BY_SYMBOL = Object.freeze(
  Object.fromEntries(PERIODIC_ELEMENTS.map((element) => [element.symbol.toLowerCase(), element])) as Record<string, PeriodicElement>,
);

export function getPeriodicElement(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  return PERIODIC_ELEMENTS.find(
    (element) => element.symbol.toLowerCase() === normalized || element.name.toLowerCase() === normalized,
  ) ?? null;
}
