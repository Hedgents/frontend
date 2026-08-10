import {
  METAL_PULSE_INTERVAL_SECONDS,
  pulseRoundId,
  pulseRoundStart,
  pulseRoundWindow,
  type MetalPulseRound,
} from "./metal-pulse";
import { fetchMetalPulseRound, type MetalPulsePythArtifact } from "./metal-pulse-source";
import { canonicalJson, sha256Hex } from "./scarcity-markets/canonical";

export interface MetalPulseReplayFetchResult {
  round: MetalPulseRound;
  artifacts: { opening: MetalPulsePythArtifact | null; closing: MetalPulsePythArtifact | null };
  providerState: "online" | "degraded";
  providerMessage?: string;
}

export interface MetalPulseReplayRound {
  roundId: string;
  startsAt: string;
  endsAt: string;
  outcome: "up" | "down" | "invalid";
  invalidReason: string | null;
  providerState: "online" | "degraded";
  providerMessage: string | null;
  openingPublishDelaySeconds: number | null;
  closingPublishDelaySeconds: number | null;
  moveBps: number | null;
  openingArtifactHash: string | null;
  closingArtifactHash: string | null;
  evidenceComplete: boolean;
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function delay(timestamp: string | undefined, targetUnix: number) {
  if (!timestamp) return null;
  const value = Date.parse(timestamp) / 1_000 - targetUnix;
  return Number.isFinite(value) ? value : null;
}

function replayRound(result: MetalPulseReplayFetchResult, startsAtUnix: number): MetalPulseReplayRound {
  const { endsAtUnix } = pulseRoundWindow(startsAtUnix);
  const opening = result.round.opening;
  const closing = result.round.closing;
  const moveBps = opening && closing && opening.priceUsd !== 0
    ? Math.round(((closing.priceUsd - opening.priceUsd) / opening.priceUsd) * 1_000_000) / 100
    : null;
  return {
    roundId: result.round.id,
    startsAt: result.round.startsAt,
    endsAt: result.round.endsAt,
    outcome: result.round.outcome ?? "invalid",
    invalidReason: result.round.invalidReason,
    providerState: result.providerState,
    providerMessage: result.providerMessage ?? null,
    openingPublishDelaySeconds: delay(opening?.publishedAt, startsAtUnix),
    closingPublishDelaySeconds: delay(closing?.publishedAt, endsAtUnix),
    moveBps,
    openingArtifactHash: result.artifacts.opening?.artifactHash ?? null,
    closingArtifactHash: result.artifacts.closing?.artifactHash ?? null,
    evidenceComplete: Boolean(result.artifacts.opening && result.artifacts.closing),
  };
}

function longestInvalidRun(rounds: MetalPulseReplayRound[]) {
  let longest = 0;
  let current = 0;
  for (const round of rounds) {
    current = round.outcome === "invalid" ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

export async function replayMetalPulseHistory(input: {
  fromStartUnix: number;
  roundCount: number;
  now: Date;
  concurrency?: number;
  fetchRound?: (input: { startsAtUnix: number; now: Date }) => Promise<MetalPulseReplayFetchResult>;
}) {
  if (pulseRoundStart(input.fromStartUnix) !== input.fromStartUnix) {
    throw new Error("Replay start must align to a 15-minute UTC boundary.");
  }
  if (!Number.isInteger(input.roundCount) || input.roundCount < 1 || input.roundCount > 96) {
    throw new Error("Replay must contain between one and 96 rounds.");
  }
  const concurrency = input.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("Replay concurrency must be between one and eight.");
  }
  const nowUnix = Math.floor(input.now.getTime() / 1_000);
  const finalEnd = input.fromStartUnix + input.roundCount * METAL_PULSE_INTERVAL_SECONDS;
  if (!Number.isFinite(nowUnix) || finalEnd > nowUnix) throw new Error("Replay range must contain only completed observation windows.");
  const fetchRound = input.fetchRound ?? ((request) => fetchMetalPulseRound(request));
  const rounds: MetalPulseReplayRound[] = [];
  for (let offset = 0; offset < input.roundCount; offset += concurrency) {
    const batch = Array.from({ length: Math.min(concurrency, input.roundCount - offset) }, (_, index) => {
      const startsAtUnix = input.fromStartUnix + (offset + index) * METAL_PULSE_INTERVAL_SECONDS;
      return fetchRound({ startsAtUnix, now: input.now })
        .then((result) => replayRound(result, startsAtUnix))
        .catch((error): MetalPulseReplayRound => ({
          roundId: pulseRoundId(startsAtUnix),
          startsAt: new Date(startsAtUnix * 1_000).toISOString(),
          endsAt: new Date((startsAtUnix + METAL_PULSE_INTERVAL_SECONDS) * 1_000).toISOString(),
          outcome: "invalid",
          invalidReason: "The source request failed during replay.",
          providerState: "degraded",
          providerMessage: error instanceof Error ? error.message : "Historical source request failed.",
          openingPublishDelaySeconds: null,
          closingPublishDelaySeconds: null,
          moveBps: null,
          openingArtifactHash: null,
          closingArtifactHash: null,
          evidenceComplete: false,
        }));
    });
    rounds.push(...await Promise.all(batch));
  }
  const delayValues = rounds.flatMap((round) => [round.openingPublishDelaySeconds, round.closingPublishDelaySeconds])
    .filter((value): value is number => value !== null);
  const moves = rounds.map((round) => round.moveBps).filter((value): value is number => value !== null);
  const invalidReasons = new Map<string, number>();
  for (const round of rounds) {
    if (round.outcome !== "invalid") continue;
    const reason = round.invalidReason ?? "Unspecified invalid outcome.";
    invalidReasons.set(reason, (invalidReasons.get(reason) ?? 0) + 1);
  }
  const summary = {
    totalRounds: rounds.length,
    resolvedRounds: rounds.filter((round) => round.outcome !== "invalid").length,
    invalidRounds: rounds.filter((round) => round.outcome === "invalid").length,
    upRounds: rounds.filter((round) => round.outcome === "up").length,
    downRounds: rounds.filter((round) => round.outcome === "down").length,
    degradedRounds: rounds.filter((round) => round.providerState === "degraded").length,
    evidenceCompleteRounds: rounds.filter((round) => round.evidenceComplete).length,
    longestInvalidRun: longestInvalidRun(rounds),
    p95PublishDelaySeconds: percentile(delayValues, 0.95),
    medianAbsoluteMoveBps: percentile(moves.map(Math.abs), 0.5),
    invalidReasons: [...invalidReasons.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([reason, count]) => ({ reason, count })),
  };
  const replayHash = sha256Hex(canonicalJson({
    schemaVersion: "1.0.0",
    template: "hedgents-metal-pulse-15-replay",
    fromStartUnix: input.fromStartUnix,
    roundCount: input.roundCount,
    rounds,
    summary,
  }));
  return {
    schemaVersion: "1.0.0" as const,
    mode: "historical-replay" as const,
    generatedAt: input.now.toISOString(),
    fromStartUnix: input.fromStartUnix,
    roundCount: input.roundCount,
    replayHash,
    summary,
    rounds,
    separation: "Historical source-quality and resolution analysis only. This replay is not a trading recommendation or evidence of future performance.",
  };
}
