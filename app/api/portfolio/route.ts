import { NextResponse } from "next/server";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { requireInviteAccess } from "@/lib/access-auth";
import type { PortfolioSnapshot } from "@/lib/execution-types";
import { ExecutionValidationError, validateSolanaAddress } from "@/lib/execution-validation";
import { aggregatePortfolioBalances, type ParsedTokenAccount } from "@/lib/portfolio";
import { SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@/lib/product-registry";
import { solanaRpcRequest } from "@/lib/solana-rpc";

export const dynamic = "force-dynamic";

interface TokenAccountsResponse {
  error?: { message?: string };
  result?: {
    value?: Array<{
      account?: {
        data?: {
          parsed?: {
            info?: ParsedTokenAccount;
          };
        };
      };
    }>;
  };
}

async function readTokenAccounts(owner: string, programId: string) {
  try {
    const result = await solanaRpcRequest<NonNullable<TokenAccountsResponse["result"]>>(
      "getTokenAccountsByOwner",
      [owner, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }],
      { timeoutMs: 12_000, id: `hedgents-portfolio-${programId.slice(0, 6)}` },
    );
    return (result.value ?? [])
      .map((entry) => entry.account?.data?.parsed?.info)
      .filter((entry): entry is ParsedTokenAccount => Boolean(entry));
  } catch (error) {
    if (error instanceof ExecutionValidationError) throw error;
    throw new ExecutionValidationError(
      error instanceof Error ? `Solana portfolio indexing failed: ${error.message}` : "Solana portfolio indexing is temporarily unavailable.",
      502,
    );
  }
}

export async function GET(request: Request) {
  let responseHeaders: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    responseHeaders = enforceRateLimit(request, { key: "portfolio", limit: 40, windowMs: 60_000 }).headers;
    const owner = validateSolanaAddress(new URL(request.url).searchParams.get("owner"));
    const [classicAccounts, token2022Accounts] = await Promise.all([
      readTokenAccounts(owner, SPL_TOKEN_PROGRAM_ID),
      readTokenAccounts(owner, TOKEN_2022_PROGRAM_ID),
    ]);
    const payload: PortfolioSnapshot = {
      owner,
      checkedAt: new Date().toISOString(),
      balances: aggregatePortfolioBalances([...classicAccounts, ...token2022Accounts]),
    };
    return NextResponse.json(payload, { headers: { ...responseHeaders, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    const status = security?.status ?? (error instanceof ExecutionValidationError ? error.status : 500);
    const message = error instanceof Error ? error.message : "Portfolio indexing is unavailable.";
    return NextResponse.json(
      { error: message },
      { status, headers: { ...responseHeaders, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
