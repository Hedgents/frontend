import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductEligibility, parseEligibilityEvidence } from "./eligibility";
import { solanaExecutionProducts } from "./product-registry";

const evidence = {
  countryCode: "PL",
  legalAge: true,
  acceptsIssuerTerms: true,
  notRestrictedPerson: true,
};

test("requires complete eligibility evidence and matching observed country", () => {
  const product = solanaExecutionProducts["gold-paxg"];
  assert.equal(evaluateProductEligibility(product, parseEligibilityEvidence(evidence), "PL").eligible, true);
  assert.equal(evaluateProductEligibility(product, parseEligibilityEvidence({ ...evidence, legalAge: false }), "PL").eligible, false);
  assert.equal(evaluateProductEligibility(product, parseEligibilityEvidence(evidence), "DE").eligible, false);
});

test("blocks issuer-restricted countries and fails tokenized securities closed in production", () => {
  const xstocks = solanaExecutionProducts["gold-gldx"];
  const ondo = solanaExecutionProducts["gold-gldon"];
  assert.equal(evaluateProductEligibility(xstocks, parseEligibilityEvidence({ ...evidence, countryCode: "US" }), "US").eligible, false);
  assert.equal(evaluateProductEligibility(xstocks, parseEligibilityEvidence(evidence), "PL", {
    production: true,
    securityCountryAllowlist: new Set(),
  }).eligible, true);
  assert.equal(evaluateProductEligibility(xstocks, parseEligibilityEvidence(evidence), "PL", {
    production: true,
    securityCountryAllowlist: new Set(["DE"]),
  }).eligible, false);
  assert.equal(evaluateProductEligibility(ondo, parseEligibilityEvidence(evidence), "PL", { production: true }).eligible, false);
  assert.equal(evaluateProductEligibility(ondo, parseEligibilityEvidence(evidence), "PL", {
    production: true,
    securityCountryAllowlist: new Set(["PL"]),
  }).eligible, true);
  assert.equal(evaluateProductEligibility(ondo, parseEligibilityEvidence(evidence), null, {
    production: true,
    securityCountryAllowlist: new Set(["PL"]),
  }).eligible, false);
});

test("new physical-metal policies enforce evidence and sanctions without a securities allowlist", () => {
  for (const productId of ["gold-xaut0", "silver-silv"] as const) {
    const product = solanaExecutionProducts[productId];
    const allowed = evaluateProductEligibility(product, parseEligibilityEvidence(evidence), "PL", {
      production: true,
      securityCountryAllowlist: new Set(),
    });
    assert.equal(allowed.eligible, true, productId);
    assert.match(allowed.policySourceUrl, /^https:\/\//);

    const blockedEvidence = parseEligibilityEvidence({ ...evidence, countryCode: "IR" });
    assert.equal(
      evaluateProductEligibility(product, blockedEvidence, "IR", { production: true }).eligible,
      false,
      productId,
    );
  }
});
