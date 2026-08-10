import { canonicalJson, sha256Hex } from "./canonical";
import type {
  CompiledMarketDocuments,
  ResolutionReport,
  ScarcityQuestionDocument,
  ScarcityRulesDocument,
} from "./types";
import {
  validateQuestionDocument,
  validateResolutionReport,
  validateRulesDocument,
} from "./validation";

export function compileMarketDocuments(
  question: ScarcityQuestionDocument,
  rules: ScarcityRulesDocument,
): CompiledMarketDocuments {
  validateQuestionDocument(question);
  validateRulesDocument(rules);
  const outcomeTime = question.kind === "event"
    ? question.event.resolvesAt
    : question.observation.observedAt;
  if (Date.parse(outcomeTime) > Date.parse(rules.schedule.resolveAfter)) {
    throw new Error("The committed outcome time cannot fall after the earliest resolution time.");
  }

  const canonicalQuestion = canonicalJson(question);
  const canonicalRules = canonicalJson(rules);
  const questionHash = sha256Hex(canonicalQuestion);
  const rulesHash = sha256Hex(canonicalRules);
  const marketId = sha256Hex(canonicalJson({
    schemaVersion: "1.0.0",
    slug: question.slug,
    questionHash,
    rulesHash,
  }));

  return {
    marketId,
    questionHash,
    rulesHash,
    canonicalQuestion,
    canonicalRules,
    question,
    rules,
  };
}

export function compileResolutionReport(report: ResolutionReport, question?: ScarcityQuestionDocument) {
  validateResolutionReport(report, question);
  return {
    canonicalReport: canonicalJson(report),
    resolutionReportHash: sha256Hex(canonicalJson(report)),
    report,
  };
}
