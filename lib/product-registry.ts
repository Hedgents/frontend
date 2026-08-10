export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const SOLANA_USDG_MINT = "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH";
export const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export type SettlementAssetId = "usdc" | "usdt" | "usdg";

export interface SolanaSettlementAsset {
  id: SettlementAssetId;
  symbol: "USDC" | "USDT" | "USDG";
  displayName: string;
  issuer: string;
  mint: string;
  decimals: 6;
  tokenProgram: "Token-2022" | "SPL Token";
  tokenProgramAddress: string;
  sourceUrl: string;
}

export const solanaSettlementAssets = {
  usdc: {
    id: "usdc",
    symbol: "USDC",
    displayName: "USD Coin",
    issuer: "Circle",
    mint: SOLANA_USDC_MINT,
    decimals: 6,
    tokenProgram: "SPL Token",
    tokenProgramAddress: SPL_TOKEN_PROGRAM_ID,
    sourceUrl: "https://developers.circle.com/stablecoins/usdc-contract-addresses",
  },
  usdt: {
    id: "usdt",
    symbol: "USDT",
    displayName: "Tether USD",
    issuer: "Tether",
    mint: SOLANA_USDT_MINT,
    decimals: 6,
    tokenProgram: "SPL Token",
    tokenProgramAddress: SPL_TOKEN_PROGRAM_ID,
    sourceUrl: "https://tether.to/en/supported-protocols/",
  },
  usdg: {
    id: "usdg",
    symbol: "USDG",
    displayName: "Global Dollar",
    issuer: "Paxos Digital Singapore",
    mint: SOLANA_USDG_MINT,
    decimals: 6,
    tokenProgram: "Token-2022",
    tokenProgramAddress: TOKEN_2022_PROGRAM_ID,
    sourceUrl: "https://docs.paxos.com/guides/stablecoin/usdg/mainnet",
  },
} as const satisfies Record<SettlementAssetId, SolanaSettlementAsset>;

export function getSolanaSettlementAsset(value: unknown): SolanaSettlementAsset | null {
  if (typeof value !== "string") return null;
  return ownEntry(solanaSettlementAssets as Record<string, SolanaSettlementAsset>, value);
}

export interface RegistrySource {
  label: string;
  url: string;
  kind: "issuer" | "directory" | "explorer";
}

export interface SolanaExecutionProduct {
  productId: string;
  symbol: string;
  displayName: string;
  issuer: string;
  chain: "Solana";
  cluster: "mainnet";
  mint: string;
  decimals: number;
  tokenProgram: "Token-2022" | "SPL Token";
  tokenProgramAddress: string;
  verifiedAt: string;
  eligibilityPolicyId: EligibilityPolicyId;
  eligibilityNote: string;
  controlNote: string;
  sources: RegistrySource[];
  execution: {
    provider: "Jupiter Swap V2";
    comparisonGroup: string;
    inputMint: string;
    inputDecimals: number;
    minimumUsd: number;
    maximumUsd: number;
    maximumPriceImpactPct: number;
    probeUsd: number;
  };
}

export type EligibilityPolicyId = "paxos" | "oro" | "matrixdock" | "xstocks" | "ondo";

interface ProductDefinition {
  productId: string;
  symbol: string;
  displayName: string;
  issuer: string;
  mint: string;
  decimals: number;
  tokenProgram?: "Token-2022" | "SPL Token";
  issuerSource: { label: string; url: string };
  eligibilityPolicyId: EligibilityPolicyId;
  eligibilityNote: string;
  controlNote: string;
  comparisonGroup: string;
  maximumUsd?: number;
}

