import { SCARCITY_METRIC_BY_ID } from "./methodology";
import { SCARCITY_METAL_BY_ID } from "./registry";
import type { ScarcityObservation, ScarcitySource } from "./types";

export class ScarcityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScarcityValidationError";
  }
}

function validIsoTimestamp(value: string) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function validHash(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}

export function validateScarcitySource(source: ScarcitySource) {
  if (!source.id.trim() || source.id.length > 128) throw new ScarcityValidationError("Source id is required and must not exceed 128 characters.");
  if (!source.name.trim() || source.name.length > 256) throw new ScarcityValidationError(`Source ${source.id} requires a bounded name.`);
  if (source.url) {
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:" || url.username || url.password || source.url.length > 2_048) throw new Error();
    } catch {
      throw new ScarcityValidationError(`Source ${source.id} must use a credential-free HTTPS URL.`);
    }
  }
  if (source.updateCadenceDays !== undefined && (!Number.isFinite(source.updateCadenceDays) || source.updateCadenceDays <= 0)) {
    throw new ScarcityValidationError(`Source ${source.id} has an invalid update cadence.`);
  }
  if (source.nextExpectedAt && !validIsoTimestamp(source.nextExpectedAt)) {
    throw new ScarcityValidationError(`Source ${source.id} has an invalid next expected timestamp.`);
  }
  if (source.rightsReviewedAt && !validIsoTimestamp(source.rightsReviewedAt)) {
    throw new ScarcityValidationError(`Source ${source.id} has an invalid rights review timestamp.`);
  }
  if ((source.operator?.length ?? 0) > 256 || (source.notes?.length ?? 0) > 4_000) {
    throw new ScarcityValidationError(`Source ${source.id} metadata exceeds its size bound.`);
  }
  return source;
}

export function validateScarcityObservation(observation: ScarcityObservation) {
  if (!observation.id.trim() || observation.id.length > 256) throw new ScarcityValidationError("Observation id is required and must not exceed 256 characters.");
  if (!observation.datasetId.trim()) {
    throw new ScarcityValidationError(`Observation ${observation.id} requires a dataset id.`);
  }
  if (!SCARCITY_METAL_BY_ID[observation.metalId]) {
    throw new ScarcityValidationError(`Observation ${observation.id} references an unknown metal.`);
  }
  const metric = SCARCITY_METRIC_BY_ID[observation.metricId];
  if (!metric) {
    throw new ScarcityValidationError(`Observation ${observation.id} references an unknown metric.`);
  }
  if (observation.unit !== metric.unit) {
    throw new ScarcityValidationError(
      `Observation ${observation.id} must use ${metric.unit} for ${metric.id}.`,
    );
  }
  if (!Number.isFinite(observation.value)) {
    throw new ScarcityValidationError(`Observation ${observation.id} must contain a finite value.`);
  }
  if (!validIsoTimestamp(observation.observedAt) || !validIsoTimestamp(observation.publishedAt)) {
    throw new ScarcityValidationError(`Observation ${observation.id} has an invalid timestamp.`);
  }
  if (Date.parse(observation.publishedAt) < Date.parse(observation.observedAt)) {
    throw new ScarcityValidationError(
      `Observation ${observation.id} cannot be published before it is observed.`,
    );
  }
  if (observation.retrievedAt && !validIsoTimestamp(observation.retrievedAt)) {
    throw new ScarcityValidationError(`Observation ${observation.id} has an invalid retrieval timestamp.`);
  }
  if (observation.retrievedAt && Date.parse(observation.retrievedAt) < Date.parse(observation.publishedAt)) {
    throw new ScarcityValidationError(`Observation ${observation.id} cannot be retrieved before publication.`);
  }
  if (observation.artifactHash && !validHash(observation.artifactHash)) {
    throw new ScarcityValidationError(`Observation ${observation.id} has an invalid artifact hash.`);
  }
  if (observation.artifactPath && !observation.artifactPath.startsWith("/api/scarcity/artifacts/")) {
    throw new ScarcityValidationError(`Observation ${observation.id} has an invalid artifact path.`);
  }
  if (observation.artifactContentType !== undefined && !observation.artifactContentType.trim()) {
    throw new ScarcityValidationError(`Observation ${observation.id} has an invalid artifact content type.`);
  }
  if (observation.revisionOf !== undefined && !observation.revisionOf.trim()) {
    throw new ScarcityValidationError(`Observation ${observation.id} has an invalid revision reference.`);
  }
  if (!observation.sourceId.trim()) {
    throw new ScarcityValidationError(`Observation ${observation.id} requires a source.`);
  }
  if (observation.sourceId.length > 128 || (observation.notes?.length ?? 0) > 4_000) {
    throw new ScarcityValidationError(`Observation ${observation.id} metadata exceeds its size bound.`);
  }
  if (observation.coverageRatio < 0 || observation.coverageRatio > 1) {
    throw new ScarcityValidationError(
      `Observation ${observation.id} coverage must be between zero and one.`,
    );
  }
  if (!Number.isInteger(observation.independentSourceCount) || observation.independentSourceCount < 1) {
    throw new ScarcityValidationError(
      `Observation ${observation.id} independent source count must be a positive integer.`,
    );
  }
  return observation;
}
