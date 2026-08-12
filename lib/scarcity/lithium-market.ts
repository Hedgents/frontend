/**
 * Canonical documents and commitments for a lithium tightness curve round.
 *
 * A round commits to the LITHIUM_TIGHTNESS_VERSION methodology, not to the general scarcity
 * methodology, because the shipped v1 index is its own calculation with its own frozen anchors.
 * Committing to the general version would name a methodology that cannot produce this number, which
 * is the defect the catalog already carries with its hardcoded "0.1.0".
 *
 * Everything hashed here is immutable after `create_curve_market`, so the anchors, the liquidity
 * gates, the trailing-median window and the settlement calendar all have to be right first.
 */
import type { CompiledCurveMarket, CurveMetricDocument, CurveRulesDocument } from "@/lib/scarcity-curves";
import { canonicalJson, sha256Hex } from "@/lib/scarcity-markets";
import { MAINNET_USDC_MINT } from "@/lib/scarcity-exchange";
import {
  CURVE_SLOPE_ANCHORS,
  LIQUIDITY_ENTRY,
  LIQUIDITY_EXIT,
  LITHIUM_TIGHTNESS_VERSION,
  TRAILING_MEDIAN_DAYS,
} from "./lithium-tightness";

/** Minimum tenor. Below twenty trading days the settling bucket is materially forecastable from a
 * free public endpoint, which is a race to the deadline rather than a market. */
export const MINIMUM_TENOR_TRADING_DAYS = 20;

export interface LithiumRoundWindow {
  /** Round label, e.g. "2026-09". */
  round: string;
  /** ISO instant the round opens for staking. */
  opensAt: string;
  /** ISO instant staking locks. Must precede the observation window entirely. */
  closesAt: string;
  /** ISO instant of the final observation the score is taken from. */
  observedAt: string;
  /** ISO instant the resolver may publish. After the correction window closes. */
  resolveAfter: string;
}

/**
 * The lithium metric document carries the whole calculation, which the general curve document does
 * not, so it is a strict extension of `CurveMetricDocument`. Staying assignable matters: it lets a
 * lithium round flow through the existing curve resolver, API and UI rather than needing a parallel
 * stack, and any drift in the shared shape becomes a compile error here.
 */
export type LithiumMetricDocument = CurveMetricDocument & {
  calculation: {
    parameter: string;
    formula: string;
    trailingMedianTradingDays: number;
    contractSelection: {
      rule: string;
      entry: { openInterest: number; volume: number };
      exit: { openInterest: number; volume: number };
    };
    anchors: Array<{ value: number; score: number }>;
    anchorInterpolation: string;
  };
};

/**
 * The rules document likewise extends the shared one. The additions are the two promises a
 * parimutuel cannot make after the fact: that stake locks before the observation window opens, and
 * that the settled value is never restated for later upstream revisions.
 */
export type LithiumRulesDocument = Omit<CurveRulesDocument, "schedule" | "resolution"> & {
  schedule: CurveRulesDocument["schedule"] & {
    stakeLocksBeforeObservationWindow: true;
    minimumTenorTradingDays: number;
  };
  resolution: CurveRulesDocument["resolution"] & {
    correctionWindowHours: number;
    correctionCauses: string[];
    restatementPolicy: string;
  };
};

export interface CompiledLithiumRound extends Omit<CompiledCurveMarket, "metric" | "rules"> {
  metric: LithiumMetricDocument;
  rules: LithiumRulesDocument;
}

/** A lithium round slug the curve resolver should recognise. */
export function isLithiumRoundSlug(slug: string) {
  return /^lithium-tightness-\d{4}-\d{2}-curve-v1$/.test(slug);
}