function defineProduct(definition: ProductDefinition): SolanaExecutionProduct {
  const tokenProgram = definition.tokenProgram ?? "Token-2022";
  return {
    productId: definition.productId,
    symbol: definition.symbol,
    displayName: definition.displayName,
    issuer: definition.issuer,
    chain: "Solana",
    cluster: "mainnet",
    mint: definition.mint,
    decimals: definition.decimals,
    tokenProgram,
    tokenProgramAddress:
      tokenProgram === "Token-2022" ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID,
    verifiedAt: "2026-08-03",
    eligibilityPolicyId: definition.eligibilityPolicyId,
    eligibilityNote: definition.eligibilityNote,
    controlNote: definition.controlNote,
    sources: [
      { ...definition.issuerSource, kind: "issuer" },
      {
        label: `Jupiter verified directory · ${definition.symbol}`,
        url: `https://lite-api.jup.ag/tokens/v2/search?query=${definition.mint}`,
        kind: "directory",
      },
      {
        label: `Solscan mint · ${definition.symbol}`,
        url: `https://solscan.io/token/${definition.mint}`,
        kind: "explorer",
      },
    ],
    execution: {
      provider: "Jupiter Swap V2",
      comparisonGroup: definition.comparisonGroup,
      inputMint: SOLANA_USDC_MINT,
      inputDecimals: 6,
      minimumUsd: 10,
      maximumUsd: definition.maximumUsd ?? 2_500,
      maximumPriceImpactPct: 1,
      probeUsd: 100,
    },
  };
}

const XSTOCKS_SOURCE = {
  label: "xStocks · product and eligibility disclosures",
  url: "https://xstocks.com/",
};
const ONDO_SOURCE = {
  label: "Ondo Global Markets · tokenized stocks and ETFs",
  url: "https://ondo.finance/ondo-stocks",
};
const XSTOCKS_ELIGIBILITY =
  "Tokenized security; xStocks jurisdiction, transfer, and market-access restrictions apply.";
const ONDO_ELIGIBILITY =
  "Tokenized security; Ondo eligibility, jurisdiction, transfer, and market-hours restrictions apply.";
const SECURITY_CONTROL_NOTE =
  "This Token-2022 security may retain mint and freeze controls and may enforce transfer restrictions. Eligibility and issuer controls remain product risk after settlement.";

