import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { CCTP_ATTESTATION_ORIGIN } from "./rail-cctp";
import { getPublicTerminalFeatures } from "./terminal-feature-controls";

test("the CSP-allowlisted attestation origin still matches the CCTP plugin default", () => {
  // The plugin fetches Circle's attestation service directly from the browser, and the terminal
  // ships an explicit connect-src allowlist. A plugin upgrade that moved the host would silently
  // break the documented "resume an already-broadcast source burn" path, so pin it here.
  const require = createRequire(import.meta.url);
  // The package does not export ./package.json, so resolve its entry point and walk up to dist/.
  const distDirectory = dirname(require.resolve("@hedgents/stablecoin-rail-cctp"));
  const distinct = new Set<string>();
  for (const entry of readdirSync(distDirectory)) {
    if (!entry.endsWith(".js")) continue;
    const source = readFileSync(join(distDirectory, entry), "utf8");
    // Only API hosts matter; documentation links on circle.com are never fetched.
    for (const match of source.matchAll(/https:\/\/[a-z0-9-]*api[a-z0-9.-]*\.circle\.com/g)) {
      distinct.add(match[0]);
    }
  }
  assert.deepEqual([...distinct], [CCTP_ATTESTATION_ORIGIN]);
});

test("rail funding stays off unless the operator opts in explicitly", () => {
  assert.equal(getPublicTerminalFeatures({}).railFundingEnabled, false);
  assert.equal(getPublicTerminalFeatures({ HEDGENTS_RAIL_FUNDING_ENABLED: "TRUE" }).railFundingEnabled, false);
  assert.equal(getPublicTerminalFeatures({ HEDGENTS_RAIL_FUNDING_ENABLED: "1" }).railFundingEnabled, false);
  assert.equal(getPublicTerminalFeatures({ HEDGENTS_RAIL_FUNDING_ENABLED: "true" }).railFundingEnabled, true);
});
