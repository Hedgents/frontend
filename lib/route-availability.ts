export type RouteAvailabilityReason =
  | "available"
  | "operator-disabled"
  | "configuration-required"
  | "market-closed"
  | "settlement-restricted"
  | "insufficient-liquidity"
  | "transfer-restricted"
  | "provider-unavailable";

export function classifyRouteAvailability(error: unknown): RouteAvailabilityReason {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (message.includes("not enabled for closed-beta execution")) {
    return "operator-disabled";
  }
  if (message.includes("not configured") || message.includes("api key")) {
    return "configuration-required";
  }
  if (message.includes("only usdc") || message.includes("available for swapping with ondo")) {
    return "settlement-restricted";
  }
  if (
    message.includes("market maker") ||
    message.includes("market closed") ||
    message.includes("outside market") ||
    message.includes("trading session")
  ) {
    return "market-closed";
  }
  if (message.includes("transfer") || message.includes("frozen") || message.includes("restricted")) {
    return "transfer-restricted";
  }
  if (
    message.includes("no route") ||
    message.includes("no executable") ||
    message.includes("could not find any route") ||
    message.includes("insufficient liquidity")
  ) {
    return "insufficient-liquidity";
  }
  return "provider-unavailable";
}

export function routeAvailabilityLabel(reason: RouteAvailabilityReason) {
  switch (reason) {
    case "available": return "Live route";
    case "operator-disabled": return "Not enabled in beta";
    case "configuration-required": return "Execution not configured";
    case "market-closed": return "Market maker offline";
    case "settlement-restricted": return "USDC-only exit";
    case "insufficient-liquidity": return "No liquidity at this size";
    case "transfer-restricted": return "Transfer restricted";
    default: return "Venue unavailable";
  }
}
