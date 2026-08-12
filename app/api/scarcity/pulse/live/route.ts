import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { METAL_PULSE_INTERVAL_SECONDS, pulseRoundStart } from "@/lib/metal-pulse";
import { fetchMetalPulseSnapshot } from "@/lib/metal-pulse-source";
import { deriveMetalPulseRound } from "@/lib/metal-pulse-chain";
import { loadScarcityDeployment } from "@/lib/scarcity-deployment";
import { getScarcityMarketChainState } from "@/lib/scarcity-exchange-index";

export const dynamic = "force-dynamic";

/**
 * Everything the Gold 15 screen needs in one call: which round is tradeable, whether it exists on
 * chain, what is currently offered, and the live price against the round's opening price.
 *
 * The opening price is the whole bet, so it is returned explicitly rather than left for the client
 * to infer from a series it may have joined late.
 */
export async function GET(request: Request) {
  let headers: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    headers = enforceRateLimit(request, { key: "pulse-live", limit: 240, windowMs: 60_000 }).headers;

    const nowUnix = Math.floor(Date.now() / 1_000);
    const currentStart = pulseRoundStart(nowUnix);
    const deployment = await loadScarcityDeployment();
    const snapshot = await fetchMetalPulseSnapshot({ apiKey: process.env.PYTH_API_KEY });

    // The round now in its observation window, and the one currently open for trading.
    const running = deployment
      ? await deriveMetalPulseRound({ startsAtUnix: currentStart, collateralMint: deployment.collateralMint })
      : null;
    const tradeable = deployment
      ? await deriveMetalPulseRound({
        startsAtUnix: currentStart + METAL_PULSE_INTERVAL_SECONDS,
        collateralMint: deployment.collateralMint,
      })
      : null;

    const chainFor = async (slug: string | null) =>
      slug ? await getScarcityMarketChainState(slug).catch(() => null) : null;

    return NextResponse.json({
      cluster: deployment?.cluster ?? null,
      nowUnix,
      intervalSeconds: METAL_PULSE_INTERVAL_SECONDS,
      price: {
        // The bet is the close against the open, so both are returned explicitly rather than left
        // for a client that may have joined the round late to infer from its own series.
        latest: snapshot.current.latest,
        opening: snapshot.current.opening,
        roundStatus: snapshot.current.status,
        providerState: snapshot.providerState,
        refreshAfterMs: snapshot.refreshAfterMs,
        mode: snapshot.mode,
      },
      running: running ? { ...running, chain: await chainFor(`metal-pulse-${running.roundId}`) } : null,
      tradeable: tradeable ? { ...tradeable, chain: await chainFor(`metal-pulse-${tradeable.roundId}`) } : null,
    }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "The Gold 15 round is unavailable." },
      { status: security?.status ?? 503, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
