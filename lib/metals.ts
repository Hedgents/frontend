export type ExposureLane = "Own" | "Invest" | "Hedge";

export type ProductAvailability = "Executable" | "Indicative" | "Discovery";

export interface MetalProduct {
  id: string;
  name: string;
  ticker: string;
  lane: ExposureLane;
  availability: ProductAvailability;
  issuer: string;
  structure: string;
  backing: string;
  custody: string;
  redemption: string;
  eligibility: string;
  settlementChain: string;
  nativeChain: string;
  venue: string;
  allInFeeBps: number | null;
  referencePriceUsd?: number;
  liquidity: string;
  verified: string;
  route: string[];
  risk: string;
  hedgeMarket?: string;
  hedgeDepth?: string;
}

export interface MetalMarket {
  id: string;
  symbol: string;
  atomicNumber: number;
  name: string;
  family: "Precious" | "Industrial" | "Energy transition";
  referencePrice: number;
  unit: string;
  change24h: number;
  liquidity: string;
  availability: ProductAvailability;
  products: MetalProduct[];
}

type SolanaProductDefinition = Omit<
  MetalProduct,
  | "availability"
  | "settlementChain"
  | "nativeChain"
  | "venue"
  | "allInFeeBps"
  | "liquidity"
  | "verified"
  | "route"
>;

function solanaProduct(definition: SolanaProductDefinition): MetalProduct {
  return {
    ...definition,
    availability: "Executable",
    settlementChain: "Solana",
    nativeChain: "Solana mainnet · canonical mint pinned",
    venue: "Jupiter Swap V2",
    allInFeeBps: 0,
    liquidity: "Live $100 route gate; exact size is re-quoted and simulated before signing",
    verified: "Issuer + Jupiter directory + on-chain mint · 2026-08-03",
    route: ["Solana USDC", "Jupiter Swap V2", definition.ticker],
  };
}

const XSTOCKS_ELIGIBILITY =
  "xStocks eligibility, jurisdiction, transfer, and market-access restrictions apply";
const ONDO_ELIGIBILITY =
  "Ondo eligibility, jurisdiction, transfer, and market-hours restrictions apply";
const XSTOCKS_CUSTODY = "Underlying security held through the xStocks backing arrangement";
const ONDO_CUSTODY = "Underlying security held through Ondo Global Markets' custody arrangement";

/**
 * Per-metal accent tones, used for the periodic tiles and the execution rail.
 * The single source of truth — components read from here rather than defining
 * their own copy, so a metal reads the same colour whether it is a tile, a
 * selected row, or the route that delivers it.
 */
export const DEFAULT_ELEMENT_TONE = "#cf9e47";
export const elementTones: Record<string, string> = {
  Au: "#d7a64b",
  Ag: "#cad2d3",
  U: "#92aa76",
  Pt: "#dedbd1",
  Cu: "#c97b4d",
  Pd: "#b9c4c5",
  Ni: "#87938d",
};

