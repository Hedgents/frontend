export interface ActionableExecutionError {
  code: string;
  message: string;
  action: string;
  retryable: boolean;
}

/**
 * Get a human-readable message out of anything that was thrown or returned.
 *
 * `String(value)` on a plain object yields "[object Object]", which is how a real failure reached
 * someone mid-checkout as no information at all. Wallets and venues both return structured errors,
 * so the shape has to be interrogated rather than assumed: an Error has `message`, Jupiter nests
 * `error`, wallets often carry `code` alongside `message`, and anything else is worth serialising
 * verbatim rather than discarding.
 */
export function executionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    for (const key of ["message", "error", "reason", "description"]) {
      const value = candidate[key];
      if (typeof value === "string" && value) {
        const code = candidate.code;
        return typeof code === "number" || typeof code === "string" ? `${value} (${code})` : value;
      }
      // Jupiter nests its failure under `error`, sometimes as another object.
      if (value && typeof value === "object") {
        const nested = executionErrorMessage(value);
        if (nested && nested !== FALLBACK) return nested;
      }
    }
    try {
      const serialised = JSON.stringify(error);
      if (serialised && serialised !== "{}") return serialised.slice(0, 400);
    } catch {
      // Circular or otherwise unserialisable; fall through to the generic message.
    }
  }
  return FALLBACK;
}

const FALLBACK = "Execution did not complete.";

export function actionableExecutionError(error: unknown): ActionableExecutionError {
  const raw = executionErrorMessage(error);
  const value = raw.toLowerCase();
  if (value.includes("reject") || value.includes("declin") || value.includes("cancel")) {
    return { code: "wallet_rejected", message: raw, action: "No transaction was sent. Build a fresh quote when ready.", retryable: true };
  }
  if (value.includes("insufficient") || value.includes("balance")) {
    return { code: "insufficient_balance", message: raw, action: "Add enough USDC and SOL for the swap and network fee, then quote again.", retryable: true };
  }
  if (value.includes("expired") || value.includes("block height") || value.includes("blockhash")) {
    return { code: "quote_expired", message: raw, action: "Prices moved or the block window closed. Build a fresh executable quote.", retryable: true };
  }
  if (value.includes("simulation")) {
    return { code: "simulation_failed", message: raw, action: "The transaction was stopped before signing. Try a smaller size or another live product.", retryable: true };
  }
  if (value.includes("route") || value.includes("liquidity") || value.includes("price impact")) {
    return { code: "route_unavailable", message: raw, action: "Try a smaller size or choose another product marked live at this size.", retryable: true };
  }
  if (value.includes("timeout") || value.includes("temporarily") || value.includes("unavailable")) {
    return { code: "service_unavailable", message: raw, action: "Check the explorer before retrying if a signature was shown; otherwise quote again.", retryable: true };
  }
  return { code: "execution_failed", message: raw, action: "No automatic retry was made. Review the details and build a fresh quote.", retryable: false };
}

export function amountBucket(amount: number) {
  if (amount < 100) return "lt_100";
  if (amount < 500) return "100_499";
  if (amount < 2_500) return "500_2499";
  if (amount < 10_000) return "2500_9999";
  return "gte_10000";
}
