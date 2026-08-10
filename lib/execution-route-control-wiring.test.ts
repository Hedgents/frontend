import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function routeSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("every new-trade route wires the emergency execution guard", () => {
  for (const path of [
    "../app/api/execution/compare/route.ts",
    "../app/api/execution/order/route.ts",
  ]) {
    const source = routeSource(path);
    assert.match(source, /requireNewExecutionEnabled\(\)/, path);
  }
  assert.match(
    routeSource("../app/api/execution/execute/route.ts"),
    /requireExecutionSubmissionEnabled\(\)/,
    "execute route",
  );
});

test("every new-trade route checks the product allowlist before venue work", () => {
  const venueBoundaryByRoute = new Map([
    ["../app/api/execution/compare/route.ts", "getJupiterOrder("],
    ["../app/api/execution/order/route.ts", "getJupiterOrder("],
    ["../app/api/execution/execute/route.ts", "executeJupiterOrder("],
  ]);
  for (const [path, venueBoundary] of venueBoundaryByRoute) {
    const source = routeSource(path);
    const allowlistGuard = source.indexOf("assertProductExecutionAllowed(");
    const venueWork = source.indexOf(venueBoundary);
    assert.ok(allowlistGuard >= 0, `${path} product allowlist guard`);
    assert.ok(venueWork > allowlistGuard, `${path} must fail closed before venue work`);
  }
});

test("read-only product registry and quote discovery do not use the execution allowlist", () => {
  for (const path of ["../app/api/registry/route.ts", "../app/api/quotes/route.ts"]) {
    const source = routeSource(path);
    assert.doesNotMatch(source, /assertProductExecutionAllowed|requireNewExecutionEnabled/, path);
  }
});

test("settlement recovery remains independent of the new-trade guard", () => {
  const source = routeSource("../app/api/execution/status/route.ts");
  assert.doesNotMatch(source, /requireNewExecutionEnabled/, "recovery route");
  assert.match(source, /validateRecoveryAuthorization/, "recovery authorization");
  assert.match(source, /verifySolanaSettlement/, "settlement verification");
});

test("wallet QA approval stops before persistence or submission", () => {
  const source = routeSource("../components/MetalTerminal.tsx");
  const qaGuard = source.indexOf("if (executionControl.rejectionOnly)");
  const pendingPersistence = source.indexOf("saveExecutionRecord(pendingRecord)", qaGuard);
  const executeRequest = source.indexOf('fetch("/api/execution/execute"', qaGuard);
  assert.notEqual(qaGuard, -1, "wallet QA client guard");
  assert.ok(pendingPersistence > qaGuard, "pending persistence must follow the QA guard");
  assert.ok(executeRequest > qaGuard, "execute request must follow the QA guard");
  assert.match(source.slice(qaGuard, Math.min(pendingPersistence, executeRequest)), /return;/);
});

test("post-Jupiter outcomes stay recoverable until independent settlement evidence", () => {
  const route = routeSource("../app/api/execution/execute/route.ts");
  assert.match(route, /const settlement = await verifySolanaSettlement\(signature, claims, "finalized"\)/);
  assert.match(route, /submissionStateFromSettlement\(settlement\)/);
  assert.doesNotMatch(route, /venueStatus === "Success"[^\n]*\?[^\n]*verifySolanaSettlement/);

  const verifier = routeSource("./jupiter-server.ts");
  const binding = verifier.indexOf("const settledBinding = bindSolanaTransaction");
  const onchainFailure = verifier.indexOf("if (result.meta.err)", binding);
  assert.ok(binding >= 0 && onchainFailure > binding, "transaction bytes must be bound before trusting meta.err");
});

test("unverified results are never presented as wallet receipts", () => {
  const source = routeSource("../components/MetalTerminal.tsx");
  assert.match(source, /Quoted \/ venue-reported · not verified/);
  assert.match(source, /not yet proven in your wallet/);
  assert.match(source, /payload\.submissionState === "submitted"/);
  assert.doesNotMatch(source, /submissionState: payload\.submissionState \?\? "submitted"/);
});
