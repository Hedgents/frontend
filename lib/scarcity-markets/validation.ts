import { address } from "@solana/kit";
import type {
  ResolutionReport,
  ScarcityQuestionDocument,
  ScarcityRulesDocument,
} from "./types";

function assertIso(value: string, label: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp.`);
  }
  return parsed;
}

export function validateQuestionDocument(question: ScarcityQuestionDocument) {
  if (question.schemaVersion !== "1.0.0") throw new Error("Unsupported question schema version.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(question.slug)) {
    throw new Error("Market slug must be lowercase kebab-case.");
  }
  if (question.title.length < 12 || question.title.length > 140) {
    throw new Error("Market title must contain 12 to 140 characters.");
  }
  if (!question.question.endsWith("?")) throw new Error("The market question must end with a question mark.");
  if (!question.metal.id || !question.metal.symbol || !question.metal.name) {
    throw new Error("The market must identify one metal.");
  }
  if (question.kind === "event") {
    if (!question.event.eventLabel.trim() || !question.event.qualifyingOutcome.trim() || !question.event.resolverLabel.trim()) {
      throw new Error("Event markets require a named event, YES criterion, and resolver.");
    }
    assertIso(question.event.resolvesAt, "Event deadline");
  } else {
    if (!question.observation.metricId || !question.observation.methodologyVersion) {
      throw new Error("The observation metric and methodology version are required.");
    }
    if (!Number.isFinite(question.observation.threshold)) throw new Error("Market threshold is invalid.");
    if (!Number.isInteger(question.observation.precision) || question.observation.precision < 0 || question.observation.precision > 8) {
      throw new Error("Observation precision must be an integer from zero through eight.");
    }
    assertIso(question.observation.observedAt, "Observation time");
  }
  if (question.sources.length === 0) throw new Error("At least one evidence source is required.");
  const sourceIds = new Set<string>();
  const precedences = new Set<number>();
  for (const source of question.sources) {
    if (!source.id || sourceIds.has(source.id)) throw new Error("Evidence source IDs must be unique.");
    if (!Number.isInteger(source.precedence) || source.precedence < 1 || precedences.has(source.precedence)) {
      throw new Error("Evidence source precedence must be unique positive integers.");
    }
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("Evidence source URLs must be credential-free HTTPS URLs.");
    }
    sourceIds.add(source.id);
    precedences.add(source.precedence);
  }
  if (question.invalidConditions.length === 0) {
    throw new Error("The question must define invalid-market conditions.");
  }
}

export function validateRulesDocument(rules: ScarcityRulesDocument) {
  if (rules.schemaVersion !== "1.0.0") throw new Error("Unsupported rules schema version.");
  const opensAt = assertIso(rules.schedule.opensAt, "Open time");
  const closesAt = assertIso(rules.schedule.closesAt, "Close time");
  const resolveAfter = assertIso(rules.schedule.resolveAfter, "Resolution time");
  if (!(opensAt < closesAt && closesAt <= resolveAfter)) throw new Error("Market schedule is invalid.");
  if (rules.network !== "solana") throw new Error("Version one markets settle on Solana only.");
  if (rules.collateral.symbol !== "USDC" || rules.collateral.decimals !== 6) {
    throw new Error("Version one markets require six-decimal USDC collateral.");
  }
  address(rules.collateral.mint);
  if (rules.payout.yes !== 1 || rules.payout.no !== 1 || rules.payout.invalid !== 0.5) {
    throw new Error("Payout rules do not match the version-one settlement program.");
  }
  if (!Number.isInteger(rules.resolution.observationDelayHours) || rules.resolution.observationDelayHours < 0) {
    throw new Error("Observation delay must be a non-negative whole number of hours.");
  }
}

export function validateResolutionReport(report: ResolutionReport, question?: ScarcityQuestionDocument) {
  if (report.schemaVersion !== "1.0.0") throw new Error("Unsupported resolution report version.");
  if (report.outcome !== "yes" && report.outcome !== "no" && report.outcome !== "invalid") {
    throw new Error("Resolution outcome is invalid.");
  }
  for (const hash of [report.marketId, report.questionHash, report.rulesHash]) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Resolution report contains an invalid commitment.");
  }
  assertIso(report.generatedAt, "Report generation time");
  if (question?.kind === "event") {
    if (report.evaluatedValue !== null) throw new Error("Event outcomes cannot contain a numerical evaluated value.");
    const expectedEventOutcome = report.outcome === "yes"
      ? "occurred"
      : report.outcome === "no" ? "not-occurred" : "indeterminate";
    if (report.eventOutcome !== expectedEventOutcome) {
      throw new Error(`Event resolution must declare ${expectedEventOutcome} for a ${report.outcome.toUpperCase()} outcome.`);
    }
  } else if (report.outcome === "invalid") {
    if (report.evaluatedValue !== null) throw new Error("Invalid outcomes cannot contain an evaluated value.");
  } else if (report.evaluatedValue === null || !Number.isFinite(report.evaluatedValue)) {
    throw new Error("YES and NO outcomes require a finite evaluated value.");
  }
  if (typeof report.evaluation !== "string" || report.evaluation.length < 20 || report.evaluation.length > 4_000) {
    throw new Error("Resolution evaluation must contain 20 to 4,000 characters.");
  }
  if (report.observations.length === 0 || report.observations.length > 32) {
    throw new Error("A resolution report requires between one and 32 source observations.");
  }
  for (const observation of report.observations) {
    if (
      typeof observation.sourceId !== "string" || observation.sourceId.length < 1 || observation.sourceId.length > 128
      || typeof observation.unit !== "string" || observation.unit.length < 1 || observation.unit.length > 64
      || (observation.value !== null && !Number.isFinite(observation.value))
    ) {
      throw new Error("Resolution observation source, unit, and a finite or null value are required.");
    }
    if (!/^[a-f0-9]{64}$/.test(observation.artifactHash)) {
      throw new Error("Observation artifact hash is invalid.");
    }
    assertIso(observation.observedAt, "Observation time");
    assertIso(observation.publishedAt, "Publication time");
    assertIso(observation.retrievedAt, "Retrieval time");
    const artifactUrl = new URL(observation.artifactUrl);
    if (artifactUrl.protocol !== "https:" || artifactUrl.username || artifactUrl.password) {
      throw new Error("Resolution artifact URLs must be credential-free HTTPS URLs.");
    }
  }
}
