import "server-only";
import { address } from "@solana/kit";
import {
  deriveCurveMarketAddresses,
  deriveMarketAddresses,
  MAINNET_USDC_MINT,
  SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
} from "@/lib/scarcity-exchange";
import { compileCurveMarket, type CompiledCurveMarket } from "@/lib/scarcity-curves";
import { compileLithiumRound, isLithiumRoundSlug, lithiumRoundWindow } from "@/lib/scarcity/lithium-market";
import { hexToBytes } from "@/lib/scarcity-markets";
import { getStoredScarcityMarket } from "@/lib/scarcity-market-store";
import { validateScarcityGovernance, type ScarcityGovernanceManifest } from "@/lib/scarcity-governance";

export type ScarcityCluster = "devnet" | "mainnet-beta";

export interface ScarcityDeploymentManifest {
  schemaVersion: "1.0.0";
  cluster: ScarcityCluster;
  programAddress: string;
  admin: string;
  collateralMint: string;
  feeRecipient: string;
  resolver: string;
  tradingFeeBps: number;
  governance?: ScarcityGovernanceManifest;
  markets: Record<string, { creationSignature: string; resolver: string }>;
  /**
   * Curve deployments are keyed by the canonical binary/data market slug. The
   * scalar market ID and commitments are compiled from that stored document.
   */
  curveMarkets?: Record<string, { creationSignature: string; resolver: string }>;
  /**
   * Superseded curve markets: deployed on-chain, retired from the manifest's
   * live set before third-party stake. Recorded so positions in them surface
   * as "superseded · refund pending" instead of being silently dropped from
   * portfolio reads. Commitment verification is skipped for these accounts
   * (their committed rules are exactly why they were retired).
   */
  supersededMarkets?: Record<string, { market: string; reason: string }>;
}

export interface ResolvedScarcityDeployment {
  cluster: ScarcityCluster;
  programAddress: string;
  admin: string;
  collateralMint: string;
  feeRecipient: string;
  resolver: string;
  tradingFeeBps: number;
  governance?: ScarcityGovernanceManifest;
  markets: Record<string, {
    market: string;
    yesMint: string;
    noMint: string;
    vault: string;
    resolver: string;
    creationSignature: string;
  }>;
  curveMarkets: Record<string, {
    market: string;
    vault: string;
    resolver: string;
    creationSignature: string;
    compiledSlug: string;
    sourceSlug: string;
  }>;
  supersededMarkets: Record<string, { market: string; reason: string }>;
}

export async function resolveStoredCurveMarket(identifier: string): Promise<{
  sourceSlug: string;
  compiled: CompiledCurveMarket;
} | null> {
  // Lithium rounds are compiled from the shipped v1 index rather than from a stored catalog record,
  // because that index is its own methodology with its own frozen anchors. The documents are strict
  // extensions of the shared curve shapes, so everything downstream of here is unchanged.
  if (isLithiumRoundSlug(identifier)) {
    const round = lithiumRoundWindow(identifier);
    return round ? { sourceSlug: identifier, compiled: compileLithiumRound(round) } : null;
  }
  const direct = await getStoredScarcityMarket(identifier);
  if (direct) {
    const compiled = compileCurveMarket(direct);
    if (compiled) return { sourceSlug: direct.question.slug, compiled };
  }
  const suffix = "-curve-v1";
  if (!identifier.endsWith(suffix)) return null;
  const sourceSlug = identifier.slice(0, -suffix.length);
  const source = await getStoredScarcityMarket(sourceSlug);
  const compiled = source ? compileCurveMarket(source) : null;
  return compiled?.slug === identifier ? { sourceSlug, compiled } : null;
}

