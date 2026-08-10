import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductExecutionAllowed,
  assertExecutionWithinBetaCap,
  assertUsdBaseUnitAmountWithinBetaCap,
  effectiveBuyMaximumUsd,
  getExecutionControls,
  getPublicExecutionControls,
  requireExecutionSubmissionEnabled,
} from "./execution-controls";
import { ExecutionValidationError } from "./execution-validation";
import { solanaExecutionProducts } from "./product-registry";

test("production execution fails closed unless explicitly enabled", () => {
  const missingAllowlist = getExecutionControls({}, "production");
  assert.equal(missingAllowlist.enabled, false);
  assert.equal(missingAllowlist.configurationValid, false);
  assert.equal(missingAllowlist.productAllowlistConfigured, false);
  assert.equal(missingAllowlist.productAllowlistValid, false);
  assert.deepEqual(missingAllowlist.allowedProductIds, []);
  assert.match(missingAllowlist.issue ?? "", /PRODUCT_ALLOWLIST is required/);

  const enabled = getExecutionControls({
    HEDGENTS_EXECUTION_ENABLED: "true",
    HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST: "gold-paxg",
  }, "production");
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.configurationValid, true);
  assert.deepEqual(enabled.allowedProductIds, ["gold-paxg"]);

  const development = getExecutionControls({}, "development");
  assert.equal(development.enabled, true);
  assert.equal(development.productAllowlistConfigured, false);
  assert.equal(development.productAllowlistValid, true);
  assert.deepEqual(development.allowedProductIds, Object.keys(solanaExecutionProducts).sort());
  assert.equal(
    getExecutionControls({ HEDGENTS_EXECUTION_ENABLED: "false" }, "development").enabled,
    false,
  );
});

test("configured product allowlists are strict, registered, and publicly observable", () => {
  const controls = getExecutionControls({
    HEDGENTS_EXECUTION_ENABLED: "true",
    HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST: "gold-paxg, gold-oro",
  }, "production");
  assert.equal(controls.productAllowlistConfigured, true);
  assert.equal(controls.productAllowlistValid, true);
  assert.deepEqual(controls.allowedProductIds, ["gold-paxg", "gold-oro"]);

  const publicControls = getPublicExecutionControls({
    HEDGENTS_EXECUTION_ENABLED: "true",
    HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST: "gold-paxg",
  }, "production");
  assert.deepEqual(publicControls.allowedProductIds, ["gold-paxg"]);
  assert.equal(publicControls.productAllowlistConfigured, true);
  assert.equal(publicControls.productAllowlistValid, true);

  for (const value of ["", "gold-paxg,", "gold-paxg,gold-paxg", "not-a-product"]) {
    const invalid = getExecutionControls({
      HEDGENTS_EXECUTION_ENABLED: "true",
      HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST: value,
    }, "production");
    assert.equal(invalid.enabled, false, value);
    assert.equal(invalid.configurationValid, false, value);
    assert.equal(invalid.productAllowlistValid, false, value);
    assert.deepEqual(invalid.allowedProductIds, [], value);
  }
});

test("the product guard permits only the current server-side allowlist", () => {
  const controls = getExecutionControls({
    HEDGENTS_EXECUTION_ENABLED: "true",
    HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST: "gold-paxg",
  }, "production");
  assert.doesNotThrow(() => assertProductExecutionAllowed("gold-paxg", controls));
  assert.throws(
    () => assertProductExecutionAllowed("gold-oro", controls),
    (error: unknown) => error instanceof ExecutionValidationError
      && error.status === 503
      && /read-only discovery/.test(error.message),
  );

  const invalid = getExecutionControls({
    HEDGENTS_EXECUTION_ENABLED: "true",
    HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST: "unknown-product",
  }, "production");
  assert.throws(
    () => assertProductExecutionAllowed("gold-paxg", invalid),
    (error: unknown) => error instanceof ExecutionValidationError
      && error.status === 503
      && /missing or invalid/.test(error.message),
  );
});

test("closed-beta maximum defaults to $100 and rejects unsafe configuration", () => {
  assert.equal(getExecutionControls({}, "test").maxUsd, 100);
  assert.equal(getExecutionControls({ HEDGENTS_BETA_MAX_USD: "25" }, "test").maxUsd, 25);
  const invalid = getExecutionControls({
    HEDGENTS_EXECUTION_ENABLED: "true",
    HEDGENTS_BETA_MAX_USD: "10000",
    HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST: "gold-paxg",
  }, "production");
  assert.equal(invalid.configurationValid, false);
  assert.equal(invalid.enabled, false);
  assert.equal(invalid.maxUsd, 100);
});

test("wallet rejection mode preserves quote building but hard-disables submission", () => {
  const controls = getExecutionControls({
    HEDGENTS_EXECUTION_ENABLED: "true",
    HEDGENTS_WALLET_REJECTION_MODE: "true",
    HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST: "gold-paxg",
  }, "production");
  assert.equal(controls.enabled, true);
  assert.equal(controls.rejectionOnly, true);

  const originalEnabled = process.env.HEDGENTS_EXECUTION_ENABLED;
  const originalMode = process.env.HEDGENTS_WALLET_REJECTION_MODE;
  const originalAllowlist = process.env.HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST;
  process.env.HEDGENTS_EXECUTION_ENABLED = "true";
  process.env.HEDGENTS_WALLET_REJECTION_MODE = "true";
  process.env.HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST = "gold-paxg";
  try {
    assert.throws(() => requireExecutionSubmissionEnabled(), ExecutionValidationError);
  } finally {
    if (originalEnabled === undefined) delete process.env.HEDGENTS_EXECUTION_ENABLED;
    else process.env.HEDGENTS_EXECUTION_ENABLED = originalEnabled;
    if (originalMode === undefined) delete process.env.HEDGENTS_WALLET_REJECTION_MODE;
    else process.env.HEDGENTS_WALLET_REJECTION_MODE = originalMode;
    if (originalAllowlist === undefined) delete process.env.HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST;
    else process.env.HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST = originalAllowlist;
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
