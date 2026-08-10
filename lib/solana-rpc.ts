import "server-only";
import { readBoundedUpstreamJson } from "@/lib/safe-upstream-response";

const PUBLIC_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

interface RpcEnvelope<T> {
  result?: T;
  error?: { code?: number; message?: string };
}

export class SolanaRpcError extends Error {
  constructor(message: string, public readonly retryable = true) {
    super(message);
    this.name = "SolanaRpcError";
  }
}

export function serverSolanaRpcUrls() {
  const legacyClusterMatches = process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet";
  const configured = [
    ...(process.env.HEDGENTS_SOLANA_MAINNET_RPC_URLS ?? "").split(","),
    process.env.HEDGENTS_SOLANA_MAINNET_RPC_URL ?? "",
    legacyClusterMatches ? process.env.HEDGENTS_SOLANA_RPC_URL ?? "" : "",
    legacyClusterMatches ? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "" : "",
    PUBLIC_MAINNET_RPC,
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(configured)];
}

export async function solanaRpcRequest<T>(
  method: string,
  params: unknown[],
  options: { timeoutMs?: number; id?: string } = {},
): Promise<T> {
  return solanaRpcRequestFrom(serverSolanaRpcUrls(), method, params, options);
}

export async function solanaRpcRequestFrom<T>(
  endpoints: string[],
  method: string,
  params: unknown[],
  options: { timeoutMs?: number; id?: string } = {},
): Promise<T> {
  if (!endpoints.length) throw new SolanaRpcError("No Solana RPC endpoint is configured.", false);
  let lastError = "Solana RPC is unavailable.";

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: options.id ?? `hedgents-${method}`,
          method,
          params,
        }),
      });
      if (!response.ok) {
        lastError = `Solana RPC returned ${response.status}.`;
        if (response.status === 429 || response.status >= 500) continue;
        throw new SolanaRpcError(lastError, false);
      }
      const payload = await readBoundedUpstreamJson<RpcEnvelope<T>>(response, 8_000_000, "Solana RPC");
      if (payload.error) {
        lastError = payload.error.message ?? `Solana RPC error ${payload.error.code ?? "unknown"}.`;
        if (payload.error.code === -32004 || payload.error.code === -32005) continue;
        throw new SolanaRpcError(lastError, false);
      }
      if (!("result" in payload)) {
        lastError = "Solana RPC returned no result.";
        continue;
      }
      return payload.result as T;
    } catch (error) {
      if (error instanceof SolanaRpcError && !error.retryable) throw error;
      lastError = error instanceof Error && error.name === "AbortError"
        ? "Solana RPC timed out."
        : error instanceof Error ? error.message : lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new SolanaRpcError(lastError);
}
