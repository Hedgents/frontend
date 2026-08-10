import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeDetectorUpstreamUrl, runOnlineMetalDetector } from "./scarcity-detector-runner";
import { resetOnlineDetectorForTests } from "./scarcity-detector-store";
import { ONLINE_DETECTOR_COVERAGE } from "./scarcity/online-detector";
import { USGS_MCS_BASELINE_SOURCE_METADATA } from "./scarcity/usgs-baseline";

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes("federalregister.gov/api/v1/documents")) {
    return json({ results: [{
      title: "Proposed rule on germanium export controls",
      type: "Proposed Rule",
      abstract: "The agency proposes a restriction on refined germanium exports.",
      document_number: "2026-TEST",
      html_url: "https://www.federalregister.gov/documents/2026/08/09/2026-test",
      pdf_url: "https://www.govinfo.gov/content/pkg/FR-2026-08-09/pdf/2026-test.pdf",
      publication_date: "2026-08-09",
      agencies: [{ name: "Commerce Department" }],
    }] });
  }
  if (url.startsWith("https://api.crossref.org/works?")) return json({ message: { items: [] } });
  if (url.includes("sciencebase.gov/catalog/items?")) {
    if (url.includes("2027")) return json({ items: [] });
    return json({ items: [{
      id: "69837e43b66b01367d7ec7c7",
      title: "Mineral Commodity Summaries 2026 Data Release - Commodity Salient U.S. and World Statistics",
      hasChildren: false,
    }] });
  }
  if (url.includes("sciencebase.gov/catalog/item/69837e43b66b01367d7ec7c7")) {
    return json({
      id: "69837e43b66b01367d7ec7c7",
      title: "Mineral Commodity Summaries 2026 Data Release - Commodity Salient U.S. and World Statistics",
      summary: "Official annual commodity data.",
      provenance: { lastUpdated: "2026-05-27T15:15:49Z" },
      files: [{
        name: "MCS2026_Commodities_Data.csv",
        checksum: { value: USGS_MCS_BASELINE_SOURCE_METADATA.sourceCsvMd5, type: "MD5" },
        downloadUri: "https://www.sciencebase.gov/catalog/file/get/current",
      }],
    });
  }
  return new Response("<html><head><title>Official metal reference</title></head><body><main>Official source baseline for metal supply, production, policy, project, and scientific evidence. This stable text is intentionally long enough to fingerprint safely.</main></body></html>", {
    status: 200,
    headers: { "content-type": "text/html", etag: '"fixture-v1"' },
  });
};

test("runs the free online detector end to end and deduplicates repeated evidence", async () => {
  resetOnlineDetectorForTests();
  const first = await runOnlineMetalDetector({ now: new Date("2026-08-09T04:17:00.000Z"), fetchImpl: fakeFetch });
  assert.equal(first.run.status, "healthy");
  assert.equal(first.run.sourcesAttempted, ONLINE_DETECTOR_COVERAGE.sourceCount);
  assert.equal(first.run.sourcesSucceeded, ONLINE_DETECTOR_COVERAGE.sourceCount);
  assert.equal(first.state.sources.every((source) => source.status === "healthy"), true);
  assert.equal(first.state.evidence.length, 1);
  assert.equal(first.state.evidence[0].metalIds.includes("germanium"), true);
  assert.equal(first.state.candidates.length, 1);
  assert.equal(first.state.candidates[0].readiness, "quarantined");
  assert.ok(first.run.numericalSignalsComputed > 0);

  const second = await runOnlineMetalDetector({ now: new Date("2026-08-10T04:17:00.000Z"), fetchImpl: fakeFetch });
  assert.equal(second.state.evidence.length, 1);
  assert.equal(second.run.evidenceDeduplicated, 1);
  assert.equal(second.state.candidates.length, 1);
});

test("detector upstream guard rejects private, credentialed, non-HTTPS, and unpinned URLs", () => {
  assert.equal(assertSafeDetectorUpstreamUrl("https://www.sciencebase.gov/catalog/items").hostname, "www.sciencebase.gov");
  assert.throws(() => assertSafeDetectorUpstreamUrl("http://www.sciencebase.gov/catalog/items"), /allowlist/);
  assert.throws(() => assertSafeDetectorUpstreamUrl("https://user:pass@www.sciencebase.gov/catalog/items"), /allowlist/);
  assert.throws(() => assertSafeDetectorUpstreamUrl("https://127.0.0.1/internal"), /allowlist/);
  assert.throws(() => assertSafeDetectorUpstreamUrl("https://sciencebase.gov.attacker.example/internal"), /allowlist/);
});
