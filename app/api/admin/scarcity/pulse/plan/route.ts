import { address } from "@solana/kit";
import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/access-auth";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { buildMetalPulseMakerQuotePlan } from "@/lib/metal-pulse-maker";
import {
  planMetalPulseRounds,
  serializeMetalPulseInstruction,
} from "@/lib/metal-pulse-market";

export const dynamic = "force-dynamic";

function bigintString(value: unknown, label: string) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`${label} must be an unsigned integer string.`);
  return BigInt(value);
}

function serializeMakerPlan(plan: ReturnType<typeof buildMetalPulseMakerQuotePlan>) {
  return {
    ...plan,
    allocationMicroUsdc: String(plan.allocationMicroUsdc),
    completeSetQuantity: String(plan.completeSetQuantity),
    maximumOneSidedLossMicroUsdc: String(plan.maximumOneSidedLossMicroUsdc),
    bothFilledGrossEdgeMicroUsdc: String(plan.bothFilledGrossEdgeMicroUsdc),
    yesAsk: {
      ...plan.yesAsk,
      priceMicroUsdc: String(plan.yesAsk.priceMicroUsdc),
      quantity: String(plan.yesAsk.quantity),
    },
    noAsk: {
      ...plan.noAsk,
      priceMicroUsdc: String(plan.noAsk.priceMicroUsdc),
      quantity: String(plan.noAsk.quantity),
    },
  };
}

export async function POST(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireAdminAccess(request);
    headers = secureMutation(request, {
      key: "scarcity-pulse-plan",
      limit: 30,
      windowMs: 3_600_000,
    }, 64_000).headers;
    const body = await readJsonBody(request, 64_000);
    const now = body.now === undefined ? new Date() : new Date(String(body.now));
    if (!Number.isFinite(now.getTime())) throw new Error("Planner time is invalid.");
    const admin = address(String(body.admin));
    const collateralMint = address(String(body.collateralMint));
    const existingMarketIds = Array.isArray(body.existingMarketIds)
      ? new Set(body.existingMarketIds.map((value) => String(value)))
      : new Set<string>();
    for (const marketId of existingMarketIds) {
      if (!/^[a-f0-9]{64}$/.test(marketId)) throw new Error("Existing market IDs must be canonical 32-byte hex strings.");
    }
    const sourceLatestPublishedAt = body.sourceLatestPublishedAt === null || body.sourceLatestPublishedAt === undefined
      ? null
      : String(body.sourceLatestPublishedAt);
    const planned = await planMetalPulseRounds({
      now,
      admin,
      collateralMint,
      sourceLatestPublishedAt,
      existingMarketIds,
      horizonRounds: body.horizonRounds === undefined ? undefined : Number(body.horizonRounds),
    });
    const availableCapital = bigintString(body.makerCapitalMicroUsdc ?? "1000000000", "Maker capital");
    const maxRoundAllocation = bigintString(body.makerMaxRoundAllocationMicroUsdc ?? "100000000", "Maker round allocation");
    const plans = planned.plans.map((plan) => {
      const maker = buildMetalPulseMakerQuotePlan({
        marketId: plan.market.marketId,
        availableCapitalMicroUsdc: availableCapital,
        maxRoundAllocationMicroUsdc: maxRoundAllocation,
      });
      return {
        action: plan.action,
        reason: plan.reason,
        market: {
          ...plan.market,
          onchainSchedule: {
            opensAt: String(plan.market.onchainSchedule.opensAt),
            closesAt: String(plan.market.onchainSchedule.closesAt),
            resolveAfter: String(plan.market.onchainSchedule.resolveAfter),
          },
        },
        addresses: plan.addresses,
        createInstruction: serializeMetalPulseInstruction(plan.createInstruction),
        maker: serializeMakerPlan(maker),
      };
    });
    return NextResponse.json({
      ...planned,
      plans,
      submitted: false,
      persisted: false,
      warning: "Preparation only. No transaction is signed, submitted, or funded, and source health is advisory until independently fetched by the operator.",
    }, { headers: { ...headers, "cache-control": "private, no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? (error instanceof Error ? error.message : "Metal Pulse planning failed.") },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
