import { MAINNET_USDC_MINT } from "@/lib/scarcity-exchange";
import {
  INITIAL_SCARCITY_METALS,
  METAL_MARKET_NAMESPACE_BY_ID,
  METAL_REFERENCE_MARKET_BY_ID,
  SCARCITY_METALS,
} from "@/lib/scarcity";
import { compileMarketDocuments } from "./compiler";
import type {
  ScarcityMarketRecord,
  ScarcityQuestionDocument,
  ScarcityRulesDocument,
} from "./types";

const thresholds: Record<string, number> = {
  gold: 62,
  silver: 72,
  copper: 70,
  uranium: 76,
  cobalt: 68,
  lithium: 60,
  platinum: 72,
  palladium: 58,
};

const sources = [{
  id: "hedgents-scarcity-index",
  publisher: "Hedgents",
  title: "Hedgents market-tightness calculation and source manifest",
  url: "https://hedgents.com/methodology/scarcity",
  cadence: "Published whenever all committed underlying observations pass validation",
  precedence: 1,
}];

function rules(): ScarcityRulesDocument {
  return {
    schemaVersion: "1.0.0",
    schedule: {
      opensAt: "2026-10-01T00:00:00.000Z",
      closesAt: "2026-12-30T23:59:59.000Z",
      resolveAfter: "2027-01-03T00:00:00.000Z",
    },
    network: "solana",
    collateral: {
      symbol: "USDC",
      decimals: 6,
      mint: String(MAINNET_USDC_MINT),
    },
    payout: { yes: 1, no: 1, invalid: 0.5 },
    resolution: {
      observationDelayHours: 72,
      sourceConflictPolicy: "Use the committed source manifest and methodology. If required observations remain unavailable after the delay, resolve invalid.",
      reportSchemaVersion: "1.0.0",
    },
  };
}

function referenceEventRules(): ScarcityRulesDocument {
  return {
    schemaVersion: "1.0.0",
    schedule: {
      opensAt: "2026-09-01T00:00:00.000Z",
      closesAt: "2027-03-30T23:59:59.000Z",
      resolveAfter: "2027-04-07T00:00:00.000Z",
    },
    network: "solana",
    collateral: {
      symbol: "USDC",
      decimals: 6,
      mint: String(MAINNET_USDC_MINT),
    },
    payout: { yes: 1, no: 1, invalid: 0.5 },
    resolution: {
      observationDelayHours: 168,
      sourceConflictPolicy: "Use the named primary authority and exact frozen question. If the authority does not conclusively establish YES or NO by the deadline, resolve invalid.",
      reportSchemaVersion: "1.0.0",
    },
  };
}

function questionFor(metal: (typeof INITIAL_SCARCITY_METALS)[number]): ScarcityQuestionDocument {
  const threshold = thresholds[metal.id];
  return {
    schemaVersion: "1.0.0",
    slug: `${metal.id}-tightness-${threshold}-2026`,
    title: `${metal.name} tightness above ${threshold} at year end`,
    question: `Will the verified Hedgents ${metal.name} market-tightness score be at least ${threshold.toFixed(2)} at 2026-12-31T23:59:59.000Z under methodology version 0.1.0?`,
    metal: { id: metal.id, symbol: metal.symbol, name: metal.name },
    observation: {
      metricId: "market-tightness",
      metricLabel: "Hedgents Market Tightness Score",
      methodologyVersion: "0.1.0",
      unit: "score-0-100",
      comparator: "greater-than-or-equal",
      threshold,
      observedAt: "2026-12-31T23:59:59.000Z",
      precision: 2,
    },
    sources,
    revisionPolicy: "Use the first final calculation published after the observation time. Later source revisions do not alter the outcome.",
    invalidConditions: [
      "The committed methodology cannot produce a score because its minimum coverage gate is not met by the resolution deadline.",
      "A committed primary artifact is withdrawn or cannot be independently verified.",
      "The calculation or evidence commitment is inconsistent with the published canonical documents.",
    ],
  };
}

const INITIAL_TIGHTNESS_MARKETS: readonly ScarcityMarketRecord[] = Object.freeze(
  INITIAL_SCARCITY_METALS.map((metal) => {
    const compiled = compileMarketDocuments(questionFor(metal), rules());
    return {
      ...compiled,
      lifecycle: "research" as const,
      publication: "illustrative" as const,
      warning: "Research specification only. No market is deployed, funded, quoted, or open for trading.",
      onchain: null,
    };
  }),
);

const initialMetalIds = new Set(INITIAL_SCARCITY_METALS.map((metal) => metal.id));

const REFERENCE_EVENT_MARKETS: readonly ScarcityMarketRecord[] = Object.freeze(
  SCARCITY_METALS
    .filter((metal) => !initialMetalIds.has(metal.id))
    .map((metal) => {
      const reference = METAL_REFERENCE_MARKET_BY_ID[metal.id];
      const namespace = METAL_MARKET_NAMESPACE_BY_ID[metal.id];
      if (!reference || !namespace) throw new Error(`Missing market reference for ${metal.name}.`);
      const question: ScarcityQuestionDocument = {
        schemaVersion: "1.0.0",
        kind: "event",
        slug: `${metal.id}-official-reference-2027`,
        title: `${metal.name} official reference outcome`,
        question: reference.binaryQuestion,
        metal: { id: metal.id, symbol: metal.symbol, name: metal.name },
        event: {
          eventLabel: reference.signalMetric,
          qualifyingOutcome: `The named primary authority conclusively reports the YES condition stated in the question by 2027-03-31T23:59:59.000Z.`,
          resolvesAt: "2027-03-31T23:59:59.000Z",
          resolverLabel: reference.source.name,
        },
        sources: [{
          id: reference.source.id,
          publisher: reference.source.operator,
          title: `${reference.referenceName} · ${reference.signalMetric}`,
          url: reference.source.url,
          cadence: reference.cadence,
          precedence: 1,
        }],
        revisionPolicy: "Use the first final primary-source record published for the committed observation window. Later revisions do not alter the result.",
        invalidConditions: [
          namespace.resolver.invalidWhen,
          "The primary source changes its definitions so the committed outcome is no longer comparable.",
          "The preserved source artifact cannot be independently reproduced from the committed authority.",
        ],
      };
      return {
        ...compileMarketDocuments(question, referenceEventRules()),
        lifecycle: "research" as const,
        publication: "verified" as const,
        warning: `Reviewed reference specification only; not deployed. ${reference.caveat}`,
        onchain: null,
      };
    }),
);

export const SCARCITY_MARKET_CATALOG: readonly ScarcityMarketRecord[] = Object.freeze([
  ...INITIAL_TIGHTNESS_MARKETS,
  ...REFERENCE_EVENT_MARKETS,
]);

export function getScarcityMarket(slug: string) {
  return SCARCITY_MARKET_CATALOG.find((market) => market.question.slug === slug) ?? null;
}

export function getScarcityMarketById(marketId: string) {
  return SCARCITY_MARKET_CATALOG.find((market) => market.marketId === marketId) ?? null;
}
