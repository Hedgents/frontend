import { ExecutionValidationError } from "@/lib/execution-validation";
import type { TradeSide } from "@/lib/execution-types";
import { solanaExecutionProducts } from "@/lib/product-registry";

const DEFAULT_BETA_MAX_USD = 100;
const MINIMUM_BETA_MAX_USD = 10;
const MAXIMUM_BETA_MAX_USD = 1_000;

type ExecutionControlEnvironment = Record<string, string | undefined>;

const REGISTERED_EXECUTION_PRODUCT_IDS = Object.freeze(
  Object.keys(solanaExecutionProducts).sort(),
);

interface ProductAllowlistControl {
  configured: boolean;
  valid: boolean;
  allowedProductIds: readonly string[];
  issue: string | null;
}

export interface PublicExecutionControls {
  enabled: boolean;
  maxUsd: number;
  rejectionOnly: boolean;
  productAllowlistConfigured: boolean;
  productAllowlistValid: boolean;
  allowedProductIds: readonly string[];
}

export interface ExecutionControls extends PublicExecutionControls {
  configurationValid: boolean;
  issue: string | null;
  productAllowlistIssue: string | null;
}

function productAllowlistControl(
  rawValue: string | undefined,
  nodeEnvironment: string | undefined,
): ProductAllowlistControl {
  if (rawValue === undefined) {
    if (nodeEnvironment === "production") {
      return {
        configured: false,
        valid: false,
        allowedProductIds: [],
        issue: "HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST is required in production.",
      };
    }
    return {
      configured: false,
      valid: true,
      allowedProductIds: REGISTERED_EXECUTION_PRODUCT_IDS,
      issue: null,
    };
  }

  const entries = rawValue.split(",").map((value) => value.trim());
  if (entries.length === 0 || entries.some((value) => value.length === 0)) {
    return {
      configured: true,
      valid: false,
      allowedProductIds: [],
      issue: "HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST must contain comma-separated registered product IDs without empty entries.",
    };
  }

  if (new Set(entries).size !== entries.length) {
    return {
      configured: true,
      valid: false,
      allowedProductIds: [],
      issue: "HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST must not contain duplicate product IDs.",
    };
  }

  const registeredIds = new Set(REGISTERED_EXECUTION_PRODUCT_IDS);
  const unknownEntries = entries.filter((value) => !registeredIds.has(value));
  if (unknownEntries.length > 0) {
    return {
      configured: true,
      valid: false,
      allowedProductIds: [],
      issue: `HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST contains unregistered product IDs: ${unknownEntries.join(", ")}.`,
    };
  }

  return {
    configured: true,
    valid: true,
    allowedProductIds: Object.freeze([...entries]),
    issue: null,
  };
}

export function getExecutionControls(
  environment: ExecutionControlEnvironment = process.env,
  nodeEnvironment = process.env.NODE_ENV,
): ExecutionControls {
  const rawEnabled = environment.HEDGENTS_EXECUTION_ENABLED?.trim().toLowerCase();
  const toggleValid = rawEnabled === undefined || rawEnabled === "true" || rawEnabled === "false";
  const requestedEnabled = rawEnabled === "true" || (rawEnabled === undefined && nodeEnvironment !== "production");
  const rawRejectionOnly = environment.HEDGENTS_WALLET_REJECTION_MODE?.trim().toLowerCase();
  const rejectionToggleValid = rawRejectionOnly === undefined
    || rawRejectionOnly === "true"
    || rawRejectionOnly === "false";
  const rejectionOnly = rawRejectionOnly === "true";

  const rawMaximum = environment.HEDGENTS_BETA_MAX_USD?.trim();
  const parsedMaximum = rawMaximum === undefined || rawMaximum === ""
    ? DEFAULT_BETA_MAX_USD
    : Number(rawMaximum);
  const maximumValid = Number.isSafeInteger(parsedMaximum)
    && parsedMaximum >= MINIMUM_BETA_MAX_USD
    && parsedMaximum <= MAXIMUM_BETA_MAX_USD;
  const maxUsd = maximumValid ? parsedMaximum : DEFAULT_BETA_MAX_USD;
  const productAllowlist = productAllowlistControl(
    environment.HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST,
    nodeEnvironment,
  );

  const issue = !toggleValid
    ? "HEDGENTS_EXECUTION_ENABLED must be true or false."
    : !rejectionToggleValid
      ? "HEDGENTS_WALLET_REJECTION_MODE must be true or false."
      : !maximumValid
      ? `HEDGENTS_BETA_MAX_USD must be an integer between ${MINIMUM_BETA_MAX_USD} and ${MAXIMUM_BETA_MAX_USD}.`
      : !productAllowlist.valid
      ? productAllowlist.issue
      : null;

  return {
    enabled: requestedEnabled && issue === null,
    maxUsd,
    rejectionOnly,
    productAllowlistConfigured: productAllowlist.configured,
    productAllowlistValid: productAllowlist.valid,
    allowedProductIds: productAllowlist.allowedProductIds,
    configurationValid: issue === null,
    issue,
    productAllowlistIssue: productAllowlist.issue,
  };
}

