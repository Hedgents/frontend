export type ScarcityMarketLifecycle =
  | "research"
  | "scheduled"
  | "open"
  | "closed"
  | "resolving"
  | "resolved"
  | "invalid";

export type ThresholdComparator = "greater-than-or-equal" | "less-than-or-equal";

export interface MarketEvidenceSource {
  id: string;
  publisher: string;
  title: string;
  url: string;
  cadence: string;
  precedence: number;
}

interface ScarcityQuestionBase {
  schemaVersion: "1.0.0";
  slug: string;
  title: string;
  question: string;
  metal: {
    id: string;
    symbol: string;
    name: string;
  };
  sources: MarketEvidenceSource[];
  revisionPolicy: string;
  invalidConditions: string[];
}

export interface ScarcityDataQuestionDocument extends ScarcityQuestionBase {
  kind?: "data";
  observation: {
    metricId: string;
    metricLabel: string;
    methodologyVersion: string;
    unit: string;
    comparator: ThresholdComparator;
    threshold: number;
    observedAt: string;
    precision: number;
  };
}

export interface ScarcityEventQuestionDocument extends ScarcityQuestionBase {
  kind: "event";
  event: {
    eventLabel: string;
    qualifyingOutcome: string;
    resolvesAt: string;
    resolverLabel: string;
  };
}

export type ScarcityQuestionDocument =
  | ScarcityDataQuestionDocument
  | ScarcityEventQuestionDocument;

export interface ScarcityRulesDocument {
  schemaVersion: "1.0.0";
  schedule: {
    opensAt: string;
    closesAt: string;
    resolveAfter: string;
  };
  network: "solana";
  collateral: {
    symbol: "USDC";
    decimals: 6;
    mint: string;
  };
  payout: {
    yes: number;
    no: number;
    invalid: number;
  };
  resolution: {
    observationDelayHours: number;
    sourceConflictPolicy: string;
    reportSchemaVersion: "1.0.0";
  };
}

export interface CompiledMarketDocuments {
  marketId: string;
  questionHash: string;
  rulesHash: string;
  canonicalQuestion: string;
  canonicalRules: string;
  question: ScarcityQuestionDocument;
  rules: ScarcityRulesDocument;
}

export interface ScarcityMarketRecord extends CompiledMarketDocuments {
  lifecycle: ScarcityMarketLifecycle;
  publication: "illustrative" | "verified";
  warning: string | null;
  onchain: null | {
    cluster: "devnet" | "mainnet-beta";
    market: string;
    yesMint: string;
    noMint: string;
    vault: string;
    creationSignature: string;
  };
}

export interface ResolutionObservation {
  sourceId: string;
  value: number | null;
  unit: string;
  observedAt: string;
  publishedAt: string;
  retrievedAt: string;
  artifactHash: string;
  artifactUrl: string;
}

export interface ResolutionReport {
  schemaVersion: "1.0.0";
  marketId: string;
  questionHash: string;
  rulesHash: string;
  outcome: "yes" | "no" | "invalid";
  evaluatedValue: number | null;
  eventOutcome?: "occurred" | "not-occurred" | "indeterminate";
  evaluation: string;
  observations: ResolutionObservation[];
  generatedAt: string;
}
