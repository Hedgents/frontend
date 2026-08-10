import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExecutionWithinBetaCap,
  assertUsdBaseUnitAmountWithinBetaCap,
  effectiveBuyMaximumUsd,
  getExecutionControls,
  requireExecutionSubmissionEnabled,
} from "./execution-controls";
import { ExecutionValidationError } from "./execution-validation";

test("production execution fails closed unless explicitly enabled", () => {
  assert.equal(getExecutionControls({}, "production").enabled, false);
  assert.equal(
    getExecutionControls({ HEDGENTS_EXECUTION_ENABLED: "true" }, "production").enabled,
    true,
  );
  assert.equal(getExecutionControls({}, "development").enabled, true);
  assert.equal(
    getExecutionControls({ HEDGENTS_EXECUTION_ENABLED: "false" }, "development").enabled,
    false,
  );
});

test("closed-beta maximum defaults to $100 and rejects unsafe configuration", () => {
  assert.equal(getExecutionControls({}, "test").maxUsd, 100);
  assert.equal(getExecutionControls({ HEDGENTS_BETA_MAX_USD: "25" }, "test").maxUsd, 25);
  const invalid = getExecutionControls({
    HEDGENTS_EXECUTION_ENABLED: "true",
    HEDGENTS_BETA_MAX_USD: "10000",
  }, "production");
  assert.equal(invalid.configurationValid, false);
  assert.equal(invalid.enabled, false);
  assert.equal(invalid.maxUsd, 100);
});

test("wallet rejection mode preserves quote building but hard-disables submission", () => {
  const controls = getExecutionControls({
    HEDGENTS_EXECUTION_ENABLED: "true",
    HEDGENTS_WALLET_REJECTION_MODE: "true",
  }, "production");
  assert.equal(controls.enabled, true);
  assert.equal(controls.rejectionOnly, true);

  const originalEnabled = process.env.HEDGENTS_EXECUTION_ENABLED;
  const originalMode = process.env.HEDGENTS_WALLET_REJECTION_MODE;
  process.env.HEDGENTS_EXECUTION_ENABLED = "true";
  process.env.HEDGENTS_WALLET_REJECTION_MODE = "true";
  try {
    assert.throws(() => requireExecutionSubmissionEnabled(), ExecutionValidationError);
  } finally {
    if (originalEnabled === undefined) delete process.env.HEDGENTS_EXECUTION_ENABLED;
    else process.env.HEDGENTS_EXECUTION_ENABLED = originalEnabled;
    if (originalMode === undefined) delete process.env.HEDGENTS_WALLET_REJECTION_MODE;
    else process.env.HEDGENTS_WALLET_REJECTION_MODE = originalMode;
  }
});

test("product and beta caps compose without weakening either limit", () => {
  assert.equal(effectiveBuyMaximumUsd(2_500, 100), 100);
  assert.equal(effectiveBuyMaximumUsd(50, 100), 50);
});

test("buy and sell stablecoin values are enforced in exact base units", () => {
  const controls = { enabled: true, maxUsd: 100, rejectionOnly: false };
  assert.doesNotThrow(() => assertExecutionWithinBetaCap({
    side: "buy",
    inputAmount: "100000000",
    minimumOutputAmount: "1",
    quotedOutputAmount: "1",
    betaMaximumUsd: 100,
  }, 6, controls));
  assert.throws(() => assertExecutionWithinBetaCap({
    side: "buy",
    inputAmount: "100000001",
    minimumOutputAmount: "1",
    quotedOutputAmount: "1",
    betaMaximumUsd: 100,
  }, 6, controls), ExecutionValidationError);
  assert.doesNotThrow(() => assertExecutionWithinBetaCap({
    side: "sell",
    inputAmount: "999999999999",
    minimumOutputAmount: "100000000",
    quotedOutputAmount: "100000000",
    betaMaximumUsd: 100,
  }, 6, controls));
  assert.throws(() => assertExecutionWithinBetaCap({
    side: "sell",
    inputAmount: "1",
    minimumOutputAmount: "99000000",
    quotedOutputAmount: "101000000",
    betaMaximumUsd: 100,
  }, 6, controls), ExecutionValidationError);
  assert.throws(() => assertUsdBaseUnitAmountWithinBetaCap(
    "100000001",
    6,
    controls,
  ), ExecutionValidationError);
});
