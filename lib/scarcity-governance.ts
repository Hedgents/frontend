export interface ScarcityGovernanceManifest {
  authorityModel: "multisig";
  minimumApprovals: number;
  manualChallengeWindowHours: number;
  auditReportUrl: string;
  disputePolicyUrl: string;
  incidentResponseUrl: string;
}

function requireHttps(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || value.length > 2_048) {
    throw new Error(`${label} must use credential-free HTTPS.`);
  }
}

export function validateScarcityGovernance(value: unknown): ScarcityGovernanceManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Scarcity governance manifest is required for mainnet.");
  }
  const governance = value as Partial<ScarcityGovernanceManifest>;
  if (governance.authorityModel !== "multisig") {
    throw new Error("Mainnet scarcity authorities must use a reviewed multisig.");
  }
  if (!Number.isInteger(governance.minimumApprovals) || Number(governance.minimumApprovals) < 2) {
    throw new Error("Mainnet scarcity governance requires at least two approvals.");
  }
  if (!Number.isInteger(governance.manualChallengeWindowHours) || Number(governance.manualChallengeWindowHours) < 24) {
    throw new Error("Mainnet scarcity governance requires a documented challenge window of at least 24 hours.");
  }
  requireHttps(governance.auditReportUrl, "Independent audit report URL");
  requireHttps(governance.disputePolicyUrl, "Dispute policy URL");
  requireHttps(governance.incidentResponseUrl, "Incident response URL");
  return governance as ScarcityGovernanceManifest;
}
