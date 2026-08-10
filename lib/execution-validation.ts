import { address } from "@solana/kit";

export class ExecutionValidationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ExecutionValidationError";
  }
}

export function parseDecimalToBaseUnits(
  value: unknown,
  decimals: number,
  minimum: number,
  maximum: number,
) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(value.trim())) {
    throw new ExecutionValidationError("Enter a valid USDC amount with at most six decimals.");
  }

  const normalized = value.trim();
  const [whole, fraction = ""] = normalized.split(".");
  const baseUnits = BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0").slice(0, decimals));
  const minimumBaseUnits = BigInt(minimum) * 10n ** BigInt(decimals);
  const maximumBaseUnits = BigInt(maximum) * 10n ** BigInt(decimals);

  if (baseUnits < minimumBaseUnits || baseUnits > maximumBaseUnits) {
    throw new ExecutionValidationError(
      `Order size must be between $${minimum.toLocaleString()} and $${maximum.toLocaleString()}.`,
    );
  }

  return baseUnits.toString();
}

const MAX_U64 = 18_446_744_073_709_551_615n;

export function parseTokenAmountToBaseUnits(
  value: unknown,
  decimals: number,
  symbol: string,
) {
  const maximumFraction = Math.max(0, Math.min(decimals, 18));
  const pattern = maximumFraction > 0
    ? new RegExp(`^\\d+(?:\\.\\d{1,${maximumFraction}})?$`)
    : /^\d+$/;
  if (typeof value !== "string" || value.length > 48 || !pattern.test(value.trim())) {
    throw new ExecutionValidationError(
      `Enter a valid ${symbol} amount with at most ${maximumFraction} decimals.`,
    );
  }

  const [whole, fraction = ""] = value.trim().split(".");
  const baseUnits = BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"));
  if (baseUnits <= 0n) {
    throw new ExecutionValidationError(`Enter a ${symbol} amount greater than zero.`);
  }
  if (baseUnits > MAX_U64) {
    throw new ExecutionValidationError(`The ${symbol} amount is too large for a Solana token transfer.`);
  }
  return baseUnits.toString();
}

export function validateSolanaAddress(value: unknown) {
  if (typeof value !== "string" || value.length > 64) {
    throw new ExecutionValidationError("Connect a valid Solana wallet.");
  }
  try {
    return address(value).toString();
  } catch {
    throw new ExecutionValidationError("Connect a valid Solana wallet.");
  }
}

export function validateSignedTransaction(value: unknown) {
  if (typeof value !== "string" || value.length < 100 || value.length > 16_000) {
    throw new ExecutionValidationError("The signed transaction is missing or malformed.");
  }
  try {
    const bytes = Buffer.from(value, "base64");
    if (bytes.length < 64 || bytes.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
      throw new Error("invalid base64");
    }
  } catch {
    throw new ExecutionValidationError("The signed transaction is not valid base64.");
  }
  return value;
}

export function validateRequestId(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 256 ||
    !/^[A-Za-z0-9._~:+/=-]+$/.test(value)
  ) {
    throw new ExecutionValidationError("The execution request has expired or is malformed.");
  }
  return value;
}

export function validateTransactionSignature(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 64 ||
    value.length > 88 ||
    !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)
  ) {
    throw new ExecutionValidationError("The Solana transaction signature is malformed.");
  }
  return value;
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeJupiterPriceImpact(payload: Record<string, unknown>) {
  const directPercent = finiteNumber(payload.priceImpact);
  if (directPercent !== null) return directPercent;
  const ratio = finiteNumber(payload.priceImpactPct);
  return ratio === null ? null : ratio * 100;
}
