# Scarcity Oracle Backend

**Status:** Complete 99-cell objective reference registry, USGS annual physical baseline and automatic release importer, daily online event detector, quarantine/review workflow, market pulse, oracle history, signal engine, readiness compiler, APIs, and periodic-table/admin UI implemented; deeper physical-frequency coverage and recurring curves remain future work  
**Methodology:** `2026-08-08.v1`  
**Build-plan revision:** 2026-08-08

The scarcity backend lives inside the terminal service. Its framework-independent calculation engine is under `lib/scarcity`; Next.js route handlers expose invite-gated read APIs and administrator publication workflows.

The target pipeline is:

```text
Physical and official sources
  → quarantined raw artifacts
  → normalized candidate observations
  → human review and immutable publication
  → historical Metal State snapshots
  → objective signal detection
  → periodic-table intelligence
  → qualifying binary-market candidates
```

## Current implementation truth

The current backend implements the complete local path from source-normalized observations through Metal State history, objective signals, and readiness-gated market candidates. It also maps every one of the 99 trackable material cells to an objective reference: a directly observed commercial form, a named compound/group/application proxy, or a scientific-event source. The explicit scope is every conventional metal, all six metalloids, and Selenium as a named minor-material exception; the remaining 19 nonmetal periodic elements are intentionally outside the Hedgents metal scope. It ships with a reproducible annual USGS baseline and a separate market-pulse rail: four actively publishing Pyth references and seven exact CFTC weekly contracts cover seven distinct metals. Pyth lists XCU/USD and XNI/USD metadata, but their stable feeds currently return zero price and zero publish time, so copper and nickel are not counted as active real-time coverage. It is **reference-complete**, but it is **not yet** an all-metal high-frequency physical network or recurring scarcity-curve service. Proxy, price, positioning, and scientific context cannot substitute for inventory, consumption, premiums, or independent physical confirmation.

Implemented today:

- Scientifically laid-out registry for all 118 elements, including 99 explicitly trackable scarcity cells.
- Complete objective reference classification: 50 observed commercial-form cells, 18 named compound/group/application proxies, and 31 scientific-event references. No tracked material cell is unmapped.
- Boron and Germanium are explicitly mapped to commercial borates on a B2O3 basis and refined germanium metal respectively; neither is mislabeled as elemental spot data.
- Physical scarcity remains separate: the 18 proxy cells still await normalized observations, and the 31 scientific cells receive no fabricated commodity values or scarcity scores.
- A machine-readable one-by-one audit covers all 118 periodic cells and fails if an observed label lacks data, a commercial cell falls back to a scientific reference, or a mapped observation loses its normalized commodity metadata.
- A checksummed USGS Mineral Commodity Summaries 2026 baseline containing 111 physical observations across 50 element cells: 36 directly reported commodities and 14 explicitly labeled rare-earth group cells.
- Reproducible derivation of annual supply growth, top-three producer concentration, and reserve life when the official rows contain exact, unit-compatible inputs.
- A separately labeled real-time market-reference overlay for gold, silver, platinum, palladium, copper, and nickel using the terminal's existing Pyth Core feed.
- Pinned CFTC weekly futures-positioning adapters for cobalt, copper, gold, lithium, palladium, platinum, and silver, using exact contract market codes rather than name matching.
- Objective producer/merchant net, managed-money net, and week-over-week open-interest flags with 26-week history and explicit stale/unavailable states.
- A monitored USGS Mineral Industry Survey map for 18 metals; the UI identifies the source as paused during the official ScienceBase migration and never presents it as current.
- Hard separation between physical Metal State and market pulse: reference prices and futures positioning do not change scarcity scores or automatically qualify as settlement evidence.
- A research-only binary-question template, named source, cadence, relationship, unit, market-use classification, and scientific caveat for every trackable metal cell.
- Calcium's application reference uses NOAA Coral Reef Watch bleaching-stress data and explicitly states that coral is a calcium-carbonate application signal, not elemental calcium supply, scarcity, or price.
- Versioned definitions for five market-tightness and six structural-scarcity metrics.
- Normalization bands, weights, maximum observation ages, and dimension coverage gates.
- Source reliability, observation status, coverage, independence, and freshness confidence.
- Point-in-time calculations using only observations published by the requested `asOf` timestamp.
- Deterministic calculation identifiers.
- A repository contract and an in-memory implementation for calculation tests and adapters.
- A durable private Blob-backed production dataset when storage is configured.
- Content-addressed raw source artifacts and immutable reviewed observation batches.
- Explicit revision links; changing an existing observation or source id is rejected.
- An administrator publication console and authenticated provenance APIs.
- A synthetic sample dataset that is visibly marked as non-market data and remains explicit opt-in only.
- Read APIs for the periodic-table summary, per-metal detail, provenance, and methodology.
- Immutable Metal State materialization whenever a reviewed batch is published.
- Deterministic on-demand history reconstruction for legacy and sample datasets.
- Versioned objective signals across inventory, supply, demand, production, premiums, reserves, concentration, recycling, substitution, momentum, and confidence.
- A readiness compiler that produces hashed binary-market candidates and explicit blockers.
- History, signal, signal-detail, and candidate APIs.
- A native periodic-table oracle UI with coverage, state, momentum, confidence, signals, history, and compiler readiness.

