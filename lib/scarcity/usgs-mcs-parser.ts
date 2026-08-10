import { USGS_MCS_2026_COMMODITY_MAPPINGS } from "./commodity-coverage";
import type { ScarcityMetricId } from "./types";

interface CsvRow {
  "MCS chapter": string;
  Section: string;
  Commodity: string;
  Country: string;
  Statistics: string;
  Statistics_detail: string;
  Unit: string;
  Year: string;
  Value: string;
  Notes: string;
  "Is critical mineral 2025": string;
  "Other notes": string;
}

export interface ParsedMcsMetric {
  metricId: Extract<ScarcityMetricId, "supply-growth-yoy-pct" | "reserve-life-years" | "top-three-supply-share-pct">;
  value: number;
  unit: "percent" | "years";
  coverageRatio: number;
  derivation: string;
  inputs: Record<string, unknown>;
}

export interface ParsedMcsRecord {
  metalId: string;
  chapter: string;
  commodity: string;
  commercialForm: string;
  reportingMode: "direct" | "group";
  notes?: string;
  metrics: ParsedMcsMetric[];
}

function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift();
  if (!headers) throw new Error("The USGS MCS CSV has no header row.");
  return rows
    .filter((candidate) => candidate.some(Boolean))
    .map((candidate) => Object.fromEntries(headers.map((header, index) => [header, candidate[index] ?? ""])) as unknown as CsvRow);
}

