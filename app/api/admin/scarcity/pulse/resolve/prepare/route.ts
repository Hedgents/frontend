import { address } from "@solana/kit";
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/access-auth";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { fetchMetalPulseRound } from "@/lib/metal-pulse-source";
import {
  buildMetalPulseResolutionPacket,
  compileMetalPulseMarket,
  serializeMetalPulseInstruction,
} from "@/lib/metal-pulse-market";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = secureMutation(request, {
      key: "scarcity-pulse-resolution-prepare",
      limit: 30,
      windowMs: 3_600_000,
    }, 32_000).headers;
    const body = await readJsonBody(request, 32_000);
    const startsAtUnix = Number(body.startsAtUnix);
    if (!Number.isSafeInteger(startsAtUnix)) throw new Error("Round start must be a safe integer Unix timestamp.");
    const resolver = address(String(body.resolver));
    const collateralMint = address(String(body.collateralMint));
    const generatedAtInput = body.generatedAt === undefined ? new Date() : new Date(String(body.generatedAt));
    if (!Number.isFinite(generatedAtInput.getTime())) throw new Error("Resolution generation time is invalid.");
    const generatedAt = new Date(Math.floor(generatedAtInput.getTime() / 1_000) * 1_000);

    const market = compileMetalPulseMarket({ startsAtUnix, collateralMint });
    const fetched = await fetchMetalPulseRound({ startsAtUnix, now: generatedAt });
    const prepared = await buildMetalPulseResolutionPacket({
      market,
      resolver,
      opening: fetched.round.opening,
      closing: fetched.round.closing,
      generatedAt: generatedAt.toISOString(),
    });
    return NextResponse.json({
      prepared: true,
      persisted: false,
      submitted: false,
      providerState: fetched.providerState,
      providerMessage: fetched.providerMessage,
      report: prepared.report,
      canonicalReport: prepared.canonicalReport,
      resolutionReportHash: prepared.resolutionReportHash,
      resolveInstruction: serializeMetalPulseInstruction(prepared.resolveInstruction),
      warning: "Preparation only. Persist and independently review the canonical report before the configured resolver signs this instruction.",
    }, { headers: { ...headers, "cache-control": "private, no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Metal Pulse resolution preparation failed.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