The online detector now implements:

- One daily Vercel Cron run covering the full 99-cell material registry.
- Conditional official-page checks with stable fingerprints and per-source health/failure counters.
- Federal Register critical-minerals discovery, bounded Crossref scientific discovery, and USGS ScienceBase annual-release discovery.
- Content-addressed immutable artifacts, deduplication, quarantine, approval/rejection, and proposed-rule event-candidate compilation.
- Automatic generalized parsing and immutable publication of a new official USGS CSV only after checksum and minimum-coverage gates pass.
- State and numerical-signal recomputation after reviewed annual data changes.
- Operator-visible run history, alerts, source health, evidence provenance, and manual execution controls.

Not implemented yet:

- Independent BGS, IEA, exchange-inventory, regional-premium, consumption, and specialist physical-market adapters with reviewed rights.
- Exact-field numerical adapters and reviewed settlement rights for the 18 commercial/application proxy references. Their event/page namespaces are monitored, but monitoring a page is not physical-data normalization.
- Frozen settlement packets for the 31 scientific-event references. Discovery and review are connected; no event automatically opens or resolves a market.
- Recurring scarcity curves.
- Independent data review and market disputes.
- Production signal-threshold backtesting and external alert delivery. In-product source-failure alerts are implemented.
- Full conversion of approved candidates into the existing immutable market-question and rules documents.

Production defaults to the bundled USGS annual baseline and merges administrator-reviewed observations on top of it. Any physical metric, cell, or current-period fact not supported by those sources still returns `null` and `unavailable`; the service must never substitute a reference mapping, sample, modelled value, or stale value to make physical coverage appear complete. Reference completeness and physical verification are reported separately.

## Complete reference-market layer

`lib/scarcity/reference-markets.ts` assigns an objective research reference to every trackable metal cell:

- `observed` — 50 cells already connected to a named annual commercial-form or rare-earth-group observation.
- `mapped` — 18 cells connected to a named compound, group, application, or form-specific official source. These include borates for Boron, refined metal for Germanium, soda ash for sodium, potash for potassium, NOAA coral bleaching stress for calcium, barite for barium, zircon-derived supply for hafnium, EIA uranium data, and form-specific USGS references for the remaining specialized metals.
- `scientific` — 31 cells without an open commodity market use an IAEA evaluated-nuclide publication event. These are scientific-event references only.

Every reference includes a relationship label, cadence, unit, signal metric, binary research question, primary source, caveat, and `research-only` settlement state. A mapped template does not enter the immutable scarcity score, create a signal, or pass the market compiler. It must first receive a timestamped adapter, frozen observation field and window, invalidation behavior, rights review, and human approval.

## Product contracts

### Metal State snapshot

Each immutable snapshot should expose the observed state without any market probability:

```ts
type CoverageStatus = "verified" | "partial" | "uncovered" | "market_ready";

type MetalStateSnapshot = {
  id: string;
  metalId: string;
  asOf: string;
  marketTightness: number | null;
  structuralScarcity: number | null;
  momentum: {
    direction: "tightening" | "loosening" | "stable" | "unknown";
    change: number | null;
    window: string | null;
  };
  confidence: number;
  coverageStatus: CoverageStatus;
  methodologyVersion: string;
  observationIds: string[];
  evidenceRoot: string;
  createdAt: string;
};
```

### Objective signal

A signal describes a reproducible change in observed state. It is market information, not personalized advice.

```ts
type MetalSignal = {
  id: string;
  metalId: string;
  type: string;
  direction: "tightening" | "loosening" | "neutral";
  severity: "info" | "watch" | "material" | "critical";
  detectedAt: string;
  effectiveAt: string;
  expiresAt: string | null;
  snapshotId: string;
  priorSnapshotId: string | null;
  evidenceIds: string[];
  methodologyVersion: string;
  trigger: {
    metric: string;
    operator: string;
    threshold: number | null;
    observed: number | null;
    unit: string | null;
  };
  status: "active" | "expired" | "superseded" | "withdrawn";
};
```

Initial signal families:

- Inventory drawdown, days-of-cover breach, and inventory shock.
- Supply deficit, production disruption, and refining disruption.
- Demand acceleration and demand/supply divergence.
- Export or import contraction.
- Regional premium spike and regional divergence.
- Reserve-life deterioration.
- Recycling and substitution changes.
- Cross-metal divergence and supply-chain contagion.
- Confidence and source-quality deterioration.

