import assert from "node:assert/strict";
import test from "node:test";
import { parseUsgsMcsCsv } from "./scarcity/usgs-mcs-parser";

const headers = [
  "MCS chapter", "Section", "Commodity", "Country", "Statistics", "Statistics_detail",
  "Unit", "Year", "Value", "Notes", "Is critical mineral 2025", "Other notes",
];

function csvRow(values: string[]) {
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(",");
}

test("parses a future USGS release year without hard-coded observation years", () => {
  const rows = [
    headers.join(","),
    csvRow(["COPPER", "", "Copper", "World total", "Production", "Mine production", "thousand metric tons", "2025", "22000", "", "", ""]),
    csvRow(["COPPER", "", "Copper", "World total", "Production", "Mine production", "thousand metric tons", "2026", "20000", "", "", ""]),
    csvRow(["COPPER", "", "Copper", "Chile", "Production", "Mine production", "thousand metric tons", "2026", "5000", "", "", ""]),
    csvRow(["COPPER", "", "Copper", "Peru", "Production", "Mine production", "thousand metric tons", "2026", "3000", "", "", ""]),
    csvRow(["COPPER", "", "Copper", "China", "Production", "Mine production", "thousand metric tons", "2026", "2000", "", "", ""]),
    csvRow(["COPPER", "", "Copper", "World total", "Reserves", "Reserves", "million metric tons", "2026", "1000", "", "", ""]),
  ].join("\n");
  const copper = parseUsgsMcsCsv(rows, 2027).find((record) => record.metalId === "copper");
  assert.ok(copper);
  assert.equal(copper.metrics.find((metric) => metric.metricId === "supply-growth-yoy-pct")?.value, -9.0909);
  assert.equal(copper.metrics.find((metric) => metric.metricId === "top-three-supply-share-pct")?.value, 50);
  assert.equal(copper.metrics.find((metric) => metric.metricId === "reserve-life-years")?.value, 50);
});
