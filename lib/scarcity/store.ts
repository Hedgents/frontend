import type {
  ObservationRepository,
  ScarcityMetricId,
  ScarcityObservation,
} from "./types";
import { validateScarcityObservation } from "./validation";

export class InMemoryObservationRepository implements ObservationRepository {
  private readonly observations = new Map<string, ScarcityObservation>();

  constructor(initial: ScarcityObservation[] = []) {
    this.upsert(initial);
  }

  upsert(observations: ScarcityObservation[]) {
    for (const observation of observations) {
      validateScarcityObservation(observation);
      this.observations.set(observation.id, Object.freeze({ ...observation }));
    }
  }

  list(options: {
    datasetId?: string;
    metalId?: string;
    metricId?: ScarcityMetricId;
    asOf?: string;
  } = {}) {
    const asOfTimestamp = options.asOf ? Date.parse(options.asOf) : Number.POSITIVE_INFINITY;
    return [...this.observations.values()]
      .filter((observation) => !options.datasetId || observation.datasetId === options.datasetId)
      .filter((observation) => !options.metalId || observation.metalId === options.metalId)
      .filter((observation) => !options.metricId || observation.metricId === options.metricId)
      .filter((observation) => Date.parse(observation.publishedAt) <= asOfTimestamp)
      .sort((left, right) => {
        const timeDifference = Date.parse(left.publishedAt) - Date.parse(right.publishedAt);
        return timeDifference || left.id.localeCompare(right.id);
      });
  }
}