export function getPublicExecutionControls(
  environment: ExecutionControlEnvironment = process.env,
  nodeEnvironment = process.env.NODE_ENV,
): PublicExecutionControls {
  const controls = getExecutionControls(environment, nodeEnvironment);
  return {
    enabled: controls.enabled,
    maxUsd: controls.maxUsd,
    rejectionOnly: controls.rejectionOnly,
    productAllowlistConfigured: controls.productAllowlistConfigured,
    productAllowlistValid: controls.productAllowlistValid,
    allowedProductIds: [...controls.allowedProductIds],
  };
}

export function assertProductExecutionAllowed(
  productId: string,
  controls: Pick<PublicExecutionControls, "productAllowlistValid" | "allowedProductIds"> = getExecutionControls(),
) {
  if (!controls.productAllowlistValid) {
    throw new ExecutionValidationError(
      "New execution is paused because the production product allowlist is missing or invalid.",
      503,
    );
  }
  if (!controls.allowedProductIds.includes(productId)) {
    throw new ExecutionValidationError(
      `${productId} is not enabled for closed-beta execution. It remains available for read-only discovery.`,
      503,
    );
  }
}

export function requireNewExecutionEnabled() {
  const controls = getExecutionControls();
  if (!controls.configurationValid) {
    throw new ExecutionValidationError(
      `New execution is paused because the operator control is invalid. ${controls.issue}`,
      503,
    );
  }
  if (!controls.enabled) {
    throw new ExecutionValidationError(
      "New execution is paused by the operator. Existing pending receipts can still be verified.",
      503,
    );
  }
  return controls;
}

export function requireExecutionSubmissionEnabled() {
  const controls = requireNewExecutionEnabled();
  if (controls.rejectionOnly) {
    throw new ExecutionValidationError(
      "This isolated wallet test can build and sign quotes, but transaction submission is hard-disabled.",
      503,
    );
  }
  return controls;
}

export function effectiveBuyMaximumUsd(productMaximumUsd: number, betaMaximumUsd: number) {
  return Math.min(productMaximumUsd, betaMaximumUsd);
}

export function assertUsdBaseUnitAmountWithinBetaCap(
  amount: string,
  decimals: number,
  controls: Pick<PublicExecutionControls, "maxUsd"> = getExecutionControls(),
) {
  if (!/^\d+$/.test(amount) || decimals < 0 || !Number.isSafeInteger(decimals)) {
    throw new ExecutionValidationError("The protected stablecoin amount is malformed.", 502);
  }
  const maximumBaseUnits = BigInt(controls.maxUsd) * 10n ** BigInt(decimals);
  if (BigInt(amount) > maximumBaseUnits) {
    throw new ExecutionValidationError(
      `Closed beta limits each trade to $${controls.maxUsd.toLocaleString()} or less.`,
    );
  }
}

export function assertExecutionWithinBetaCap(
  claims: {
    side: TradeSide;
    inputAmount: string;
    minimumOutputAmount: string;
    quotedOutputAmount?: string;
    betaMaximumUsd?: number;
  },
  stablecoinDecimals: number,
  controls: Pick<PublicExecutionControls, "maxUsd"> = getExecutionControls(),
) {
  const stablecoinAmount = claims.side === "buy" ? claims.inputAmount : claims.quotedOutputAmount;
  if (!stablecoinAmount) {
    throw new ExecutionValidationError(
      "The executable sell quote does not contain a beta-capped output amount. Build a fresh route.",
    );
  }
  assertUsdBaseUnitAmountWithinBetaCap(
    stablecoinAmount,
    stablecoinDecimals,
    controls,
  );
  if (claims.betaMaximumUsd !== undefined) {
    assertUsdBaseUnitAmountWithinBetaCap(stablecoinAmount, stablecoinDecimals, {
      maxUsd: claims.betaMaximumUsd,
    });
  }
}
