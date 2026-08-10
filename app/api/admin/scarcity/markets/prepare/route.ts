import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/access-auth";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { deriveMarketAddresses } from "@/lib/scarcity-exchange/addresses";
import {
  compileMarketDocuments,
  hexToBytes,
  type ScarcityQuestionDocument,
  type ScarcityRulesDocument,
} from "@/lib/scarcity-markets";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = secureMutation(request, {
      key: "scarcity-market-prepare",
      limit: 30,
      windowMs: 3_600_000,
    }, 64_000).headers;
    const body = await readJsonBody(request, 64_000);
    const compiled = compileMarketDocuments(
      body.question as unknown as ScarcityQuestionDocument,
      body.rules as unknown as ScarcityRulesDocument,
    );
    const addresses = await deriveMarketAddresses(hexToBytes(compiled.marketId));

    return NextResponse.json({
      prepared: true,
      persisted: false,
      submitted: false,
      warning: "This validates and hashes the specification only. It does not persist data or submit an onchain transaction.",
      ...compiled,
      addresses,
    }, { status: 200, headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Market preparation failed.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
