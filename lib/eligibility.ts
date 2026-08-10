import type { EligibilityPolicyId, SolanaExecutionProduct } from "@/lib/product-registry";

export interface EligibilityEvidence {
  countryCode: string;
  legalAge: boolean;
  acceptsIssuerTerms: boolean;
  notRestrictedPerson: boolean;
}

export interface EligibilityDecision {
  eligible: boolean;
  countryCode: string | null;
  observedCountryCode: string | null;
  policyId: EligibilityPolicyId;
  reason: string;
  policySourceUrl: string;
}

const SANCTIONS_BLOCKED = new Set([
  "AF", "BY", "CU", "IR", "KP", "LY", "MM", "RU", "SO", "SS", "SD", "SY",
]);
const XSTOCKS_BLOCKED = new Set(["US", "GB", "CA", "AU"]);
const ONDO_BLOCKED = new Set(["US"]);

const policySources: Record<EligibilityPolicyId, string> = {
  paxos: "https://support.paxos.com/articles/8914207545-prohibited-locations",
  oro: "https://www.oro.finance/transparency",
  matrixdock: "https://matrixdock.gitbook.io/matrixdock-docs/english/gold-token-xaum/token-features",
  xstocks: "https://xstocks.com/partner",
  ondo: "https://ondo.finance/ondo-stocks",
};

export function normalizeCountryCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function observedCountryCode(headers: Headers) {
  const vercelCountry = normalizeCountryCode(headers.get("x-vercel-ip-country"));
  if (process.env.NODE_ENV === "production") return vercelCountry;
  return vercelCountry ?? normalizeCountryCode(headers.get("cf-ipcountry") ?? headers.get("x-country-code"));
}

export function parseEligibilityEvidence(value: unknown): EligibilityEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const countryCode = normalizeCountryCode(candidate.countryCode);
  if (!countryCode) return null;
  return {
    countryCode,
    legalAge: candidate.legalAge === true,
    acceptsIssuerTerms: candidate.acceptsIssuerTerms === true,
    notRestrictedPerson: candidate.notRestrictedPerson === true,
  };
}

function configuredSecurityCountryAllowlist() {
  return new Set(
    (process.env.HEDGENTS_SECURITY_COUNTRY_ALLOWLIST ?? "")
      .split(",")
      .map((value) => normalizeCountryCode(value))
      .filter((value): value is string => Boolean(value)),
  );
}

export function evaluateProductEligibility(
  product: SolanaExecutionProduct,
  evidence: EligibilityEvidence | null,
  observedCountry: string | null,
  options: { securityCountryAllowlist?: Set<string>; production?: boolean } = {},
): EligibilityDecision {
  const policyId = product.eligibilityPolicyId;
  const source = policySources[policyId];
  const declared = normalizeCountryCode(evidence?.countryCode);
  const observed = normalizeCountryCode(observedCountry);
  const production = options.production ?? process.env.NODE_ENV === "production";
  const fail = (reason: string): EligibilityDecision => ({
    eligible: false,
    countryCode: declared,
    observedCountryCode: observed,
    policyId,
    reason,
    policySourceUrl: source,
  });

  if (!evidence || !declared) return fail("Declare a valid two-letter country of residence.");
  if (!evidence.legalAge || !evidence.acceptsIssuerTerms || !evidence.notRestrictedPerson) {
    return fail("All eligibility attestations are required before a mainnet order can be submitted.");
  }
  if (production && !observed) {
    return fail("Execution is unavailable because the deployment could not verify the request country.");
  }
  if (observed && observed !== declared) {
    return fail("The declared residence does not match the request location. Manual review is required.");
  }
  if (SANCTIONS_BLOCKED.has(declared)) {
    return fail("This jurisdiction is blocked by the conservative closed-beta sanctions policy.");
  }
  if (policyId === "xstocks" && XSTOCKS_BLOCKED.has(declared)) {
    return fail("xStocks is not available in the declared jurisdiction.");
  }
  if (policyId === "ondo" && ONDO_BLOCKED.has(declared)) {
    return fail("Ondo Stocks is not available to US persons or US-based clients.");
  }

  if (policyId === "xstocks" || policyId === "ondo") {
    const allowlist = options.securityCountryAllowlist ?? configuredSecurityCountryAllowlist();
    if (production && !allowlist.has(declared)) {
      return fail(
        "Tokenized-security execution is fail-closed until this country is approved in the deployment allowlist.",
      );
    }
  }

  return {
    eligible: true,
    countryCode: declared,
    observedCountryCode: observed,
    policyId,
    reason: "Eligibility evidence passed the current closed-beta policy.",
    policySourceUrl: source,
  };
}