export const solanaExecutionProducts = {
  "gold-paxg": defineProduct({
    productId: "gold-paxg",
    symbol: "PAXG",
    displayName: "PAX Gold",
    issuer: "Paxos Trust Company",
    mint: "5GgRAEmv8ZxF2PR5hY72Qs5x1bnQ6UK2RbTPoqJ3wSwW",
    decimals: 6,
    issuerSource: {
      label: "Paxos · PAXG on Solana",
      url: "https://www.paxos.com/blog/bringing-paxg-to-solana",
    },
    eligibilityPolicyId: "paxos",
    eligibilityNote: "Paxos account, wallet-screening, redemption, and jurisdiction rules apply.",
    controlNote:
      "PAXG is a controlled Token-2022 asset. Mint, freeze, and permanent-delegate controls remain product risk after settlement.",
    comparisonGroup: "gold-physical-ounce",
    maximumUsd: 10_000,
  }),
  "gold-oro": defineProduct({
    productId: "gold-oro",
    symbol: "GOLD",
    displayName: "Oro GOLD",
    issuer: "Third-party regulated token issuer surfaced by Oro",
    mint: "GoLDppdjB1vDTPSGxyMJFqdnj134yH6Prg9eqsGDiw6A",
    decimals: 6,
    tokenProgram: "SPL Token",
    issuerSource: {
      label: "Oro · GOLD transparency",
      url: "https://www.oro.finance/transparency",
    },
    eligibilityPolicyId: "oro",
    eligibilityNote: "Third-party issuer, redemption partner, KYC, minimum, and jurisdiction rules apply.",
    controlNote:
      "GOLD uses the classic SPL Token program. Mint authority and the third-party issuer/redemption structure remain product risk after settlement.",
    comparisonGroup: "gold-physical-ounce",
    maximumUsd: 10_000,
  }),
  "gold-xaum": defineProduct({
    productId: "gold-xaum",
    symbol: "XAUm",
    displayName: "Matrixdock XAUm",
    issuer: "Matrixdock",
    mint: "5aLhp9VnUEKcsdtkfsf2DUgpJfomx7GmYVny24dHUZoB",
    decimals: 9,
    issuerSource: {
      label: "Matrixdock · XAUm on Solana",
      url: "https://www.matrixdock.com/blog/announcements/xaum-launches-on-solana",
    },
    eligibilityPolicyId: "matrixdock",
    eligibilityNote: "Matrixdock onboarding, redemption, minimum, and jurisdiction rules apply.",
    controlNote:
      "XAUm is an issuer-controlled Token-2022 asset. Mint/freeze controls, custody, audits, and redemption conditions remain product risk.",
    comparisonGroup: "gold-physical-ounce",
    maximumUsd: 5_000,
  }),
  "gold-gldx": defineProduct({
    productId: "gold-gldx",
    symbol: "GLDx",
    displayName: "xStocks SPDR Gold Shares",
    issuer: "Backed Assets / xStocks",
    mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
    decimals: 8,
    issuerSource: XSTOCKS_SOURCE,
    eligibilityPolicyId: "xstocks",
    eligibilityNote: XSTOCKS_ELIGIBILITY,
    controlNote: SECURITY_CONTROL_NOTE,
    comparisonGroup: "gld-share",
  }),
  "gold-gldon": defineProduct({
    productId: "gold-gldon",
    symbol: "GLDon",
    displayName: "Ondo SPDR Gold Shares",
    issuer: "Ondo Global Markets (BVI) Limited",
    mint: "hWfiw4mcxT8rnNFkk6fsCQSxoxgZ9yVhB6tyeVcondo",
    decimals: 9,
    issuerSource: ONDO_SOURCE,
    eligibilityPolicyId: "ondo",
    eligibilityNote: ONDO_ELIGIBILITY,
    controlNote: SECURITY_CONTROL_NOTE,
    comparisonGroup: "gld-share",
  }),
  "silver-slvx": defineProduct({
    productId: "silver-slvx",
    symbol: "SLVx",
    displayName: "xStocks iShares Silver Trust",
    issuer: "Backed Assets / xStocks",
    mint: "XsxAd6okt8y1RRK6gNg7iJaqiWNiq5Md5EDf3ZrF2dm",
    decimals: 8,
    issuerSource: XSTOCKS_SOURCE,
    eligibilityPolicyId: "xstocks",
    eligibilityNote: XSTOCKS_ELIGIBILITY,
    controlNote: SECURITY_CONTROL_NOTE,
    comparisonGroup: "slv-share",
  }),
  "silver-slvon": defineProduct({
    productId: "silver-slvon",
    symbol: "SLVon",
    displayName: "Ondo iShares Silver Trust",
    issuer: "Ondo Global Markets (BVI) Limited",
    mint: "iy11ytbSGcUnrjE6Lfv78TFqxKyUESfku1FugS9ondo",
    decimals: 9,
    issuerSource: ONDO_SOURCE,
    eligibilityPolicyId: "ondo",
    eligibilityNote: ONDO_ELIGIBILITY,
    controlNote: SECURITY_CONTROL_NOTE,
    comparisonGroup: "slv-share",
  }),
  "uranium-urax": defineProduct({
    productId: "uranium-urax",
    symbol: "URAx",
    displayName: "xStocks Global X Uranium ETF",
    issuer: "Backed Assets / xStocks",
    mint: "Xsq9sEQjYiUTSZ55RrbHAzVfz8HotwFGrqgxkgiv4LB",
    decimals: 8,
    issuerSource: XSTOCKS_SOURCE,
    eligibilityPolicyId: "xstocks",
    eligibilityNote: XSTOCKS_ELIGIBILITY,
    controlNote: SECURITY_CONTROL_NOTE,
    comparisonGroup: "ura-share",
  }),
  "uranium-uraon": defineProduct({
    productId: "uranium-uraon",
    symbol: "URAon",
    displayName: "Ondo Global X Uranium ETF",
    issuer: "Ondo Global Markets (BVI) Limited",
    mint: "EvzskrQ3vUUkiMGG1DzfSDyG6H2WCMy3v9G8fzzondo",
    decimals: 9,
    issuerSource: ONDO_SOURCE,
    eligibilityPolicyId: "ondo",
    eligibilityNote: ONDO_ELIGIBILITY,
    controlNote: SECURITY_CONTROL_NOTE,
    comparisonGroup: "ura-share",
  }),
  "uranium-urnmon": defineProduct({
    productId: "uranium-urnmon",
    symbol: "URNMon",
    displayName: "Ondo Sprott Uranium Miners ETF",
    issuer: "Ondo Global Markets (BVI) Limited",
    mint: "hieZTEZNBU67bMGULK9hWCB9h5jBPKdpRWiXpwkondo",
    decimals: 9,
    issuerSource: ONDO_SOURCE,
    eligibilityPolicyId: "ondo",
    eligibilityNote: ONDO_ELIGIBILITY,
    controlNote: SECURITY_CONTROL_NOTE,
    comparisonGroup: "urnm-share",
  }),
  "platinum-pplton": defineProduct({
    productId: "platinum-pplton",
    symbol: "PPLTon",
    displayName: "Ondo Physical Platinum Shares",
    issuer: "Ondo Global Markets (BVI) Limited",
    mint: "DwRtkbsaQMGAS3oMeEGYh6M5vH4X9WECsQgqHjAondo",
    decimals: 9,
    issuerSource: ONDO_SOURCE,
    eligibilityPolicyId: "ondo",
    eligibilityNote: ONDO_ELIGIBILITY,
    controlNote: SECURITY_CONTROL_NOTE,
    comparisonGroup: "pplt-share",
  }),
  "copper-copxx": defineProduct({
    productId: "copper-copxx",
    symbol: "COPXx",
    displayName: "xStocks Global X Copper Miners ETF",
    issuer: "Backed Assets / xStocks",
    mint: "XsybfiKkD4UmjkAGT2uR8X2sq9AWFtvGJM2KTffoALZ",
    decimals: 8,
    issuerSource: XSTOCKS_SOURCE,
    eligibilityPolicyId: "xstocks",
    eligibilityNote: XSTOCKS_ELIGIBILITY,
    controlNote: SECURITY_CONTROL_NOTE,
    comparisonGroup: "copx-share",
  }),
  "copper-copxon": defineProduct({
    productId: "copper-copxon",
    symbol: "COPXon",
    displayName: "Ondo Global X Copper Miners ETF",
    issuer: "Ondo Global Markets (BVI) Limited",
    mint: "X7j77hTmjZJbepkXXBcsEapM8qNgdfihkFj6CZ5ondo",
    decimals: 9,
    issuerSource: ONDO_SOURCE,
    eligibilityPolicyId: "ondo",
    eligibilityNote: ONDO_ELIGIBILITY,
    controlNote: SECURITY_CONTROL_NOTE,
    comparisonGroup: "copx-share",
  }),
  "copper-cperon": defineProduct({
    productId: "copper-cperon",
    symbol: "CPERon",
    displayName: "Ondo United States Copper Index Fund",
    issuer: "Ondo Global Markets (BVI) Limited",
    mint: "hpkpc1Xenv5oEpVefk3woWjZa9rxaJxaEaVVA4Fondo",
    decimals: 9,
    issuerSource: ONDO_SOURCE,
    eligibilityPolicyId: "ondo",
    eligibilityNote: ONDO_ELIGIBILITY,
    controlNote: SECURITY_CONTROL_NOTE,
    comparisonGroup: "cper-share",
  }),
  "palladium-pallon": defineProduct({
    productId: "palladium-pallon",
    symbol: "PALLon",
    displayName: "Ondo Physical Palladium Shares",
    issuer: "Ondo Global Markets (BVI) Limited",
    mint: "P7hTXnKk2d2DyqWnefp5BSroE1qjjKpKxg9SxQqondo",
    decimals: 9,
    issuerSource: ONDO_SOURCE,
    eligibilityPolicyId: "ondo",
    eligibilityNote: ONDO_ELIGIBILITY,
    controlNote: SECURITY_CONTROL_NOTE,
    comparisonGroup: "pall-share",
  }),
} as const satisfies Record<string, SolanaExecutionProduct>;

export type ExecutableProductId = keyof typeof solanaExecutionProducts;

// Registry lookups must be own-property-only. A plain index walks the prototype chain, so a
// caller-supplied "__proto__" or "constructor" would resolve to an inherited object instead of
// null and pass every `product === null` guard downstream.
function ownEntry<T>(registry: Record<string, T>, key: string): T | null {
  return Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : null;
}

export function getSolanaExecutionProduct(productId: string): SolanaExecutionProduct | null {
  return ownEntry(solanaExecutionProducts as Record<string, SolanaExecutionProduct>, productId);
}

export function isSolanaExecutionProduct(productId: string): productId is ExecutableProductId {
  return Object.prototype.hasOwnProperty.call(solanaExecutionProducts, productId);
}
