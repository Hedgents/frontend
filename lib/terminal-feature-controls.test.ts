import assert from "node:assert/strict";
import test from "node:test";
import { getPublicTerminalFeatures } from "./terminal-feature-controls";

test("terminal Rail funding fails closed unless explicitly enabled", () => {
  assert.equal(getPublicTerminalFeatures({}).railFundingEnabled, false);
  assert.equal(
    getPublicTerminalFeatures({ HEDGENTS_RAIL_FUNDING_ENABLED: "false" }).railFundingEnabled,
    false,
  );
  assert.equal(
    getPublicTerminalFeatures({ HEDGENTS_RAIL_FUNDING_ENABLED: "not-a-boolean" })
      .railFundingEnabled,
    false,
  );
  assert.equal(
    getPublicTerminalFeatures({ HEDGENTS_RAIL_FUNDING_ENABLED: " TRUE " })
      .railFundingEnabled,
    false,
  );
  assert.equal(
    getPublicTerminalFeatures({ HEDGENTS_RAIL_FUNDING_ENABLED: "TRUE" })
      .railFundingEnabled,
    false,
  );
  assert.equal(
    getPublicTerminalFeatures({ HEDGENTS_RAIL_FUNDING_ENABLED: "true" })
      .railFundingEnabled,
    true,
  );
});
