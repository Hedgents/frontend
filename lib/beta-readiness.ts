import "server-only";

import { loadScarcityDeployment } from "@/lib/scarcity-deployment";
import { onlineDetectorStorageConfigured } from "@/lib/scarcity-detector-store";
import { loadScarcityOperatorConfig } from "@/lib/scarcity-operator";
import { getExecutionControls } from "@/lib/execution-controls";
import { getPublicTerminalFeatures } from "@/lib/terminal-feature-controls";
import {
  configuredMaximumSolDebitLamports,
  configuredProgramAllowlist,
  configuredProgramFingerprintAllowlist,
} from "@/lib/solana-transaction-guard";
import { executionAuditConfigurationStatus } from "@/lib/execution-audit-store";

export type ReadinessStatus = "ready" | "blocked" | "external";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
}

function present(name: string) {
  return Boolean(process.env[name]?.trim());
}

function configuredExecutionRpcCount() {
  const values = [
    ...(process.env.HEDGENTS_SOLANA_MAINNET_RPC_URLS ?? "").split(","),
    process.env.HEDGENTS_SOLANA_MAINNET_RPC_URL ?? "",
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set(values).size;
}

function check(id: string, label: string, ready: boolean, detail: string, missingStatus: ReadinessStatus = "blocked"): ReadinessCheck {
  return { id, label, status: ready ? "ready" : missingStatus, detail };
}

export async function getBetaReadiness() {
  let operatorConfigured = false;
  let operatorDetail = "No scarcity operator manifest is configured.";
  try {
    const operator = loadScarcityOperatorConfig();
    operatorConfigured = Boolean(operator);
    if (operator) operatorDetail = `${operator.cluster} operator manifest validates${operator.governance ? " with governance safeguards" : " for devnet only"}.`;
  } catch (error) {
    operatorDetail = error instanceof Error ? error.message : "Scarcity operator manifest is invalid.";
  }

  let deploymentConfigured = false;
  let deploymentDetail = "No binary-market deployment manifest is configured.";
  try {
    const deployment = await loadScarcityDeployment();
    deploymentConfigured = Boolean(deployment && Object.keys(deployment.markets).length);
    if (deployment) deploymentDetail = `${deployment.cluster} manifest validates with ${Object.keys(deployment.markets).length} deployed market account(s).`;
  } catch (error) {
    deploymentDetail = error instanceof Error ? error.message : "Scarcity deployment manifest is invalid.";
  }

  const executionControls = getExecutionControls();
  const terminalFeatures = getPublicTerminalFeatures();
  const executionRpcCount = configuredExecutionRpcCount();
  let walletDebitConfigured = false;
  let walletDebitDetail = "The exact wallet SOL-debit cap is not configured.";
  try {
    const lamports = configuredMaximumSolDebitLamports();
    walletDebitConfigured = true;
    walletDebitDetail = `Exact simulation permits at most ${lamports} lamports of net taker SOL debit.`;
  } catch (error) {
    walletDebitDetail = error instanceof Error ? error.message : walletDebitDetail;
  }
  let programsConfigured = false;
  let programsDetail = "No reviewed Solana route program is configured.";
  try {
    const programs = configuredProgramAllowlist();
    programsConfigured = Boolean(programs?.size);
    if (programs?.size) {
      const fingerprints = configuredProgramFingerprintAllowlist();
      programsDetail = `${programs.size} reviewed Solana route program(s) are allowlisted`
        + (fingerprints?.size ? `, pinned to ${fingerprints.size} reviewed program set(s).` : ".");
    }
  } catch (error) {
    programsDetail = error instanceof Error ? error.message : programsDetail;
  }
  const auditConfiguration = executionAuditConfigurationStatus({ production: true });
  const checks: ReadinessCheck[] = [
    check("auth-secrets", "Access sessions", present("HEDGENTS_AUTH_SECRET") && present("HEDGENTS_ADMIN_CODE_HASH"), "Administrator and signed session configuration is complete; beta access uses individually revocable stored grants."),
    check("execution-secrets", "Execution receipts", present("HEDGENTS_ORDER_SIGNING_SECRET") && present("HEDGENTS_RECOVERY_SIGNING_SECRET"), "Order intents and recovery receipts use dedicated signing secrets."),
    check("jupiter", "Metal route quotes", present("JUPITER_API_KEY"), "Jupiter server credential is configured."),
    check(
      "execution-switch",
      "New-trade control",
      executionControls.enabled && !executionControls.rejectionOnly,
      executionControls.configurationValid
        ? executionControls.rejectionOnly
          ? "Wallet rejection mode is active: quotes can be signed, but submission is hard-disabled."
          : "The emergency execution switch is enabled; settlement recovery remains independent."
        : executionControls.issue ?? "The execution control is invalid.",
    ),
    check(
      "execution-cap",
      "Closed-beta trade cap",
      executionControls.configurationValid && executionControls.maxUsd <= 100,
      `Server-enforced maximum is $${executionControls.maxUsd.toLocaleString()} per trade. Closed beta requires $100 or less.`,
    ),
    check(
      "execution-products",
      "Execution product allowlist",
      executionControls.productAllowlistConfigured
        && executionControls.productAllowlistValid
        && executionControls.allowedProductIds.length > 0,
      executionControls.productAllowlistIssue
        ?? (executionControls.productAllowlistConfigured
          ? `${executionControls.allowedProductIds.length} product(s) enabled server-side: ${executionControls.allowedProductIds.join(", ")}.`
          : `No explicit production allowlist is configured; non-production currently permits all ${executionControls.allowedProductIds.length} registry product(s).`),
    ),
    check("execution-wallet-debit", "Wallet SOL-debit cap", walletDebitConfigured, walletDebitDetail),
    check("execution-programs", "Route-program review", programsConfigured, programsDetail),
    check("execution-audit", "Execution audit ledger", auditConfiguration.ready, auditConfiguration.detail),
    check(
      "rail-funding",
      "Cross-chain rail funding",
      !terminalFeatures.railFundingEnabled,
      terminalFeatures.railFundingEnabled
        ? "HEDGENTS_RAIL_FUNDING_ENABLED=true exposes terminal-initiated Ethereum/Base USDC funding. The first Solana-USDC beta requires it off."
        : "Terminal-initiated Ethereum/Base funding is off; the beta funds in native Solana USDC only. Verification of an already-broadcast source burn stays available.",
    ),
    check("storage", "Durable evidence", onlineDetectorStorageConfigured(), "Private durable storage is configured for evidence, reviewed markets, analytics, and detector state."),
    check("origins", "Mutation origins", present("HEDGENTS_ALLOWED_ORIGINS"), "Explicit production browser origins are allowlisted."),
    check("eligibility", "Security eligibility policy", present("HEDGENTS_SECURITY_COUNTRY_ALLOWLIST"), "A legally reviewed country allowlist is required before tokenized-security routes can leave fail-closed mode.", "external"),
    check("pyth", "Pyth metal pulse", present("PYTH_API_KEY"), "A server-only Hermes credential is required for authenticated real-time observations.", "external"),
    check(
      "rpc",
      "Solana RPC capacity",
      executionRpcCount >= 2,
      `${executionRpcCount} explicitly configured mainnet RPC endpoint(s); closed beta requires two independent providers.`,
      "external",
    ),
    check("cron", "Daily detector schedule", present("CRON_SECRET"), "The detector cron endpoint has a bearer secret."),
    { id: "operator", label: "Scarcity operator", status: operatorConfigured ? "ready" : "external", detail: operatorDetail },
    { id: "deployment", label: "Binary market deployment", status: deploymentConfigured ? "ready" : "external", detail: deploymentDetail },
  ];
  return {
    generatedAt: new Date().toISOString(),
    ready: checks.filter((entry) => entry.status === "ready").length,
    blocked: checks.filter((entry) => entry.status === "blocked").length,
    external: checks.filter((entry) => entry.status === "external").length,
    checks,
  };
}