function exactNumber(value: string) {
  const normalized = value.trim().replaceAll(",", "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function unitFactor(unit: string) {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "kilograms") return 0.001;
  if (normalized === "metric tons") return 1;
  if (normalized === "thousand metric tons") return 1_000;
  if (normalized === "million metric tons") return 1_000_000;
  if (normalized === "short tons") return 0.90718474;
  if (normalized === "thousand short tons") return 907.18474;
  return null;
}

function normalizedDetail(value: string) {
  return value
    .replace(/[�–—]/g, "-")
    .replace(/(?::|,)\s*rounded$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function detailMatches(detail: string, accepted: readonly string[]) {
  const normalized = normalizedDetail(detail);
  return accepted.some((candidate) => normalized === normalizedDetail(candidate));
}

function rounded(value: number) {
  return Number(value.toFixed(4));
}

function metricCoverage(mode: "direct" | "group", metricId: ParsedMcsMetric["metricId"]) {
  if (mode === "group") return metricId === "top-three-supply-share-pct" ? 0.5 : 0.55;
  if (metricId === "supply-growth-yoy-pct") return 0.85;
  return 0.9;
}

export function parseUsgsMcsCsv(input: string, releaseYear: number): ParsedMcsRecord[] {
  if (!Number.isInteger(releaseYear) || releaseYear < 2000 || releaseYear > 2200) {
    throw new Error("USGS MCS release year is invalid.");
  }
  const currentObservationYear = releaseYear - 1;
  const priorObservationYear = releaseYear - 2;
  const rows = parseCsv(input);
  const records: ParsedMcsRecord[] = [];

  for (const mapping of USGS_MCS_2026_COMMODITY_MAPPINGS) {
    const chapterRows = rows.filter((row) => row["MCS chapter"] === mapping.chapter);
    const productionRows = chapterRows.filter((row) =>
      row.Statistics === "Production" && detailMatches(row.Statistics_detail, mapping.productionDetails),
    );
    const totals = new Map<number, CsvRow>();
    for (const year of [priorObservationYear, currentObservationYear]) {
      const total = productionRows.find((row) =>
        row.Country === "World total" && row.Year === String(year) && exactNumber(row.Value) !== null,
      );
      if (total) totals.set(year, total);
    }
    const metrics: ParsedMcsMetric[] = [];
    const priorProduction = totals.get(priorObservationYear);
    const currentProduction = totals.get(currentObservationYear);
    const priorValue = priorProduction ? exactNumber(priorProduction.Value) : null;
    const currentValue = currentProduction ? exactNumber(currentProduction.Value) : null;

    if (currentProduction && priorValue !== null && currentValue !== null && priorValue > 0) {
      metrics.push({
        metricId: "supply-growth-yoy-pct",
        value: rounded(((currentValue - priorValue) / priorValue) * 100),
        unit: "percent",
        coverageRatio: metricCoverage(mapping.reportingMode, "supply-growth-yoy-pct"),
        derivation: `(USGS ${currentObservationYear} world production - USGS ${priorObservationYear} world production) / USGS ${priorObservationYear} world production × 100`,
        inputs: {
          [`production${priorObservationYear}`]: priorValue,
          [`production${currentObservationYear}`]: currentValue,
          unit: currentProduction.Unit,
        },
      });
    }

    if (currentProduction && currentValue !== null && currentValue > 0) {
      const producers = productionRows
        .filter((row) => row.Year === String(currentObservationYear) && row.Country !== "World total" && row.Country !== "Other countries")
        .flatMap((row) => {
          const value = exactNumber(row.Value);
          return value === null ? [] : [{ country: row.Country, value }];
        })
        .sort((left, right) => right.value - left.value);
      if (producers.length >= 3) {
        const topThree = producers.slice(0, 3);
        const share = topThree.reduce((sum, producer) => sum + producer.value, 0) / currentValue * 100;
        if (share > 0 && share <= 105) {
          metrics.push({
            metricId: "top-three-supply-share-pct",
            value: rounded(Math.min(100, share)),
            unit: "percent",
            coverageRatio: metricCoverage(mapping.reportingMode, "top-three-supply-share-pct"),
            derivation: `Sum of the three largest explicitly reported ${currentObservationYear} country production values / USGS ${currentObservationYear} world production × 100`,
            inputs: {
              [`worldProduction${currentObservationYear}`]: currentValue,
              unit: currentProduction.Unit,
              topProducers: topThree,
            },
          });
        }
      }
    }

    if (mapping.reserveDetails && currentProduction && currentValue !== null && currentValue > 0) {
      const reserve = chapterRows.find((row) =>
        row.Statistics === "Reserves"
        && row.Country === "World total"
        && row.Year === String(currentObservationYear)
        && detailMatches(row.Statistics_detail, mapping.reserveDetails ?? [])
        && exactNumber(row.Value) !== null,
      );
      const reserveValue = reserve ? exactNumber(reserve.Value) : null;
      const reserveUnit = mapping.reserveUnitOverride ?? reserve?.Unit;
      const reserveFactor = reserveUnit ? unitFactor(reserveUnit) : null;
      const productionFactor = unitFactor(currentProduction.Unit);
      if (reserve && reserveValue !== null && reserveFactor !== null && productionFactor !== null) {
        const reserveLife = reserveValue * reserveFactor / (currentValue * productionFactor);
        if (reserveLife > 0 && reserveLife <= 10_000) {
          metrics.push({
            metricId: "reserve-life-years",
            value: rounded(reserveLife),
            unit: "years",
            coverageRatio: metricCoverage(mapping.reportingMode, "reserve-life-years"),
            derivation: `USGS ${currentObservationYear} world reserves / USGS ${currentObservationYear} world production after unit normalization`,
            inputs: {
              [`reserves${currentObservationYear}`]: reserveValue,
              reserveUnit,
              [`production${currentObservationYear}`]: currentValue,
              productionUnit: currentProduction.Unit,
            },
          });
        }
      }
    }

    for (const metalId of mapping.metalIds) {
      records.push({
        metalId,
        chapter: mapping.chapter,
        commodity: mapping.commodity,
        commercialForm: mapping.commercialForm,
        reportingMode: mapping.reportingMode,
        ...(mapping.notes ? { notes: mapping.notes } : {}),
        metrics,
      });
    }
  }
  return records.sort((left, right) => left.metalId.localeCompare(right.metalId));
}
