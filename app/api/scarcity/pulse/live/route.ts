import { NextResponse } from "next/server";
import { requireInviteAccess } from "@/lib/access-auth";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import {
  isMetalPulseMarketOpen,
  METAL_PULSE_INTERVAL_SECONDS,
  pulseRoundStart,
} from "@/lib/metal-pulse";
import { fetchMetalPulseSnapshot, fetchMetalPulseTrack } from "@/lib/metal-pulse-source";
import { deriveMetalPulseRound, readMetalPulseBook } from "@/lib/metal-pulse-chain";
import { loadScarcityDeployment } from "@/lib/scarcity-deployment";

export const dynamic = "force-dynamic";

/** The two fields the screen draws, and nothing else. */
function pricePoint(point: { priceUsd: number; publishedAt: string } | null | undefined) {
  return point ? { price: point.priceUsd, publishedAt: point.publishedAt } : null;
}

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

    // The tradeable round is the only one the screen can act on, so it is the only one whose book
    // is read. Rounds are derived from a timestamp and never appear in the deployment manifest, so
    // this reads the market and its orders straight from the addresses they derive to.
    const book = tradeable
      ? await readMetalPulseBook({ ...tradeable, nowUnix }).catch(() => null)
      : null;

    // The running round's price path, so the chart draws what happened rather than only what this
    // browser has polled since the tab opened.
    const track = await fetchMetalPulseTrack({
      startsAtUnix: currentStart,
      nowUnix,
      apiKey: process.env.PYTH_API_KEY,
    }).catch(() => []);

    return NextResponse.json({
      cluster: deployment?.cluster ?? null,
      nowUnix,
      intervalSeconds: METAL_PULSE_INTERVAL_SECONDS,
      price: {
        // The bet is the close against the open, so both are returned explicitly rather than left
        // for a client that may have joined the round late to infer from its own series.
        //
        // Narrowed to exactly what the screen draws. The snapshot's points carry raw mantissas and a
        // per-point evidence artifact, which is the right record for a resolution report and pure
        // weight on a poll that runs every five seconds. Naming the field `price` also matches what
        // the client reads: it was reading `price` off a point that only had `priceUsd`, so the
        // opening price arrived undefined and the chart never drew.
        latest: pricePoint(snapshot.current.latest),
        opening: pricePoint(snapshot.current.opening),
        roundStatus: snapshot.current.status,
        providerState: snapshot.providerState,
        refreshAfterMs: snapshot.refreshAfterMs,
        mode: snapshot.mode,
        // Provider health and market hours are different things. Hermes answers happily through the
        // 21:00 UTC break and the whole weekend, it just returns the same frozen price, and a round
        // inside that window ties and refunds. The publish time is the only thing that tells them
        // apart, so the screen gets it explicitly rather than inferring from a flat line.
        marketOpen: isMetalPulseMarketOpen({
          publishedAt: snapshot.current.latest?.publishedAt ?? null,
          nowUnix,
        }),
        lastPublishedAt: snapshot.current.latest?.publishedAt ?? null,
      },
      running: running ? { ...running, track } : null,
      tradeable: tradeable ? {
        ...tradeable,
        onChain: book?.onChain ?? false,
        paused: book?.paused ?? null,
        status: book?.status ?? null,
        // Everything the client needs to build a fill, so it never has to re-derive program accounts
        // or carry its own copy of the deployment.
        collateralMint: deployment?.collateralMint ?? null,
        feeRecipient: deployment?.feeRecipient ?? null,
        offers: book?.offers ?? { yes: null, no: null },
        bookUnavailable: book?.bookUnavailable ?? false,
      } : null,
    }, { headers: { ...headers, "cache-control": "no-store" } });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "The Gold 15 round is unavailable." },
      { status: security?.status ?? 503, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}
