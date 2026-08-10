import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { USGS_MCS_2026_COMMODITY_MAPPINGS } from "../lib/scarcity/commodity-coverage";

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

interface GeneratedMetric {
  metricId: "supply-growth-yoy-pct" | "reserve-life-years" | "top-three-supply-share-pct";
  value: number;
  unit: "percent" | "years";
  coverageRatio: number;
  derivation: string;
  inputs: Record<string, unknown>;
}

interface GeneratedRecord {
  metalId: string;
  chapter: string;
  commodity: string;
  commercialForm: string;
  reportingMode: "direct" | "group";
  notes?: string;
  metrics: GeneratedMetric[];
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
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift();
  if (!headers) throw new Error("The USGS CSV has no header row.");
  return rows
    .filter((candidate) => candidate.some(Boolean))
    .map((candidate) => Object.fromEntries(headers.map((header, index) => [header, candidate[index] ?? ""])) as unknown as CsvRow);
}

function exactNumber(value: string) {
  const normalized = value.trim().replaceAll(",", "");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
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

function metricCoverage(mode: "direct" | "group", metricId: GeneratedMetric["metricId"]) {
  if (mode === "group") return metricId === "top-three-supply-share-pct" ? 0.5 : 0.55;
  if (metricId === "supply-growth-yoy-pct") return 0.85;
  return 0.9;
}

function generate(rows: CsvRow[]): GeneratedRecord[] {
  const records: GeneratedRecord[] = [];
  for (const mapping of USGS_MCS_2026_COMMODITY_MAPPINGS) {
    const chapterRows = rows.filter((row) => row["MCS chapter"] === mapping.chapter);
    const productionRows = chapterRows.filter((row) =>
      row.Statistics === "Production" && detailMatches(row.Statistics_detail, mapping.productionDetails),
    );
    const totals = new Map<number, CsvRow>();
    for (const year of [2024, 2025]) {
      const total = productionRows.find((row) => row.Country === "World total" && row.Year === String(year) && exactNumber(row.Value) !== null);
      if (total) totals.set(year, total);
    }
    const metrics: GeneratedMetric[] = [];
    const production2024 = totals.get(2024);
    const production2025 = totals.get(2025);
    const value2024 = production2024 ? exactNumber(production2024.Value) : null;
    const value2025 = production2025 ? exactNumber(production2025.Value) : null;

    if (production2025 && value2024 !== null && value2025 !== null && value2024 > 0) {
      metrics.push({
        metricId: "supply-growth-yoy-pct",
        value: rounded(((value2025 - value2024) / value2024) * 100),
        unit: "percent",
        coverageRatio: metricCoverage(mapping.reportingMode, "supply-growth-yoy-pct"),
        derivation: "(USGS 2025 world production - USGS 2024 world production) / USGS 2024 world production × 100",
        inputs: {
          production2024: value2024,
          production2025: value2025,
          unit: production2025.Unit,
        },
      });
    }

    if (production2025 && value2025 !== null && value2025 > 0) {
      const production2025Unit = production2025.Unit;
      const producers = productionRows
        .filter((row) => row.Year === "2025" && row.Country !== "World total" && row.Country !== "Other countries")
        .flatMap((row) => {
          const value = exactNumber(row.Value);
          return value === null ? [] : [{ country: row.Country, value }];
        })
        .sort((left, right) => right.value - left.value);
      if (producers.length >= 3) {
        const topThree = producers.slice(0, 3);
        const share = topThree.reduce((sum, producer) => sum + producer.value, 0) / value2025 * 100;
        if (share > 0 && share <= 105) {
          metrics.push({
            metricId: "top-three-supply-share-pct",
            value: rounded(Math.min(100, share)),
            unit: "percent",
            coverageRatio: metricCoverage(mapping.reportingMode, "top-three-supply-share-pct"),
            derivation: "Sum of the three largest explicitly reported 2025 country production values / USGS 2025 world production × 100",
            inputs: {
              worldProduction2025: value2025,
              unit: production2025Unit,
              topProducers: topThree,
            },
          });
        }
      }
    }

    if (mapping.reserveDetails && production2025 && value2025 !== null && value2025 > 0) {
      const reserve = chapterRows.find((row) =>
        row.Statistics === "Reserves"
        && row.Country === "World total"
        && row.Year === "2025"
        && detailMatches(row.Statistics_detail, mapping.reserveDetails ?? [])
        && exactNumber(row.Value) !== null,
      );
      const reserveValue = reserve ? exactNumber(reserve.Value) : null;
      const reserveUnit = mapping.reserveUnitOverride ?? reserve?.Unit;
      const reserveFactor = reserveUnit ? unitFactor(reserveUnit) : null;
      const productionFactor = unitFactor(production2025.Unit);
      if (reserve && reserveValue !== null && reserveFactor !== null && productionFactor !== null) {
        const reserveLife = reserveValue * reserveFactor / (value2025 * productionFactor);
        if (reserveLife > 0 && reserveLife <= 10_000) {
          metrics.push({
            metricId: "reserve-life-years",
            value: rounded(reserveLife),
            unit: "years",
            coverageRatio: metricCoverage(mapping.reportingMode, "reserve-life-years"),
            derivation: "USGS 2025 world reserves / USGS 2025 world production after unit normalization",
            inputs: {
              reserves2025: reserveValue,
              reserveUnit,
              production2025: value2025,
              productionUnit: production2025.Unit,
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

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    throw new Error("Usage: tsx scripts/build-usgs-scarcity-baseline.ts <MCS CSV> <output JSON>");
  }
  const input = await readFile(resolve(inputPath));
  const records = generate(parseCsv(input.toString("utf8")));
  const payload = {
    schemaVersion: "1.0.0",
    source: {
      id: "usgs-mcs-2026-v1.3",
      title: "Mineral Commodity Summaries 2026 Data Release - Commodity Salient U.S. and World Statistics",
      doi: "https://doi.org/10.5066/P1WKQ63T",
      publication: "https://doi.org/10.3133/mcs2026",
      scienceBaseItemId: "69837e43b66b01367d7ec7c7",
      sourceCsvMd5: "36185ff3742087e1dd90c52fe634fe12",
      sourceCsvSha256: createHash("sha256").update(input).digest("hex"),
      observedAt: "2025-12-31T23:59:59.000Z",
      publishedAt: "2026-05-27T15:15:49.000Z",
    },
    recordCount: records.length,
    metricCount: records.reduce((sum, record) => sum + record.metrics.length, 0),
    records,
  };
  await writeFile(resolve(outputPath), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const observed = records.filter((record) => record.metrics.length > 0);
  console.log(`Generated ${payload.metricCount} observations for ${observed.length}/${records.length} mapped metal cells.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
