import { NextResponse } from "next/server";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { validateRecoveryAuthorization } from "@/lib/execution-authorization";
import { ExecutionValidationError, validateTransactionSignature } from "@/lib/execution-validation";
import { verifySolanaSettlement } from "@/lib/jupiter-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let responseHeaders: Record<string, string> = {};
  try {
    responseHeaders = secureMutation(request, { key: "execution-status", limit: 30, windowMs: 60_000 }).headers;
    const body = await readJsonBody(request, 8_192);
    const signature = validateTransactionSignature(body.signature);
    const claims = validateRecoveryAuthorization(body.recoveryAuthorization);
    const settlement = await verifySolanaSettlement(signature, claims, "finalized");
    return NextResponse.json(
      { signature, status: settlement.status === "verified" ? "Success" : settlement.status === "failed" ? "Failed" : "Pending", settlement },
      { headers: { ...responseHeaders, "cache-control": "no-store" } },
    );
  } catch (error) {
    const security = apiSecurityError(error);
    const status = security?.status ?? (error instanceof ExecutionValidationError ? error.status : 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Settlement recovery failed." },
      { status, headers: { ...responseHeaders, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