function parseManifest(): ScarcityDeploymentManifest | null {
  const raw = process.env.HEDGENTS_SCARCITY_DEPLOYMENT_JSON?.trim();
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("HEDGENTS_SCARCITY_DEPLOYMENT_JSON is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Scarcity deployment manifest must be an object.");
  }
  const manifest = value as Partial<ScarcityDeploymentManifest>;
  if (manifest.schemaVersion !== "1.0.0") throw new Error("Scarcity deployment schema version is unsupported.");
  if (manifest.cluster !== "devnet" && manifest.cluster !== "mainnet-beta") {
    throw new Error("Scarcity deployment cluster is unsupported.");
  }
  if (manifest.programAddress !== String(SCARCITY_EXCHANGE_PROGRAM_ADDRESS)) {
    throw new Error("Scarcity deployment program does not match the generated client.");
  }
  address(String(manifest.admin));
  address(String(manifest.collateralMint));
  address(String(manifest.feeRecipient));
  address(String(manifest.resolver));
  if (!Number.isInteger(manifest.tradingFeeBps) || Number(manifest.tradingFeeBps) < 0 || Number(manifest.tradingFeeBps) > 200) {
    throw new Error("Scarcity deployment trading fee must be between 0 and 200 bps.");
  }
  if (!manifest.markets || typeof manifest.markets !== "object" || Array.isArray(manifest.markets)) {
    throw new Error("Scarcity deployment markets must be an object.");
  }
  if (
    manifest.curveMarkets !== undefined
    && (typeof manifest.curveMarkets !== "object" || manifest.curveMarkets === null || Array.isArray(manifest.curveMarkets))
  ) {
    throw new Error("Scarcity deployment curve markets must be an object.");
  }
  if (
    manifest.supersededMarkets !== undefined
    && (typeof manifest.supersededMarkets !== "object" || manifest.supersededMarkets === null || Array.isArray(manifest.supersededMarkets))
  ) {
    throw new Error("Scarcity deployment superseded markets must be an object.");
  }
  for (const [key, entry] of Object.entries(manifest.supersededMarkets ?? {})) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Scarcity deployment superseded market ${key} must be an object.`);
    }
    if (typeof entry.market !== "string" || typeof entry.reason !== "string" || !entry.reason.trim()) {
      throw new Error(`Scarcity deployment superseded market ${key} needs a market address and a reason.`);
    }
    address(entry.market);
  }
  if (manifest.cluster === "mainnet-beta" && manifest.collateralMint !== String(MAINNET_USDC_MINT)) {
    throw new Error("Mainnet scarcity collateral must be canonical Solana USDC.");
  }
  if (manifest.cluster === "mainnet-beta") validateScarcityGovernance(manifest.governance);
  else if (manifest.governance !== undefined) validateScarcityGovernance(manifest.governance);
  return manifest as ScarcityDeploymentManifest;
}

export async function loadScarcityDeployment(): Promise<ResolvedScarcityDeployment | null> {
  const manifest = parseManifest();
  if (!manifest) return null;
  const markets: ResolvedScarcityDeployment["markets"] = {};
  for (const [slug, deployment] of Object.entries(manifest.markets)) {
    const market = await getStoredScarcityMarket(slug);
    if (!market) throw new Error(`Scarcity deployment references unknown market ${slug}.`);
    if (!deployment || typeof deployment.creationSignature !== "string" || deployment.creationSignature.length < 32) {
      throw new Error(`Scarcity deployment signature for ${slug} is invalid.`);
    }
    address(String(deployment.resolver));
    const derived = await deriveMarketAddresses(hexToBytes(market.marketId));
    markets[slug] = {
      market: String(derived.market),
      yesMint: String(derived.yesMint),
      noMint: String(derived.noMint),
      vault: String(derived.vault),
      resolver: deployment.resolver,
      creationSignature: deployment.creationSignature,
    };
  }
  const curveMarkets: ResolvedScarcityDeployment["curveMarkets"] = {};
  for (const [slug, deployment] of Object.entries(manifest.curveMarkets ?? {})) {
    const resolved = await resolveStoredCurveMarket(slug);
    if (!resolved) throw new Error(`Scarcity curve deployment references unknown or non-scalar market ${slug}.`);
    const { compiled, sourceSlug } = resolved;
    if (!deployment || typeof deployment.creationSignature !== "string" || deployment.creationSignature.length < 32) {
      throw new Error(`Scarcity curve deployment signature for ${slug} is invalid.`);
    }
    address(String(deployment.resolver));
    const derived = await deriveCurveMarketAddresses(hexToBytes(compiled.marketId));
    if (curveMarkets[compiled.slug]) {
      throw new Error(`Scarcity curve deployment defines ${compiled.slug} more than once.`);
    }
    curveMarkets[compiled.slug] = {
      market: String(derived.market),
      vault: String(derived.vault),
      resolver: deployment.resolver,
      creationSignature: deployment.creationSignature,
      compiledSlug: compiled.slug,
      sourceSlug,
    };
  }
  return {
    cluster: manifest.cluster,
    programAddress: manifest.programAddress,
    admin: manifest.admin,
    collateralMint: manifest.collateralMint,
    feeRecipient: manifest.feeRecipient,
    resolver: manifest.resolver,
    tradingFeeBps: manifest.tradingFeeBps,
    governance: manifest.governance,
    markets,
    curveMarkets,
    supersededMarkets: manifest.supersededMarkets ?? {},
  };
}

export function scarcityRpcUrls(cluster: ScarcityCluster) {
  const configuredCluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet" ? "devnet" : "mainnet-beta";
  const clusterRpcList = cluster === "devnet"
    ? process.env.HEDGENTS_SCARCITY_DEVNET_RPC_URLS
    : process.env.HEDGENTS_SCARCITY_MAINNET_RPC_URLS;
  const configured = [
    ...(clusterRpcList?.split(",") ?? []),
    cluster === configuredCluster ? process.env.HEDGENTS_SCARCITY_RPC_URL ?? "" : "",
    cluster === "devnet" ? process.env.HEDGENTS_SOLANA_DEVNET_RPC_URL ?? "" : process.env.HEDGENTS_SOLANA_MAINNET_RPC_URL ?? "",
    cluster === configuredCluster ? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "" : "",
  ].map((value) => value.trim()).filter(Boolean);
  if (cluster === "devnet") configured.push("https://api.devnet.solana.com");
  else configured.push("https://api.mainnet-beta.solana.com");
  return [...new Set(configured)];
}