### Market candidate

A signal can produce a candidate specification only when the future outcome is independently observable.

```ts
type MarketCandidate = {
  id: string;
  signalId: string;
  metalId: string;
  question: string;
  observationAt: string;
  threshold: number;
  unit: string;
  primarySourceIds: string[];
  fallbackSourceIds: string[];
  invalidConditions: string[];
  methodologyVersion: string;
  specificationHash: string;
  readiness: "blocked" | "paper_ready" | "review_ready";
  blockers: string[];
};
```

Market price or trader probability is never written into `MetalStateSnapshot`. Oracle state and future market expectations must remain independently auditable.

## Existing API

All endpoints currently require an active Hedgents beta or administrator session.

### List metals

```http
GET /api/scarcity/metals
GET /api/scarcity/metals?family=precious
GET /api/scarcity/metals?asOf=2026-08-08T00:00:00.000Z
```

### Metal detail

```http
GET /api/scarcity/metals/Cu
GET /api/scarcity/metals/copper?asOf=2026-08-08T00:00:00.000Z
```

The detail response includes every metric value, normalized score, confidence, freshness, selected observation id, and source.

### Methodology

```http
GET /api/scarcity/methodology
```

### Sample data

```http
GET /api/scarcity/metals?dataset=sample
GET /api/scarcity/metals/Cu?dataset=sample
```

Production rejects the sample dataset unless `SCARCITY_ENABLE_SAMPLE_DATA=true`. The normal production path always uses the real annual baseline, even when private Blob storage has not been configured.

### Bundled USGS annual baseline

The baseline is derived from the official USGS Mineral Commodity Summaries 2026 CSV data release. The generated JSON records the source DOI, publication DOI, ScienceBase item id, source MD5, source SHA-256, observation time, publication time, commercial form, derivation, and exact inputs for every output.

To reproduce the checked-in baseline after downloading the official CSV:

```bash
npm run generate:scarcity-usgs -- /absolute/path/to/MCS2026_Commodities_Data.csv lib/scarcity/usgs-mcs-2026-baseline.json
```

The generator refuses inequalities, ranges, missing values, and incompatible reserve/production units. Rare-earth observations are labeled as group context and are never presented as element-specific production.

### Evidence provenance

```http
GET /api/scarcity/observations/{observation-id}
GET /api/scarcity/artifacts/{sha256}
```

### Online detector

```http
GET /api/scarcity/detector
GET /api/scarcity/detector?metal=Ge
GET /api/scarcity/detector/artifacts/{sha256}
POST /api/admin/scarcity/detector/run
PATCH /api/admin/scarcity/detector/evidence/{evidence-id}
GET /api/cron/scarcity-detector
```

The public terminal endpoints still require beta/admin access. The admin mutation endpoints require an administrator session. The cron endpoint instead requires Vercel's `Authorization: Bearer $CRON_SECRET` header and fails closed when durable private storage is absent. The daily job is declared in `vercel.json` at `04:17 UTC`.

Free-source constraints are deliberate: Crossref checks one rotating metal per day over a bounded 120-day window, official reference pages establish fingerprints before reporting changes, and page or publication evidence remains quarantined until review. This keeps the detector inexpensive without presenting discovery coverage as high-frequency physical data.

### High-frequency market pulse

```http
GET /api/scarcity/metals/Cu/pulse
```

The authenticated response combines cadence coverage metadata with the latest pinned CFTC weekly context when one exists. The client displays the terminal's existing Pyth real-time reference beside it. CFTC upstream responses are cached for one hour, the UI polls the weekly endpoint every 15 minutes, and failed fetches become `unavailable` rather than silently retaining an old value as current.

Current active coverage:

- **Real-time reference:** Au, Ag, Pt, Pd, Cu, Ni.
- **Weekly positioning:** Co, Cu, Au, Li, Pd, Pt, Ag.
- **Distinct active pulse cells:** 8.
- **Monitored monthly/quarterly physical MIS cells:** 18, currently source-paused.

Market pulse is objective context, not personalized advice. Its source metadata says `settlementUse: not-approved`; the compiler cannot use it as resolution evidence without a separately reviewed market specification and rights decision.

### Operator publication

```http
POST /api/admin/scarcity/observations/publish
```

This administrator-only endpoint accepts a versioned `ScarcityObservationBatch`. The source artifact is mandatory, limited to reviewed text, CSV, JSON, or XML payloads, and stored before the current production dataset index is updated. Development falls back to process memory; production fails closed with `503` if private Blob storage is absent.

## Intelligence read API

These routes are implemented:

