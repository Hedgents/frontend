import { calculateScarcitySnapshot } from "./engine";
import { SCARCITY_METALS, getScarcityMetal } from "./registry";
import { EMPTY_SCARCITY_DATASET, SAMPLE_SCARCITY_DATASET } from "./sample-data";
import type { MetalFamily, ScarcityDataset, ScarcitySnapshot } from "./types";

export type ScarcityDatasetName = "production" | "sample";

export function resolveScarcityDataset(
  requested?: string | null,
  environment: NodeJS.ProcessEnv = process.env,
): ScarcityDataset {
  const configured = requested ?? environment.SCARCITY_DATASET ?? "production";
  if (configured === "sample") {
    const sampleEnabled = environment.NODE_ENV !== "production"
      || environment.SCARCITY_ENABLE_SAMPLE_DATA === "true";
    if (!sampleEnabled) {
      throw new Error("The sample scarcity dataset is disabled in production.");
    }
    return SAMPLE_SCARCITY_DATASET;
  }
  if (configured !== "production") throw new Error("Unknown scarcity dataset.");
  return EMPTY_SCARCITY_DATASET;
}

export async function loadScarcityDataset(
  requested?: string | null,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ScarcityDataset> {
  const configured = requested ?? environment.SCARCITY_DATASET ?? "production";
  if (configured === "sample") return resolveScarcityDataset(configured, environment);
  if (configured !== "production") throw new Error("Unknown scarcity dataset.");
  const { loadProductionScarcityDataset } = await import("@/lib/scarcity-data-store");
  return loadProductionScarcityDataset();
}

export function listScarcitySnapshots(options: {
  dataset?: ScarcityDataset;
  asOf?: string;
  family?: MetalFamily;
} = {}): ScarcitySnapshot[] {
  const dataset = options.dataset ?? EMPTY_SCARCITY_DATASET;
  return SCARCITY_METALS
    .filter((metal) => !options.family || metal.families.includes(options.family))
    .map((metal) => calculateScarcitySnapshot(metal, dataset, options.asOf));
}

export function getScarcitySnapshot(options: {
  identifier: string;
  dataset?: ScarcityDataset;
  asOf?: string;
}) {
  const metal = getScarcityMetal(options.identifier);
  if (!metal) return null;
  return calculateScarcitySnapshot(
    metal,
    options.dataset ?? EMPTY_SCARCITY_DATASET,
    options.asOf,
  );
}
