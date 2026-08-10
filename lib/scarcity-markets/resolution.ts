import { getScarcityMarketById } from "./catalog";
import { compileResolutionReport } from "./compiler";
import type { ResolutionReport, ScarcityMarketRecord } from "./types";

export function compileVerifiedResolutionReport(report: ResolutionReport, suppliedMarket?: ScarcityMarketRecord) {
  const market = suppliedMarket ?? getScarcityMarketById(report.marketId);
  if (!market) throw new Error("Resolution report references an unknown market.");
  if (report.questionHash !== market.questionHash || report.rulesHash !== market.rulesHash) {
    throw new Error("Resolution report commitments do not match the canonical market.");
  }
  const generatedAt = Date.parse(report.generatedAt);
  if (generatedAt < Date.parse(market.rules.schedule.resolveAfter)) {
    throw new Error("Resolution report was generated before the committed resolution time.");
  }
  const sources = new Map(market.question.sources.map((source) => [source.id, source]));
  const primaryPrecedence = Math.min(...market.question.sources.map((source) => source.precedence));
  let includesPrimarySource = false;
  for (const observation of report.observations) {
    const source = sources.get(observation.sourceId);
    if (!source) throw new Error(`Resolution observation references uncommitted source ${observation.sourceId}.`);
    if (source.precedence === primaryPrecedence) includesPrimarySource = true;
    const observedAt = Date.parse(observation.observedAt);
    const publishedAt = Date.parse(observation.publishedAt);
    const retrievedAt = Date.parse(observation.retrievedAt);
    if (publishedAt > retrievedAt) throw new Error("Resolution evidence cannot be retrieved before it was published.");
    if (observedAt > retrievedAt) throw new Error("Resolution evidence cannot be retrieved before its observation time.");
    if (retrievedAt > generatedAt) throw new Error("Resolution evidence cannot be retrieved after the report was generated.");
  }
  if (report.outcome !== "invalid" && !includesPrimarySource) {
    throw new Error("A conclusive resolution requires evidence from the highest-precedence committed source.");
  }
  if (market.question.kind === "event") {
    const expectedEventOutcome = report.outcome === "yes"
      ? "occurred"
      : report.outcome === "no" ? "not-occurred" : "indeterminate";
    if (report.eventOutcome !== expectedEventOutcome) {
      throw new Error(`Event evidence implies ${expectedEventOutcome}, not ${report.eventOutcome ?? "an unspecified event outcome"}.`);
    }
    const deadline = Date.parse(market.question.event.resolvesAt);
    if (report.outcome === "yes" && !report.observations.some((observation) => (
      Date.parse(observation.observedAt) <= deadline && Date.parse(observation.publishedAt) <= deadline
    ))) {
      throw new Error("YES event evidence must show a committed-source publication no later than the event deadline.");
    }
  } else if (report.outcome !== "invalid") {
    const committedObservation = market.question.observation;
    if (report.observations.some((observation) => (
      observation.unit !== committedObservation.unit
      || observation.observedAt !== committedObservation.observedAt
    ))) {
      throw new Error("Data-market evidence must use the committed unit and observation timestamp.");
    }
    const value = report.evaluatedValue!;
    const precisionScale = 10 ** committedObservation.precision;
    const roundedValue = Math.round(value * precisionScale);
    if (!report.observations.some((observation) => (
      observation.value !== null && Math.round(observation.value * precisionScale) === roundedValue
    ))) {
      throw new Error("The evaluated value is not reproduced by the committed source observation.");
    }
    const yes = committedObservation.comparator === "greater-than-or-equal"
      ? value >= committedObservation.threshold
      : value <= committedObservation.threshold;
    const expected = yes ? "yes" : "no";
    if (report.outcome !== expected) {
      throw new Error(`Evaluated value implies ${expected.toUpperCase()}, not ${report.outcome.toUpperCase()}.`);
    }
  }
  return { market, ...compileResolutionReport(report, market.question) };
}
