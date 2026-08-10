import assert from "node:assert/strict";
import test from "node:test";
import { validateScarcityGovernance } from "./scarcity-governance";

test("mainnet governance fails closed without multisig, challenge, audit, and incident commitments", () => {
  assert.throws(() => validateScarcityGovernance(null), /required/);
  assert.throws(() => validateScarcityGovernance({ authorityModel: "single-signer" }), /multisig/);
  assert.throws(() => validateScarcityGovernance({
    authorityModel: "multisig",
    minimumApprovals: 2,
    manualChallengeWindowHours: 12,
    auditReportUrl: "https://example.com/audit",
    disputePolicyUrl: "https://example.com/disputes",
    incidentResponseUrl: "https://example.com/incidents",
  }), /24 hours/);
  assert.equal(validateScarcityGovernance({
    authorityModel: "multisig",
    minimumApprovals: 2,
    manualChallengeWindowHours: 48,
    auditReportUrl: "https://example.com/audit",
    disputePolicyUrl: "https://example.com/disputes",
    incidentResponseUrl: "https://example.com/incidents",
  }).minimumApprovals, 2);
});