export const metalMarkets: MetalMarket[] = [
  {
    id: "gold",
    symbol: "Au",
    atomicNumber: 79,
    name: "Gold",
    family: "Precious",
    referencePrice: 2381.2,
    unit: "oz",
    change24h: 0.84,
    liquidity: "Five Solana products",
    availability: "Executable",
    products: [
      solanaProduct({
        id: "gold-paxg",
        name: "PAX Gold",
        ticker: "PAXG",
        lane: "Own",
        issuer: "Paxos Trust Company",
        structure: "Issuer-backed physical gold token",
        backing: "Allocated London Good Delivery gold",
        custody: "Issuer-appointed professional vault network",
        redemption: "Subject to Paxos account, minimums, fees, and jurisdiction",
        eligibility: "Paxos wallet-screening and jurisdiction restrictions apply",
        risk: "Issuer, custodian, Token-2022 control, liquidity, and redemption risks remain.",
        hedgeMarket: "xyz:GOLD · Hyperliquid",
        hedgeDepth: "Live depth and basis check required",
      }),
      solanaProduct({
        id: "gold-oro",
        name: "Oro GOLD",
        ticker: "GOLD",
        lane: "Own",
        issuer: "Third-party regulated token issuer surfaced by Oro",
        structure: "Third-party issuer-backed physical gold token",
        backing: "1:1 physical gold backing represented through Oro's provider network",
        custody: "Third-party vault and custody providers disclosed by Oro",
        redemption: "Physical or cash redemption depends on third-party provider terms",
        eligibility: "Third-party KYC, minimum, and jurisdiction rules apply",
        risk: "Issuer attribution, custody, audit, redemption-partner, and liquidity risks remain.",
        hedgeMarket: "xyz:GOLD · Hyperliquid",
        hedgeDepth: "Live depth and basis check required",
      }),
      solanaProduct({
        id: "gold-xaum",
        name: "Matrixdock XAUm",
        ticker: "XAUm",
        lane: "Own",
        issuer: "Matrixdock",
        structure: "Issuer-backed physical gold token",
        backing: "One troy ounce of 99.99% LBMA-accredited physical gold per token",
        custody: "Professional physical-gold vault network disclosed by Matrixdock",
        redemption: "Physical redemption subject to onboarding, location, minimums, and fees",
        eligibility: "Matrixdock onboarding and jurisdiction restrictions apply",
        risk: "Issuer, custodian, Token-2022 control, audit, redemption, and liquidity risks remain.",
        hedgeMarket: "xyz:GOLD · Hyperliquid",
        hedgeDepth: "Live depth and basis check required",
      }),
      solanaProduct({
        id: "gold-gldx",
        name: "xStocks SPDR Gold Shares",
        ticker: "GLDx",
        lane: "Invest",
        issuer: "Backed Assets / xStocks",
        structure: "Tokenized GLD ETF exposure",
        backing: "Economic exposure backed by SPDR Gold Shares",
        custody: XSTOCKS_CUSTODY,
        redemption: "Security-token redemption; no direct retail claim on a physical bar",
        eligibility: XSTOCKS_ELIGIBILITY,
        risk: "A tokenized security is not direct metal ownership; issuer, tracking, control, and market-hours risks apply.",
        hedgeMarket: "xyz:GOLD · Hyperliquid",
        hedgeDepth: "Live depth and basis check required",
      }),
      solanaProduct({
        id: "gold-gldon",
        name: "Ondo SPDR Gold Shares",
        ticker: "GLDon",
        lane: "Invest",
        issuer: "Ondo Global Markets (BVI) Limited",
        structure: "Tokenized GLD ETF economic exposure",
        backing: "Economic exposure backed by SPDR Gold Shares",
        custody: ONDO_CUSTODY,
        redemption: "Token redemption under Ondo terms; no direct retail claim on a physical bar",
        eligibility: ONDO_ELIGIBILITY,
        risk: "The token conveys economic exposure rather than underlying shareholder rights; issuer, tracking, and control risks apply.",
        hedgeMarket: "xyz:GOLD · Hyperliquid",
        hedgeDepth: "Live depth and basis check required",
      }),
    ],
  },
  {
    id: "silver",
    symbol: "Ag",
    atomicNumber: 47,
    name: "Silver",
    family: "Precious",
    referencePrice: 31.42,
    unit: "oz",
    change24h: 1.36,
    liquidity: "One executable and one indicative Solana product",
    availability: "Executable",
    products: [
      solanaProduct({
        id: "silver-slvx",
        name: "xStocks iShares Silver Trust",
        ticker: "SLVx",
        lane: "Invest",
        issuer: "Backed Assets / xStocks",
        structure: "Tokenized SLV trust exposure",
        backing: "Economic exposure backed by iShares Silver Trust",
        custody: XSTOCKS_CUSTODY,
        redemption: "Security-token redemption; no direct retail bar claim",
        eligibility: XSTOCKS_ELIGIBILITY,
        risk: "Fund tracking, issuer, Token-2022 control, liquidity, and transfer-restriction risks apply.",
        hedgeMarket: "xyz:SILVER · Hyperliquid",
        hedgeDepth: "Live depth and basis check required",
      }),
      solanaProduct({
        id: "silver-slvon",
        name: "Ondo iShares Silver Trust",
        ticker: "SLVon",
        lane: "Invest",
        issuer: "Ondo Global Markets (BVI) Limited",
        structure: "Tokenized SLV trust economic exposure",
        backing: "Economic exposure backed by iShares Silver Trust",
        custody: ONDO_CUSTODY,
        redemption: "Token redemption under Ondo terms; no direct retail bar claim",
        eligibility: ONDO_ELIGIBILITY,
        risk: "Economic exposure is not direct silver ownership; issuer, tracking, control, and market-hours risks apply.",
        hedgeMarket: "xyz:SILVER · Hyperliquid",
        hedgeDepth: "Live depth and basis check required",
      }),
    ],
  },
  {
    id: "uranium",
    symbol: "U",
    atomicNumber: 92,
    name: "Uranium",
    family: "Energy transition",
    referencePrice: 82.64,
    unit: "lb",
    change24h: -0.42,
    liquidity: "Three Solana ETF products",
    availability: "Executable",
    products: [
      solanaProduct({
        id: "uranium-urax",
        name: "xStocks Global X Uranium ETF",
        ticker: "URAx",
        lane: "Invest",
        issuer: "Backed Assets / xStocks",
        structure: "Tokenized uranium-industry ETF exposure",
        backing: "Economic exposure backed by Global X Uranium ETF",
        custody: XSTOCKS_CUSTODY,
        redemption: "Security-token redemption under xStocks terms",
        eligibility: XSTOCKS_ELIGIBILITY,
        risk: "This is uranium-industry equity exposure, not uranium spot; equity, issuer, and transfer risks apply.",
      }),
      solanaProduct({
        id: "uranium-uraon",
        name: "Ondo Global X Uranium ETF",
        ticker: "URAon",
        lane: "Invest",
        issuer: "Ondo Global Markets (BVI) Limited",
        structure: "Tokenized uranium-industry ETF economic exposure",
        backing: "Economic exposure backed by Global X Uranium ETF",
        custody: ONDO_CUSTODY,
        redemption: "Token redemption under Ondo terms",
        eligibility: ONDO_ELIGIBILITY,
        risk: "This is uranium-industry equity exposure, not uranium spot; issuer, equity, tracking, and control risks apply.",
      }),
      solanaProduct({
        id: "uranium-urnmon",
        name: "Ondo Sprott Uranium Miners ETF",
        ticker: "URNMon",
        lane: "Invest",
        issuer: "Ondo Global Markets (BVI) Limited",
        structure: "Tokenized uranium-miners ETF economic exposure",
        backing: "Economic exposure backed by Sprott Uranium Miners ETF",
        custody: ONDO_CUSTODY,
        redemption: "Token redemption under Ondo terms",
        eligibility: ONDO_ELIGIBILITY,
        risk: "Miner equities can diverge materially from uranium spot; issuer, equity, tracking, and control risks apply.",
      }),
    ],
  },
  {
    id: "platinum",
    symbol: "Pt",
    atomicNumber: 78,
    name: "Platinum",
    family: "Precious",
    referencePrice: 997.8,
    unit: "oz",
    change24h: -0.18,
    liquidity: "One live; one monitored",
    availability: "Executable",
    products: [
      solanaProduct({
        id: "platinum-pplton",
        name: "Ondo Physical Platinum Shares",
        ticker: "PPLTon",
        lane: "Invest",
        issuer: "Ondo Global Markets (BVI) Limited",
        structure: "Tokenized PPLT trust economic exposure",
        backing: "Economic exposure backed by abrdn Physical Platinum Shares ETF",
        custody: ONDO_CUSTODY,
        redemption: "Token redemption under Ondo terms; no direct retail bar claim",
        eligibility: ONDO_ELIGIBILITY,
        risk: "Economic exposure is not direct platinum ownership; issuer, tracking, control, and liquidity risks apply.",
      }),
      {
        id: "platinum-ppltx",
        name: "xStocks Physical Platinum Shares",
        ticker: "PPLTx",
        lane: "Invest",
        availability: "Discovery",
        issuer: "Backed Assets / xStocks",
        structure: "Canonical Solana token; execution not activated",
        backing: "Economic exposure backed by abrdn Physical Platinum Shares ETF",
        custody: XSTOCKS_CUSTODY,
        redemption: "Security-token redemption under xStocks terms",
        eligibility: XSTOCKS_ELIGIBILITY,
        settlementChain: "Solana",
        nativeChain: "Solana mainnet · canonical mint verified",
        venue: "No current Jupiter route",
        allInFeeBps: null,
        liquidity: "$100 route probe returned no market-maker quote on 2026-08-03",
        verified: "Canonical product; liquidity gate failed · 2026-08-03",
        route: ["Monitor Jupiter route"],
        risk: "A verified token without a live route is not presented as executable.",
      },
    ],
  },
  {
    id: "copper",
    symbol: "Cu",
    atomicNumber: 29,
    name: "Copper",
    family: "Industrial",
    referencePrice: 5.86,
    unit: "lb",
    change24h: 0.63,
    liquidity: "Three Solana fund products",
    availability: "Executable",
    products: [
      solanaProduct({
        id: "copper-copxx",
        name: "xStocks Global X Copper Miners ETF",
        ticker: "COPXx",
        lane: "Invest",
        issuer: "Backed Assets / xStocks",
        structure: "Tokenized copper-miners ETF exposure",
        backing: "Economic exposure backed by Global X Copper Miners ETF",
        custody: XSTOCKS_CUSTODY,
        redemption: "Security-token redemption under xStocks terms",
        eligibility: XSTOCKS_ELIGIBILITY,
        risk: "Miner equities can diverge from copper spot; equity, issuer, control, and transfer risks apply.",
        hedgeMarket: "xyz:COPPER · Hyperliquid",
        hedgeDepth: "Live depth and basis check required",
      }),
      solanaProduct({
        id: "copper-copxon",
        name: "Ondo Global X Copper Miners ETF",
        ticker: "COPXon",
        lane: "Invest",
        issuer: "Ondo Global Markets (BVI) Limited",
        structure: "Tokenized copper-miners ETF economic exposure",
        backing: "Economic exposure backed by Global X Copper Miners ETF",
        custody: ONDO_CUSTODY,
        redemption: "Token redemption under Ondo terms",
        eligibility: ONDO_ELIGIBILITY,
        risk: "Miner equities can diverge from copper spot; issuer, equity, tracking, and control risks apply.",
        hedgeMarket: "xyz:COPPER · Hyperliquid",
        hedgeDepth: "Live depth and basis check required",
      }),
      solanaProduct({
        id: "copper-cperon",
        name: "Ondo United States Copper Index Fund",
        ticker: "CPERon",
        lane: "Invest",
        issuer: "Ondo Global Markets (BVI) Limited",
        structure: "Tokenized copper-futures fund economic exposure",
        backing: "Economic exposure backed by United States Copper Index Fund",
        custody: ONDO_CUSTODY,
        redemption: "Token redemption under Ondo terms",
        eligibility: ONDO_ELIGIBILITY,
        risk: "Futures roll yield and fund tracking can diverge from physical copper; issuer and control risks apply.",
        hedgeMarket: "xyz:COPPER · Hyperliquid",
        hedgeDepth: "Live depth and basis check required",
      }),
    ],
  },
  {
    id: "palladium",
    symbol: "Pd",
    atomicNumber: 46,
    name: "Palladium",
    family: "Precious",
    referencePrice: 1051.4,
    unit: "oz",
    change24h: 0.12,
    liquidity: "Two Solana products",
    availability: "Executable",
    products: [
      {
        id: "palladium-pallx",
        name: "xStocks Physical Palladium Shares",
        ticker: "PALLx",
        lane: "Invest",
        availability: "Indicative",
        issuer: "Backed Assets / xStocks",
        structure: "Tokenized PALL trust exposure",
        backing: "Economic exposure backed by abrdn Physical Palladium Shares ETF",
        custody: XSTOCKS_CUSTODY,
        redemption: "Security-token redemption; no direct retail bar claim",
        eligibility: XSTOCKS_ELIGIBILITY,
        settlementChain: "Solana",
        nativeChain: "Solana mainnet · mint identified",
        venue: "No current Jupiter route",
        allInFeeBps: null,
        liquidity: "No executable Jupiter route at the current probe size",
        verified: "Issuer + Jupiter directory + on-chain mint · 2026-08-03",
        route: ["Solana", "Route unavailable", "PALLx"],
        risk: "Economic exposure is not direct palladium ownership; issuer, tracking, control, and liquidity risks apply.",
      },
      solanaProduct({
        id: "palladium-pallon",
        name: "Ondo Physical Palladium Shares",
        ticker: "PALLon",
        lane: "Invest",
        issuer: "Ondo Global Markets (BVI) Limited",
        structure: "Tokenized PALL trust economic exposure",
        backing: "Economic exposure backed by abrdn Physical Palladium Shares ETF",
        custody: ONDO_CUSTODY,
        redemption: "Token redemption under Ondo terms; no direct retail bar claim",
        eligibility: ONDO_ELIGIBILITY,
        risk: "Economic exposure is not direct palladium ownership; issuer, tracking, control, and liquidity risks apply.",
      }),
    ],
  },
  {
    id: "nickel",
    symbol: "Ni",
    atomicNumber: 28,
    name: "Nickel",
    family: "Industrial",
    referencePrice: 7.44,
    unit: "lb",
    change24h: -0.76,
    liquidity: "Research queue",
    availability: "Discovery",
    products: [
      {
        id: "nickel-research",
        name: "Nickel product search",
        ticker: "—",
        lane: "Invest",
        availability: "Discovery",
        issuer: "No verified product",
        structure: "Research only",
        backing: "Not applicable",
        custody: "Not applicable",
        redemption: "Not applicable",
        eligibility: "Not currently executable",
        settlementChain: "Unrouted",
        nativeChain: "No activated inventory",
        venue: "No activated route",
        allInFeeBps: null,
        liquidity: "No verified quote",
        verified: "Research queue",
        route: ["No active route"],
        risk: "Visible for demand discovery; no trade is offered.",
      },
    ],
  },
];
