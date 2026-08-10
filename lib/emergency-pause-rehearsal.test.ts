import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ExecutionValidationError } from "./execution-validation";
import {
  assertProductExecutionAllowed,
  getExecutionControls,
  requireExecutionSubmissionEnabled,
  requireNewExecutionEnabled,
} from "./execution-controls";
import { getPublicTerminalFeatures } from "./terminal-feature-controls";

const NEW_TRADE_ROUTES = [
  "../app/api/execution/compare/route.ts",
  "../app/api/execution/order/route.ts",
  "../app/api/execution/execute/route.ts",
] as const;
const RECOVERY_ROUTE = "../app/api/execution/status/route.ts";

function routeSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function withEnvironment<T>(overrides: Record<string, string | undefined>, run: () => T): T {
  const mutable = process.env as Record<string, string | undefined>;
  const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete mutable[key];
      else mutable[key] = value;
    }
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete mutable[key];
      else mutable[key] = value;
    }
  }
}

const PAUSED = {
  NODE_ENV: "production",
  HEDGENTS_EXECUTION_ENABLED: "false",
  HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST: "gold-paxg",
  HEDGENTS_BETA_MAX_USD: "100",
} as const;

const LIVE = { ...PAUSED, HEDGENTS_EXECUTION_ENABLED: "true" } as const;

test("the emergency pause blocks comparison, order assembly, and submission", () => {
  withEnvironment(PAUSED, () => {
    for (const guard of [requireNewExecutionEnabled, requireExecutionSubmissionEnabled]) {
      assert.throws(
        () => guard(),
        (error: unknown) =>
          error instanceof ExecutionValidationError
          && error.status === 503
          && /paused by the operator/.test(error.message),
        guard.name,
      );
    }
  });
});

test("the pause is not cached: every execution route is force-dynamic", () => {
  for (const path of [...NEW_TRADE_ROUTES, RECOVERY_ROUTE]) {
    assert.match(routeSource(path), /export const dynamic = "force-dynamic";/, path);
  }
});

test("settlement recovery survives the pause", () => {
  // The recovery route must never import an execution switch, or pausing the beta would strand
  // testers who already hold a signed receipt for an in-flight transaction.
  const source = routeSource(RECOVERY_ROUTE);
  assert.doesNotMatch(source, /requireNewExecutionEnabled|requireExecutionSubmissionEnabled/);
  assert.match(source, /validateRecoveryAuthorization\(/);
  assert.match(source, /verifySolanaSettlement\([^)]*"finalized"\)/);
  // ...and it must not be gated behind the beta cookie either: recovery is possession-based.
  assert.doesNotMatch(source, /BETA_COOKIE|readAccessSession/);
});

test("the three operator switches are independent of one another", () => {
  // Pausing execution must not silently satisfy the product allowlist, and neither switch may
  // turn Ethereum/Base funding back on.
  withEnvironment({ ...LIVE, HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST: undefined }, () => {
    const controls = getExecutionControls();
    assert.equal(controls.enabled, false, "a missing production allowlist must fail closed");
    assert.throws(() => assertProductExecutionAllowed("gold-paxg", controls), /paused/);
  });

  withEnvironment(LIVE, () => {
    const controls = getExecutionControls();
    assert.equal(controls.enabled, true);
    assert.deepEqual([...controls.allowedProductIds], ["gold-paxg"]);
    assert.throws(() => assertProductExecutionAllowed("silver-slvx", controls), /not enabled for closed-beta/);
    assert.doesNotThrow(() => assertProductExecutionAllowed("gold-paxg", controls));
    assert.equal(getPublicTerminalFeatures().railFundingEnabled, false);
  });

  withEnvironment({ ...PAUSED, HEDGENTS_RAIL_FUNDING_ENABLED: "true" }, () => {
    assert.equal(getExecutionControls().enabled, false);
    assert.equal(getPublicTerminalFeatures().railFundingEnabled, true, "the rail flag is its own switch");
  });
});

test("the QA rejection mode blocks submission without blocking quotes", () => {
  withEnvironment({ ...LIVE, HEDGENTS_WALLET_REJECTION_MODE: "true" }, () => {
    assert.doesNotThrow(() => requireNewExecutionEnabled());
    assert.throws(() => requireExecutionSubmissionEnabled(), /hard-disabled/);
  });
});