```http
GET /api/scarcity/metals/{symbol}/history
GET /api/scarcity/signals
GET /api/scarcity/signals?metal=Cu&status=active
GET /api/scarcity/signals/{signal-id}
GET /api/scarcity/markets/candidates
GET /api/scarcity/markets/candidates?metal=Cu
```

The future `GET /api/scarcity/curves/{symbol}` route remains intentionally unimplemented until sufficient state history and multiple comparable, resolved contract periods exist.

## Calculation contract

The backend calculates three independent outputs:

1. **Market tightness:** Inventory, supply balance, demand growth, supply growth, and regional premium.
2. **Structural scarcity:** Reserve life, development lead time, supply concentration, by-product dependency, recycling, and substitution.
3. **Data confidence:** Coverage, source quality, independence, observation status, and freshness.

Missing values are not imputed. A dimension is unavailable until its configured coverage gate is met. Old observations lose confidence and become unusable after three times their expected update interval.

## Source ingestion and review

Every adapter produces a candidate `ScarcityObservationBatch` with:

- Stable observation and dataset ids.
- Canonical metal and metric ids.
- Exact units.
- Observation and publication timestamps.
- A registered source.
- Final, provisional, or estimated status.
- Coverage and independent-source counts.
- Exact retrieved payload, URL, retrieval time, content type, reviewer, and review time.
- A new stable observation id plus `revisionOf` when correcting a prior publication.

The operational sequence is:

1. Fetch a source into a quarantined content-addressed artifact.
2. Normalize it into candidate observations without publishing them.
3. Validate units, timestamps, metal mapping, source rights, and prior revisions.
4. Require an operator to review and publish an immutable batch.
5. Materialize the affected point-in-time Metal State snapshot.
6. Run signal detection against the new and previous reviewed snapshots.
7. Compile only qualifying signals into market candidates for separate approval.

Fetching never auto-publishes settlement data. Signals run only against reviewed observations, and no signal automatically opens a market.

## Market-readiness gate

A metal or signal is `market_ready` only when all of the following are true:

1. The current and triggering observations are verified and reproducible.
2. Coverage, confidence, independence, and freshness gates pass.
3. The signal definition and methodology version are frozen.
4. A named future observation will be available at a fixed time.
5. Units, threshold, source precedence, fallback behavior, invalid conditions, and dispute window are deterministic.
6. Data redistribution and settlement usage rights have been reviewed.
7. The candidate passes human usefulness and minimum-liquidity review.

If any gate fails, the API returns the blockers. No data means `uncovered`; insufficient data means `partial`; no qualifying signal means no market candidate.

## Ordered build plan

### M1 — Production Metal State Oracle

1. **Implemented:** add the first reproducible official-data adapter and a checksummed annual baseline.
2. **Implemented:** cached real-time/weekly source fetching, daily online source health, durable raw-artifact quarantine, deduplication, and the review queue.
3. **Implemented locally:** materialize immutable historical snapshots and momentum changes on reviewed publication.
4. Replace Blob index mutation with transactional persistence and distributed concurrency control before multiple operators publish.
5. **Implemented:** coverage-state and history APIs are connected to the full periodic table and transparently distinguish direct, group, specialized, and non-commercial cells; automated source-health ingestion covers all 99 tracked cells.

### M2 — Objective signal engine

1. **Implemented locally:** versioned signal definitions and deterministic stable ids.
2. **Implemented locally:** detect signals only from reviewed or explicitly illustrative snapshots.
3. **Partially implemented:** signal history is reproducible from immutable snapshots with expiry and evidence roots; operator withdrawal workflow remains pending.
4. **Partially implemented:** audit, feed, and filter APIs exist; external alert delivery remains pending.
5. Backtest thresholds and obtain independent methodology review.

### M3 — Signal-to-market compiler

1. **Implemented locally:** readiness gates return explicit evidence, confidence, rights, cadence, signal, and coverage blockers.
2. **Partially implemented:** hashed candidate specifications have fixed observation times; final resolution packets still require reviewer approval.
3. Backtest invalid conditions and fallback sources.
4. Run paper markets before allowing candidates into the existing Solana market workflow.
5. Complete resolver, challenge, revision, and cancellation governance.

### M4 — Closed Solana beta

1. Complete the program audit, authority/multisig layout, monitoring, and reproducible deployment process.
2. Run a devnet canary only after explicit approval.
3. Permit a capped mainnet beta only after data rights, dispute, legal, security, and operating gates pass.

### M5 — Recurring curves

1. Accumulate comparable snapshot and resolved-contract history.
2. Publish 1M, 3M, 6M, and 12M market-implied probabilities separately from oracle state.
3. Expose historical calibration, curve, and cross-metal comparison APIs.

No onchain program should consume a scarcity state or settle a market until the production source set, revision policy, methodology review, and dispute model are complete.