export function compileLithiumRound(window: LithiumRoundWindow): CompiledLithiumRound {
  const slug = `lithium-tightness-${window.round}-curve-v1`;

  const metric: LithiumMetricDocument = {
    schemaVersion: "1.0.0",
    kind: "scalar-curve",
    slug,
    title: "Lithium carbonate market tightness curve",
    metal: { id: "lithium", symbol: "Li", name: "Lithium" },
    metric: {
      id: "lithium-carbonate-tightness",
      label: "GFEX lithium carbonate curve tightness",
      methodologyVersion: LITHIUM_TIGHTNESS_VERSION,
      unit: "score-0-100",
      observedAt: window.observedAt,
      precision: 2,
    },
    displayRange: { minimum: 0, midpoint: 50, maximum: 100 },
    normalization: {
      minimum: -1_000_000,
      maximum: 1_000_000,
      formula: "round((((value - minimum) / (maximum - minimum)) * 2 - 1) * 1000000)",
      outOfRangePolicy: "invalid",
    },
    // The full calculation, committed. A third party holding this document and the free GFEX
    // endpoint recomputes the settling number exactly, with no history and no license.
    calculation: {
      parameter: "annualised front-to-third settlement slope",
      formula: "(S_front / S_third - 1) * (365 / (months_between * 30.4375))",
      trailingMedianTradingDays: TRAILING_MEDIAN_DAYS,
      contractSelection: {
        rule: "Nearest three delivery months clearing the liquidity gate, never returning to an "
          + "earlier delivery month once passed.",
        entry: LIQUIDITY_ENTRY,
        exit: LIQUIDITY_EXIT,
      },
      anchors: CURVE_SLOPE_ANCHORS.map(([value, score]) => ({ value, score })),
      anchorInterpolation: "piecewise-linear, clamped at both ends",
    },
    sources: [{
      id: "gfex-lithium-carbonate-daily-quotes",
      publisher: "Guangzhou Futures Exchange",
      title: "Lithium carbonate daily quotations",
      url: "http://www.gfex.com.cn/gfex/rihq/hqsj_tjsj.shtml",
      cadence: "Every trading day after the 15:00 CST close",
      precedence: 1,
    }],
    invalidConditions: [
      "Fewer than three delivery months clear the liquidity gate on a majority of the trailing "
        + "median window, so no slope can be computed.",
      "The exchange does not publish a daily quotation for the committed observation date.",
      "The final metric is outside the committed display range.",
      "The canonical source packet cannot reproduce the normalized integer outcome.",
    ],
  };

  const rules: LithiumRulesDocument = {
    schemaVersion: "1.0.0",
    network: "solana",
    schedule: {
      opensAt: window.opensAt,
      closesAt: window.closesAt,
      resolveAfter: window.resolveAfter,
      // Staking locks before the observation window opens. A round closing on the observation date
      // would spend its final week watching most of the trailing median already print, which is
      // arithmetic rather than forecasting and rewards whoever polls the exchange fastest.
      stakeLocksBeforeObservationWindow: true,
      minimumTenorTradingDays: MINIMUM_TENOR_TRADING_DAYS,
    },
    collateral: { symbol: "USDC", decimals: 6, mint: String(MAINNET_USDC_MINT) },
    engine: {
      bucketCount: 41,
      midpointTieBreak: "higher",
      kernelVersion: 1,
      kernel: "full-support-linear",
      targetJackpotBps: 2_000,
      jackpotLeverageCap: 10,
      invalidPayout: "one-for-one-refund",
    },
    resolution: {
      observationDelayHours: 48,
      correctionWindowHours: 48,
      correctionCauses: [
        "the source file was corrected at origin",
        "an arithmetic error in the published calculation",
        "the methodology was misapplied",
        "the wrong source vintage was ingested",
      ],
      // A parimutuel pool that has paid cannot be reopened, so a promise to follow later upstream
      // restatements is a promise that cannot be kept. Say so before anyone stakes.
      restatementPolicy: "The settlement value is final when the correction window closes and is "
        + "never restated for later upstream revisions. A separate research series absorbs those.",
      sourceConflictPolicy: "The committed GFEX daily quotation is the only settlement source. If it "
        + "is unavailable for the committed observation date, resolve invalid.",
      reportSchemaVersion: "1.0.0",
    },
  };

  const canonicalMetric = canonicalJson(metric);
  const canonicalRules = canonicalJson(rules);
  const metricHash = sha256Hex(canonicalMetric);
  const rulesHash = sha256Hex(canonicalRules);
  const marketId = sha256Hex(canonicalJson({ schemaVersion: "1.0.0", slug, metricHash, rulesHash }));
  return { slug, marketId, metricHash, rulesHash, canonicalMetric, canonicalRules, metric, rules };
}

/**
 * Declared rounds. A round's window is committed into its hashes, so it is declared here rather
 * than derived from the slug, and adding one is a deliberate act with a code review attached.
 *
 * Round cadence: staking locks twenty trading days after open, the five-trading-day observation
 * window runs after that with none of it visible at close, and resolution follows the correction
 * window.
 */
export const LITHIUM_ROUNDS: Readonly<Record<string, LithiumRoundWindow>> = Object.freeze({
  "2026-09": {
    round: "2026-09",
    opensAt: "2026-08-12T12:00:00.000Z",
    closesAt: "2026-09-10T07:00:00.000Z",
    observedAt: "2026-09-17T07:00:00.000Z",
    resolveAfter: "2026-09-21T07:00:00.000Z",
  },
});

export function lithiumRoundWindow(slug: string): LithiumRoundWindow | null {
  if (!isLithiumRoundSlug(slug)) return null;
  const round = slug.slice("lithium-tightness-".length, -"-curve-v1".length);
  return LITHIUM_ROUNDS[round] ?? null;
}
