import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_FREQUENCY_COVERAGE,
  buildWeeklyPositioningPulse,
  fetchWeeklyPositioningPulse,
  frequencyCoverageForMetal,
  type CftcApiRow,
} from "./scarcity";

const currentCopper: CftcApiRow = {
  cftc_contract_market_code: "085692",
  commodity_name: "COPPER",
  market_and_exchange_names: "COPPER- #1 - COMMODITY EXCHANGE INC.",
  report_date_as_yyyy_mm_dd: "2026-08-04T00:00:00.000",
  open_interest_all: "289395",
  change_in_open_interest_all: "14843",
  pct_of_oi_prod_merc_long: "7.6",
  pct_of_oi_prod_merc_short: "39.6",
  pct_of_oi_m_money_long_all: "32.2",
  pct_of_oi_m_money_short_all: "6.0",
};

const priorCopper: CftcApiRow = {
  ...currentCopper,
  report_date_as_yyyy_mm_dd: "2026-07-28T00:00:00.000",
  open_interest_all: "274552",
  change_in_open_interest_all: "4504",
  pct_of_oi_prod_merc_long: "9.4",
  pct_of_oi_prod_merc_short: "40.5",
  pct_of_oi_m_money_long_all: "30.2",
  pct_of_oi_m_money_short_all: "6.5",
};

test("maps exact real-time and weekly frequency coverage without claiming all-metal live data", () => {
  assert.deepEqual(ACTIVE_FREQUENCY_COVERAGE, {
    realtimeMetalCount: 4,
    weeklyMetalCount: 7,
    activeMetalCount: 7,
    monitoredPhysicalMetalCount: 18,
  });
  assert.equal(frequencyCoverageForMetal("gold").highestActiveCadence, "real-time");
  assert.equal(frequencyCoverageForMetal("copper").highestActiveCadence, "weekly");
  assert.equal(frequencyCoverageForMetal("lithium").highestActiveCadence, "weekly");
  assert.equal(frequencyCoverageForMetal("tantalum").highestActiveCadence, "annual");
  assert.equal(frequencyCoverageForMetal("vanadium").monthlyPhysicalState, "source-paused");
});

test("normalizes pinned weekly CFTC positioning and detects objective concentration flags", () => {
  const pulse = buildWeeklyPositioningPulse(
    "copper",
    [currentCopper, priorCopper],
    "2026-08-08T00:00:00.000Z",
  );
  assert.equal(pulse.available, true);
  assert.equal(pulse.freshness, "fresh");
  assert.equal(pulse.history.length, 2);
  assert.equal(pulse.latest?.producerMerchantNetPct, -32);
  assert.equal(pulse.latest?.managedMoneyNetPct, 26.2);
  assert.equal(pulse.latest?.openInterestChangePct, 5.41);
  assert.deepEqual(pulse.flags.map((flag) => flag.type), [
    "producer-positioning",
    "managed-money-positioning",
    "open-interest-change",
  ]);
  assert.equal(pulse.source.contractCode, "085692");
  assert.equal(pulse.source.settlementUse, "not-approved");
});

test("refuses foreign contract rows and malformed numeric values", () => {
  const pulse = buildWeeklyPositioningPulse("copper", [
    { ...currentCopper, cftc_contract_market_code: "085699" },
    { ...currentCopper, open_interest_all: "not-a-number" },
  ], "2026-08-08T00:00:00.000Z");
  assert.equal(pulse.available, false);
  assert.equal(pulse.history.length, 0);
  assert.match(pulse.note, /no valid observations/i);
});

test("fetches only the exact pinned contract with an hourly source cache", async () => {
  let requestedUrl = "";
  let requestedInit: (RequestInit & { next?: { revalidate?: number } }) | undefined;
  const pulse = await fetchWeeklyPositioningPulse("copper", {
    asOf: "2026-08-08T00:00:00.000Z",
    fetchImpl: async (input, init) => {
      requestedUrl = input.toString();
      requestedInit = init;
      return Response.json([currentCopper, priorCopper]);
    },
  });
  const url = new URL(requestedUrl);
  assert.equal(url.hostname, "publicreporting.cftc.gov");
  assert.equal(url.searchParams.get("$where"), "cftc_contract_market_code='085692'");
  assert.equal(url.searchParams.get("$limit"), "26");
  assert.equal(requestedInit?.next?.revalidate, 3_600);
  assert.equal(pulse.available, true);
});
