import "server-only";
import { address } from "@solana/kit";
import { MAINNET_USDC_MINT, SCARCITY_EXCHANGE_PROGRAM_ADDRESS } from "@/lib/scarcity-exchange/addresses";
import { validateScarcityGovernance, type ScarcityGovernanceManifest } from "@/lib/scarcity-governance";

export interface ScarcityOperatorConfig {
  schemaVersion: "1.0.0";
  cluster: "devnet" | "mainnet-beta";
  programAddress: string;
  admin: string;
  collateralMint: string;
  feeRecipient: string;
  resolver: string;
  tradingFeeBps: number;
  governance?: ScarcityGovernanceManifest;
}

export function loadScarcityOperatorConfig(): ScarcityOperatorConfig | null {
  const raw = process.env.HEDGENTS_SCARCITY_OPERATOR_JSON?.trim();
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("HEDGENTS_SCARCITY_OPERATOR_JSON is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Scarcity operator configuration must be an object.");
  }
  const config = value as Partial<ScarcityOperatorConfig>;
  if (config.schemaVersion !== "1.0.0") throw new Error("Scarcity operator schema version is unsupported.");
  if (config.cluster !== "devnet" && config.cluster !== "mainnet-beta") throw new Error("Scarcity operator cluster is unsupported.");
  if (config.programAddress !== String(SCARCITY_EXCHANGE_PROGRAM_ADDRESS)) {
    throw new Error("Scarcity operator program does not match the generated client.");
  }
  address(String(config.admin));
  address(String(config.collateralMint));
  address(String(config.feeRecipient));
  address(String(config.resolver));
  if (!Number.isInteger(config.tradingFeeBps) || Number(config.tradingFeeBps) < 0 || Number(config.tradingFeeBps) > 200) {
    throw new Error("Scarcity operator trading fee must be between 0 and 200 bps.");
  }
  if (config.cluster === "mainnet-beta" && config.collateralMint !== String(MAINNET_USDC_MINT)) {
    throw new Error("Mainnet scarcity collateral must be canonical Solana USDC.");
  }
  if (config.cluster === "mainnet-beta") validateScarcityGovernance(config.governance);
  else if (config.governance !== undefined) validateScarcityGovernance(config.governance);
  return config as ScarcityOperatorConfig;
}
