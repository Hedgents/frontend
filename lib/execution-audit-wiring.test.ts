import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("submission persists an exact immutable intent after every guard and before Jupiter", () => {
  const route = source("../app/api/execution/execute/route.ts");
  const signedSimulation = route.indexOf("const observedGuard = await simulateSolanaTransaction");
  const compatible = route.indexOf("assertTransactionGuardCompatible(", signedSimulation);
  const auditIntent = route.indexOf("await recordExecutionSubmissionIntent(", compatible);
  const unknown = route.indexOf('submissionState = "unknown"', auditIntent);
  const jupiter = route.indexOf("await executeJupiterOrder(", unknown);

  assert.ok(signedSimulation >= 0 && compatible > signedSimulation);
  assert.ok(auditIntent > compatible, "guard failures must remain definitely not submitted");
  assert.ok(unknown > auditIntent, "audit persistence must complete before state becomes unknown");
  assert.ok(jupiter > unknown, "Jupiter must never run before the immutable intent");
  for (const field of [
    "transactionMessageDigest: claims.transactionMessageDigest",
    "transactionGuardReportDigest: claims.transactionGuard.reportDigest",
    "programFingerprint: claims.transactionGuard.programFingerprint",
    "lastValidBlockHeight: claims.lastValidBlockHeight",
  ]) assert.match(route.slice(auditIntent, unknown), new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("duplicates and uncertain intent writes return unknown with the signature and never reach Jupiter", () => {
  const route = source("../app/api/execution/execute/route.ts");
  assert.match(route, /error instanceof ExecutionAuditDuplicateIntentError/);
  assert.match(route, /error instanceof ExecutionAuditWriteOutcomeUnknownError/);
  assert.match(route, /auditSignature = error\.signature/);
  assert.match(route, /submissionState = "unknown"/);
  assert.match(route, /\{ signature: auditSignature \}/);

  const auditIntent = route.indexOf("await recordExecutionSubmissionIntent(");
  const jupiter = route.indexOf("await executeJupiterOrder(");
  assert.ok(auditIntent >= 0 && jupiter > auditIntent, "an audit throw must short-circuit the venue call");
});

test("post-response observations cannot replace execution or recovery responses", () => {
  const scheduler = source("./execution-audit-after.ts");
  assert.match(scheduler, /try \{/);
  assert.match(scheduler, /after\(\(\) => recordExecutionAuditObservation\(input\)\)/);
  assert.match(scheduler, /catch \{/);

  const execute = source("../app/api/execution/execute/route.ts");
  assert.match(execute, /errorCode: settlement\.errorCode \?\? null/);
  assert.match(execute, /submissionState: "unknown",\s*settlementState: "pending",\s*errorCode: null/s);

  const status = source("../app/api/execution/status/route.ts");
  const settlement = status.indexOf("await verifySolanaSettlement");
  const observation = status.indexOf("scheduleExecutionAuditObservation", settlement);
  const response = status.indexOf("return NextResponse.json", observation);
  assert.ok(settlement >= 0 && observation > settlement && response > observation);
  assert.match(status.slice(observation, response), /submissionStateFromSettlement\(settlement\)/);
  assert.match(status.slice(observation, response), /errorCode: settlement\.errorCode \?\? null/);
});

test("operator readiness covers debit cap, program fingerprints, and the mandatory audit ledger", () => {
  const readiness = source("./beta-readiness.ts");
  assert.match(readiness, /configuredMaximumSolDebitLamports\(\)/);
  assert.match(readiness, /configuredProgramFingerprintAllowlist\(\)/);
  assert.match(readiness, /executionAuditConfigurationStatus\(\{ production: true \}\)/);
  assert.match(readiness, /"execution-audit"/);
});
