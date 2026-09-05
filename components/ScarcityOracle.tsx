"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleDot,
  Database,
  Search,
  ShieldCheck,
  Waves,
} from "lucide-react";
import { useMetalQuotes } from "@/hooks/use-metal-quotes";
import { useOnlineMetalDetector } from "@/hooks/use-online-metal-detector";
import { PERIODIC_ELEMENTS } from "@/lib/scarcity/periodic-table";
import {
  useScarcityData,
  useScarcityOracleIndex,
  useScarcityPulse,
  useScarcitySignals,
  type ScarcityMetalState,
  type ScarcityWeeklyPositionPoint,
} from "@/hooks/use-scarcity-exchange";
import styles from "./scarcity-oracle.module.css";

interface OracleMarket {
  slug: string;
  lifecycle: string;
  metal: { id: string; symbol: string; name: string };
}

type TableFilter = "all" | "markets" | "price-data" | "supply-projects" | "policy" | "science";

const tableFilters: Array<{ id: TableFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "markets", label: "Markets" },
  { id: "price-data", label: "Price & data" },
  { id: "supply-projects", label: "Supply & projects" },
  { id: "policy", label: "Policy" },
  { id: "science", label: "Science" },
];

function score(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : value.toFixed(1);
}

function shortHash(value: string) {
  return `${value.slice(0, 7)}…${value.slice(-5)}`;
}

function metricValue(value: number | null, unit: string) {
  if (value === null) return "—";
  const formatted = Math.abs(value) >= 100
    ? value.toLocaleString("en-US", { maximumFractionDigits: 1 })
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return unit === "percent" ? `${formatted}%` : `${formatted} ${unit}`;
}

function observedYear(value: string | null) {
  return value ? new Date(value).getUTCFullYear() : "—";
}

function signedPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function usdPrice(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 0 : 2 })}`;
}

function detectorTime(value: string | null | undefined) {
  if (!value) return "awaiting first run";
  return new Date(value).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function stateLabel(state?: ScarcityMetalState, referenceStage?: "observed" | "mapped" | "scientific") {
  if (state?.coverageStatus && state.coverageStatus !== "uncovered") return state.coverageStatus.replace("_", " ");
  if (referenceStage === "scientific") return "scientific reference";
  if (referenceStage === "mapped") return "proxy mapped";
  return "reference mapped";
}

function StateSparkline({ states }: { states: ScarcityMetalState[] }) {
  const values = states.flatMap((state) => state.marketTightness === null ? [] : [state.marketTightness]);
  if (values.length === 0) return <div className={styles.sparklineEmpty}>Awaiting the first reviewed state</div>;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 120 : 8 + (index / (values.length - 1)) * 224;
    const y = 55 - (value / 100) * 47;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg className={styles.sparkline} viewBox="0 0 240 64" role="img" aria-label={`Market Tightness history with ${values.length} observations`}>
      <path d="M8 55H232M8 31.5H232M8 8H232" />
      {values.length > 1 ? <polyline points={points} /> : null}
      {values.map((value, index) => {
        const [x, y] = points.split(" ")[index].split(",");
        return <circle key={`${x}-${y}`} cx={x} cy={y} r={values.length === 1 ? 4 : 2.5}><title>{value.toFixed(1)}</title></circle>;
      })}
    </svg>
  );
}

function PositionSparkline({ points }: { points: ScarcityWeeklyPositionPoint[] }) {
  const visible = points.slice(-13);
  if (visible.length < 2) return <div className={styles.sparklineEmpty}>Awaiting two weekly observations</div>;
  const coordinates = (key: "producerMerchantNetPct" | "managedMoneyNetPct") => visible.map((point, index) => {
    const x = 8 + (index / (visible.length - 1)) * 224;
    const y = 32 - (Math.max(-60, Math.min(60, point[key])) / 60) * 24;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg className={styles.positionSparkline} viewBox="0 0 240 64" role="img" aria-label={`${visible.length} weeks of CFTC producer and managed-money net positioning`}>
      <path d="M8 8H232M8 32H232M8 56H232" />
      <polyline className={styles.producerLine} points={coordinates("producerMerchantNetPct")} />
      <polyline className={styles.managedLine} points={coordinates("managedMoneyNetPct")} />
    </svg>
  );
}

export function ScarcityOracle(props: {
  markets: OracleMarket[];
  dataset?: string;
  onOpenMarket: (slug: string) => void;
}) {
  const [selectedSymbol, setSelectedSymbol] = useState("Cu");
  const [filter, setFilter] = useState<TableFilter>("all");
  const [query, setQuery] = useState("");
  const indexQuery = useScarcityOracleIndex(props.dataset);
  const signalsQuery = useScarcitySignals(props.dataset);
  const detailQuery = useScarcityData(selectedSymbol, props.dataset);
  const pulseQuery = useScarcityPulse(selectedSymbol);
  const quoteQuery = useMetalQuotes();
  const detectorQuery = useOnlineMetalDetector(selectedSymbol);
  const indexBySymbol = useMemo(() => new Map(
    (indexQuery.data?.metals ?? []).map((entry) => [entry.metal.symbol, entry]),
  ), [indexQuery.data?.metals]);
  const marketBySymbol = useMemo(() => new Map(props.markets.map((market) => [market.metal.symbol, market])), [props.markets]);
  const selectedElement = PERIODIC_ELEMENTS.find((element) => element.symbol === selectedSymbol) ?? PERIODIC_ELEMENTS[28];
  const selectedIndex = indexBySymbol.get(selectedSymbol);
  const selectedMarket = marketBySymbol.get(selectedSymbol);
  const detail = detailQuery.data;
  const pulse = pulseQuery.data;
  const liveReference = selectedIndex ? quoteQuery.data?.markets[selectedIndex.metal.id] : undefined;
  const activeSignals = signalsQuery.data ?? [];
  const onlineDetector = detectorQuery.data;
  const onlineEvidence = onlineDetector?.evidence ?? [];
  const onlineSignals = onlineDetector?.signals ?? [];
  const onlineCandidates = onlineDetector?.candidates ?? [];
  const selectedSignals = detail?.signals.filter((signal) => signal.status === "active") ?? [];
  const availableMetrics = detail
    ? [...detail.marketTightness.metrics, ...detail.structuralScarcity.metrics]
      .filter((metric) => metric.value !== null)
    : [];
  const datasetKind = indexQuery.data?.dataset.kind ?? detail?.dataset.kind ?? "empty";
  const search = query.trim().toLowerCase();

  function matchesFilter(symbol: string) {
    const entry = indexBySymbol.get(symbol);
    if (filter === "markets") return marketBySymbol.has(symbol);
    if (filter !== "all") return Boolean(entry?.marketNamespace.eligibleCategories.includes(filter));
    return true;
  }

  return (
    <section className={styles.oracle}>
      <header className={styles.oracleHero}>
        <div>
          <span className={styles.kicker}>Hedgents Metal State Oracle / v1</span>
          <h1>Every metal has<br /><em>a state to verify.</em></h1>
          <p>Prices · supply · policy · projects · science. Numerical signals and named future events enter separate paths, then converge on the same frozen evidence rules.</p>
        </div>
        <div className={styles.oracleStats}>
          <article><span>Periodic registry</span><strong>118</strong><small>scientific elements</small></article>
          <article><span>Reference coverage</span><strong>{indexQuery.data ? `${indexQuery.data.referenceCoverage.mapped}/${indexQuery.data.count}` : "—"}</strong><small>tracked metal + metalloid cells</small></article>
          <article><span>Physical observations</span><strong>{indexQuery.data?.sourceCoverage.observedMetalCount ?? "—"}</strong><small>direct + group cells</small></article>
          <article><span>Event eligible</span><strong>{indexQuery.data?.marketNamespaceCoverage.eventEligible ?? "—"}</strong><small>named catalyst namespaces</small></article>
        </div>
      </header>

      <div className={styles.oracleNotice}>
        <span className={datasetKind === "sample" ? styles.sampleDot : styles.productionDot} />
        <strong>{datasetKind === "sample" ? "Illustrative development fixture" : indexQuery.data?.dataset.label ?? "Production observation store"}</strong>
        <p>{datasetKind === "sample" ? "Synthetic values validate the interface only. They are never presented as market data." : `${indexQuery.data?.referenceCoverage.mapped ?? "—"} metal cells have an objective resolver. A missing numerical signal blocks the data path only; a named, time-bounded event can still qualify.`}</p>
        <code>{indexQuery.data?.methodologyVersion ?? "method pending"}</code>
      </div>

      <div className={styles.detectorRail}>
        <div>
          <span className={onlineDetector?.summary.latestRunStatus === "healthy" ? styles.detectorHealthy : onlineDetector?.summary.latestRunStatus === "failed" ? styles.detectorFailed : styles.detectorPending} />
          <strong>Online signal detector</strong>
          <small>{onlineDetector?.summary.latestRunStatus ?? "pending"} · daily official-source scan</small>
        </div>
        <dl>
          <div><dt>Scheduled</dt><dd>{onlineDetector?.summary.scheduledMetalCount ?? indexQuery.data?.pipelineCoverage.scheduledRefreshCount ?? "—"}/99</dd></div>
          <div><dt>Sources healthy</dt><dd>{onlineDetector ? `${onlineDetector.summary.sourcesHealthy}/${onlineDetector.summary.sourceCount}` : "—"}</dd></div>
          <div><dt>Review queue</dt><dd>{onlineDetector?.summary.quarantinedEvidence ?? "—"}</dd></div>
          <div><dt>Last run</dt><dd>{detectorTime(onlineDetector?.summary.lastRunAt)}</dd></div>
        </dl>
      </div>

      <div className={styles.tableToolbar}>
        <div className={styles.filterGroup} aria-label="Filter periodic table">
          {tableFilters.map((item) => (
            <button type="button" key={item.id} className={filter === item.id ? styles.filterActive : undefined} onClick={() => setFilter(item.id)}>{item.label}</button>
          ))}
        </div>
        <label className={styles.searchBox}>
          <Search size={13} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find symbol or metal" aria-label="Find an element" />
        </label>
        <div className={styles.tableLegend}>
          <span><i className={styles.legendFill} /> observed</span>
          <span><i className={styles.legendGroup} /> group</span>
          <span><i className={styles.legendCadence} /> data pulse</span>
          <span><i className={styles.legendPulse} /> signal</span>
          <span><i className={styles.legendMarket} /> compiled market</span>
          <span><i className={styles.legendReference} /> event eligible</span>
        </div>
      </div>

      <div className={styles.periodicViewport}>
        <div className={styles.periodicTable} aria-label="Periodic table of metal state coverage">
          <span className={styles.seriesLabel} style={{ gridRow: 8, gridColumn: "1 / span 3" }}>Lanthanide series</span>
          <span className={styles.seriesLabel} style={{ gridRow: 9, gridColumn: "1 / span 3" }}>Actinide series</span>
          {PERIODIC_ELEMENTS.map((element) => {
            const entry = indexBySymbol.get(element.symbol);
            const trackable = Boolean(entry);
            const hasSignal = Boolean(entry?.activeSignalCount);
            const hasPulse = entry?.frequency.highestActiveCadence !== "annual";
            const hasMarket = marketBySymbol.has(element.symbol);
            const selected = selectedSymbol === element.symbol;
            const queryMatches = !search || element.symbol.toLowerCase().includes(search) || element.name.toLowerCase().includes(search);
            const visible = trackable && matchesFilter(element.symbol) && queryMatches;
            const tightness = entry?.state.marketTightness ?? 0;
            const cellStyle = {
              gridRow: element.displayRow,
              gridColumn: element.displayColumn,
              "--tightness": `${tightness}%`,
            } as CSSProperties;
            return (
              <button
                type="button"
                key={element.atomicNumber}
                style={cellStyle}
                disabled={!trackable}
                onClick={() => setSelectedSymbol(element.symbol)}
                className={[
                  styles.element,
                  styles[element.category.replaceAll("-", "_") as keyof typeof styles],
                  !trackable ? styles.nonMetal : "",
                  trackable && entry?.state.coverageStatus === "uncovered" ? styles.referenceMapped : "",
                  trackable && entry?.state.coverageStatus === "partial" ? styles.partial : "",
                  trackable && entry?.state.coverageStatus === "verified" ? styles.verified : "",
                  entry?.metal.dataMode === "group" ? styles.groupReported : "",
                  entry?.metal.marketStatus === "non-commercial" ? styles.nonCommercial : "",
                  entry?.reference.coverageStage === "scientific" ? styles.scientificReference : "",
                  hasSignal ? styles.signaling : "",
                  hasPulse ? styles.hasPulse : "",
                  hasMarket ? styles.hasMarket : "",
                  selected ? styles.elementSelected : "",
                  !visible && trackable ? styles.filtered : "",
                ].filter(Boolean).join(" ")}
                aria-pressed={selected}
                title={`${element.atomicNumber} ${element.name} · ${entry ? `${entry.reference.referenceName} · ${entry.reference.relationship} · ${entry.reference.cadence} · ${stateLabel(entry.state, entry.reference.coverageStage)}` : element.category}`}
              >
                <small>{element.atomicNumber}</small>
                <strong>{element.symbol}</strong>
                <span>{element.name}</span>
                {hasSignal ? <i className={styles.signalBeacon} /> : null}
                {hasPulse ? <i className={styles.cadenceBeacon} /> : null}
                {hasMarket ? <i className={styles.marketBeacon} /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.intelligenceGrid}>
        <section className={styles.metalDossier}>
          <header>
            <div className={styles.selectedAtomic}>
              <small>{selectedElement.atomicNumber}</small>
              <strong>{selectedElement.symbol}</strong>
              <span>{selectedElement.name}</span>
            </div>
            <div>
              <span className={styles.dossierPath}>ORACLE / {selectedElement.symbol.toUpperCase()} / CURRENT STATE</span>
              <h2>{selectedElement.name}</h2>
              <p>{selectedIndex?.metal.description ?? "Registered metal with an objective reference-market mapping."}</p>
              {selectedIndex?.reference ? <div className={styles.commodityLine}>
                <span>{selectedIndex.reference.coverageStage}</span>
                <strong>{selectedIndex.reference.referenceName}</strong>
                <em>{selectedIndex.reference.relationship}</em>
                <span>{selectedIndex.reference.cadence}</span>
              </div> : null}
            </div>
            <div className={`${styles.coverageBadge} ${detail?.state.coverageStatus === "verified" ? styles.coverage_verified : detail?.state.coverageStatus === "partial" ? styles.coverage_partial : styles.coverage_reference}`}>
              <i /> {stateLabel(detail?.state, detail?.reference?.coverageStage)}
            </div>
          </header>

          <div className={styles.stateReadout}>
            <article><span>Market Tightness</span><strong>{score(detail?.state.marketTightness)}</strong><small>observed state · not probability</small></article>
            <article><span>Structural Scarcity</span><strong>{score(detail?.state.structuralScarcity)}</strong><small>long-duration constraints</small></article>
            <article><span>Data Confidence</span><strong>{detail ? Math.round(detail.state.confidence) : "—"}</strong><small>{detail?.dataConfidence.grade ?? "insufficient"} · {detail?.dataConfidence.sourceCount ?? 0} sources</small></article>
            <article>
              <span>State Momentum</span>
              <strong className={detail?.state.momentum.direction === "tightening" ? styles.tightening : detail?.state.momentum.direction === "loosening" ? styles.loosening : undefined}>
                {detail?.state.momentum.direction === "tightening" ? <ArrowUpRight /> : detail?.state.momentum.direction === "loosening" ? <ArrowDownRight /> : <Activity />}
                {detail?.state.momentum.change === null || detail?.state.momentum.change === undefined ? "—" : `${detail.state.momentum.change > 0 ? "+" : ""}${detail.state.momentum.change.toFixed(1)}`}
              </strong>
              <small>{detail?.state.momentum.direction ?? "unknown"}</small>
            </article>
          </div>

          {detail?.reference ? <section className={styles.referenceMarket}>
            <header>
              <div><span>Contract namespace</span><small>Data and event paths stay distinct until their rules are frozen</small></div>
              <strong>{selectedIndex?.marketNamespace.primaryPath ?? detail.reference.coverageStage}</strong>
            </header>
            <div className={styles.referenceGrid}>
              <article><span>Reference</span><strong>{detail.reference.referenceName}</strong><small>{detail.reference.relationship} relationship</small></article>
              <article><span>Signal</span><strong>{detail.reference.signalMetric}</strong><small>{detail.reference.cadence} observation cadence</small></article>
              <article><span>Unit</span><strong>{detail.reference.referenceUnit}</strong><small>{detail.reference.marketUse.replaceAll("-", " ")}</small></article>
            </div>
            <div className={styles.referenceQuestion}>
              <div><span>{selectedIndex?.marketNamespace.primaryPath ?? "data"} contract / primary template</span><p>{detail.reference.binaryQuestion}</p></div>
              <a href={detail.reference.source.url} target="_blank" rel="noreferrer">{detail.reference.source.name} <ArrowUpRight size={11} /></a>
            </div>
            <div className={styles.marketPathLanes}>
              {selectedIndex?.marketNamespace.paths.map((path) => <article key={path.kind} className={path.eligible ? styles.marketPathEligible : styles.marketPathUnavailable}>
                <header><span>{path.kind} market</span><em>{path.eligible ? path.state : "not defensible"}</em></header>
                <p>{path.description}</p>
              </article>)}
            </div>
            <p className={styles.referenceCaveat}>{detail.reference.caveat}</p>
          </section> : null}

          <section className={styles.onlineEvidence}>
            <header>
              <div><span>Online catalyst detector</span><small>Official pages · policy records · scientific publications</small></div>
              <strong>{onlineEvidence.length.toString().padStart(2, "0")}</strong>
            </header>
            {onlineEvidence.length ? <div className={styles.onlineEvidenceList}>{onlineEvidence.slice(0, 4).map((evidence) => (
              <article key={evidence.id}>
                <i className={styles[`onlineDirection_${evidence.direction}`]} />
                <div>
                  <span>{evidence.category.replaceAll("-", " ")} · {evidence.authority} · {evidence.status}</span>
                  <strong>{evidence.title}</strong>
                  <small>{evidence.publisher} · {detectorTime(evidence.publishedAt)} UTC</small>
                </div>
                <div className={styles.onlineEvidenceLinks}>
                  <a href={evidence.url} target="_blank" rel="noreferrer">Source <ArrowUpRight size={10} /></a>
                  <a href={evidence.artifactPath} target="_blank" rel="noreferrer">Artifact <ArrowUpRight size={10} /></a>
                </div>
              </article>
            ))}</div> : <div className={styles.onlineEvidenceEmpty}>
              <Activity size={16} />
              <div><strong>{detectorQuery.isLoading ? "Checking detector state…" : "No new catalyst is in the queue"}</strong><span>The source namespace is scheduled. A first run establishes fingerprints; later changes are preserved and quarantined for review.</span></div>
            </div>}
          </section>

          <section className={styles.marketPulse}>
            <header>
              <div><span>Market pulse</span><small>High-frequency context · isolated from physical scarcity state</small></div>
              <strong className={styles[`pulse_${selectedIndex?.frequency.highestActiveCadence.replace("-", "_") ?? "annual"}`]}>{selectedIndex?.frequency.highestActiveCadence ?? "annual"}</strong>
            </header>
            {(liveReference?.priceUsd !== null && liveReference?.priceUsd !== undefined) || pulse?.weekly.available ? <>
              <div className={styles.pulseReadout}>
                <article><span>Reference price</span><strong>{usdPrice(liveReference?.priceUsd)}</strong><small>{liveReference?.sourceSymbol ?? "no real-time feed"} · {liveReference?.freshness ?? "unavailable"}</small></article>
                <article><span>24h reference move</span><strong className={(liveReference?.change24h ?? 0) > 0 ? styles.pulsePositive : (liveReference?.change24h ?? 0) < 0 ? styles.pulseNegative : undefined}>{signedPercent(liveReference?.change24h)}</strong><small>market move · not scarcity</small></article>
                <article><span>Producer / merchant net</span><strong>{signedPercent(pulse?.weekly.latest?.producerMerchantNetPct)}</strong><small>share of futures open interest</small></article>
                <article><span>Managed money net</span><strong>{signedPercent(pulse?.weekly.latest?.managedMoneyNetPct)}</strong><small>share of futures open interest</small></article>
                <article><span>Open interest WoW</span><strong>{signedPercent(pulse?.weekly.latest?.openInterestChangePct)}</strong><small>{pulse?.weekly.latest?.openInterest.toLocaleString("en-US") ?? "—"} contracts</small></article>
              </div>
              <div className={styles.pulseAnalysis}>
                <div className={styles.positionChart}>
                  <header><span>CFTC positioning / 13 weeks</span><small><i /> producer / merchant <i /> managed money</small></header>
                  <PositionSparkline points={pulse?.weekly.history ?? []} />
                </div>
                <div className={styles.pulseFlags}>
                  <header><span>Objective flags</span><strong>{pulse?.weekly.flags.length.toString().padStart(2, "0") ?? "00"}</strong></header>
                  {pulse?.weekly.flags.length ? pulse.weekly.flags.slice(0, 3).map((flag) => <article key={flag.id}>
                    <i className={styles[`pulseFlag_${flag.severity}`]} />
                    <div><strong>{flag.label}</strong><small>{flag.description}</small></div>
                    <em>{signedPercent(flag.observed)}</em>
                  </article>) : <p>No weekly positioning threshold is active.</p>}
                </div>
              </div>
              <footer>
                <span>{liveReference?.publishedAt ? `Pyth ${new Date(liveReference.publishedAt).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} UTC` : "Pyth reference unavailable"}</span>
                {pulse?.weekly.available ? <a href={pulse.weekly.source.url} target="_blank" rel="noreferrer">CFTC {pulse.weekly.source.contractCode} · {pulse.weekly.freshness} <ArrowUpRight size={10} /></a> : <span>{pulseQuery.isLoading ? "Loading weekly source…" : pulse?.weekly.note ?? "No weekly contract mapped"}</span>}
                <strong>Excluded from Metal State and settlement</strong>
              </footer>
            </> : <div className={styles.pulseEmpty}>
              <Activity size={16} />
              <div><strong>No active high-frequency source</strong><span>{selectedIndex?.frequency.monthlyPhysicalMonitor ? "USGS monthly physical series is monitored but publication is currently paused." : "This element remains on the annual physical cadence until a rights-cleared source is pinned."}</span></div>
            </div>}
          </section>

          <section className={styles.metricEvidence}>
            <header>
              <div><span>Available physical observations</span><small>Observable inputs remain visible even when a composite score fails its coverage gate</small></div>
              <strong>{availableMetrics.length.toString().padStart(2, "0")}</strong>
            </header>
            {availableMetrics.length ? <div className={styles.metricGrid}>
              {availableMetrics.map((metric) => (
                <article key={metric.metricId}>
                  <span>{metric.label}</span>
                  <strong>{metricValue(metric.value, metric.unit)}</strong>
                  <small>{observedYear(metric.observedAt)} observation · {metric.dataStatus}</small>
                  <footer>
                    <em>{metric.sources[0]?.name ?? "Source unavailable"}</em>
                    {metric.observationIds[0] ? <a href={`/api/scarcity/observations/${encodeURIComponent(metric.observationIds[0])}`} target="_blank" rel="noreferrer">Evidence <ArrowUpRight size={10} /></a> : null}
                  </footer>
                </article>
              ))}
            </div> : <div className={styles.metricEmpty}>
              <Database size={16} />
              <span>{detail?.reference ? `Reference mapped through ${detail.reference.referenceName}; no normalized physical scarcity observation has passed review yet.` : "No normalized physical scarcity observation has passed review yet."}</span>
            </div>}
          </section>

          <div className={styles.historyPanel}>
            <header><div><span>Immutable state history</span><small>{detail?.history.length ?? 0} reviewed cycle(s)</small></div><code>{detail?.state.evidenceRoot ? shortHash(detail.state.evidenceRoot) : "no evidence root"}</code></header>
            <StateSparkline states={detail?.history ?? []} />
          </div>

          <div className={styles.signalPanel}>
            <header><div><span>Detected signals</span><small>Rule-based observations, never personalized advice</small></div><strong>{selectedSignals.length.toString().padStart(2, "0")}</strong></header>
            {selectedSignals.length ? selectedSignals.map((signal) => (
              <article key={signal.id} className={styles[`severity_${signal.severity}`]}>
                <i />
                <div><span>{signal.severity} / {signal.type}</span><strong>{signal.label}</strong><p>{signal.description}</p></div>
                <dl><div><dt>Observed</dt><dd>{signal.trigger.observed.toFixed(1)} {signal.trigger.unit}</dd></div><div><dt>Trigger</dt><dd>{signal.trigger.threshold} {signal.trigger.unit}</dd></div></dl>
              </article>
            )) : <div className={styles.emptyPanel}><Waves size={17} /><span>{detailQuery.isLoading ? "Calculating reviewed state…" : "No active numerical signal."}</span><small>Event-driven candidates may still be available.</small></div>}
          </div>
        </section>

        <aside className={styles.marketCompiler}>
          <header><div><span>Market compiler</span><small>Two entry paths · one deterministic evidence gate</small></div><CircleDot size={17} /></header>
          <div className={styles.compilerEntryPaths}>
            <article className={detail?.candidates.length ? styles.compilerEntryActive : undefined}>
              <span>DATA SIGNAL</span><strong>Observed metric</strong><small>{detail?.candidates.length ? `${detail.candidates.length} candidate(s)` : "No active numerical trigger"}</small>
            </article>
            <article className={selectedIndex?.marketNamespace.paths.some((path) => path.kind === "event" && path.eligible) ? styles.compilerEntryActive : undefined}>
              <span>EVENT CATALYST</span><strong>Named future outcome</strong><small>{onlineCandidates.length ? `${onlineCandidates.length} detected candidate(s)` : "Eligible when event + deadline + resolver are frozen"}</small>
            </article>
          </div>
          <div className={styles.compilerFlow}>
            <span className={detail?.reference ? styles.flowPass : ""}>01<small>source</small></span><i />
            <span className={detail?.reference ? styles.flowPass : ""}>02<small>rules</small></span><i />
            <span className={detail?.candidates.length || detail?.reference ? styles.flowPass : ""}>03<small>review</small></span><i />
            <span className={selectedMarket ? styles.flowPass : ""}>04<small>market</small></span>
          </div>
          <div className={styles.candidateList}>
            {detail?.candidates.slice(0, 3).map((candidate) => (
              <article key={candidate.id}>
                <header><span>{candidate.readiness}</span><code>{shortHash(candidate.specificationHash)}</code></header>
                <p>{candidate.question}</p>
                {candidate.blockers.length ? <ul>{candidate.blockers.slice(0, 3).map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <div className={styles.gatesPassed}><ShieldCheck size={13} /> Compiler gates passed; human review required.</div>}
              </article>
            ))}
            {onlineCandidates.slice(0, 3).map((candidate) => (
              <article key={candidate.id} className={styles.eventCandidate}>
                <header><span>event / {candidate.readiness}</span><code>{shortHash(candidate.specificationHash)}</code></header>
                <p>{candidate.question}</p>
                {candidate.blockers.length ? <ul>{candidate.blockers.slice(0, 2).map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
                <a href={candidate.resolverUrl} target="_blank" rel="noreferrer">Open resolver <ArrowUpRight size={10} /></a>
              </article>
            ))}
            {!detail?.candidates.length && detail?.reference ? <article className={styles.referenceCandidate}>
              <header><span>data / monitored template</span><code>{detail.reference.cadence}</code></header>
              <p>{detail.reference.binaryQuestion}</p>
              <ul>
                <li>The source adapter is scheduled; a new release enters the immutable evidence pipeline.</li>
                <li>Threshold, observation window, and invalid rules are not frozen.</li>
                <li>Settlement and redistribution rights are not approved.</li>
              </ul>
            </article> : null}
            {!onlineCandidates.length && selectedIndex?.marketNamespace.paths.some((path) => path.kind === "event" && path.eligible) ? <article className={styles.eventCandidate}>
              <header><span>event / eligible namespace</span><code>catalyst required</code></header>
              <p>{selectedIndex.marketNamespace.paths.find((path) => path.kind === "event")?.description}</p>
              <ul>
                <li>Name one objective future outcome; news alone is not the outcome.</li>
                <li>Freeze the deadline, primary resolver, source precedence, and invalid rule.</li>
                <li>Human review is required before a specification can open.</li>
              </ul>
            </article> : null}
            {!detail?.candidates.length && !detail?.reference ? <div className={styles.emptyCandidate}><Database size={18} /><strong>No candidate compiled</strong><p>A verified state and qualifying objective signal must exist first.</p></div> : null}
          </div>
          {selectedMarket ? <button type="button" className={styles.openMarketButton} onClick={() => props.onOpenMarket(selectedMarket.slug)}>
            <span><strong>Open {selectedElement.symbol} research market</strong><small>{selectedMarket.lifecycle} specification · no live capital</small></span><ArrowRight size={15} />
          </button> : <div className={styles.noMarketButton}><span>{selectedElement.symbol} namespace is covered</span><small>Select a timely data release or named event, then freeze complete resolution rules.</small></div>}
        </aside>
      </div>

      <section className={styles.globalSignals}>
        <header><div><span>Cross-metal signal wire</span><small>Latest objective detections across the periodic registry</small></div><strong>{activeSignals.length.toString().padStart(2, "0")}</strong></header>
        <div>
          {activeSignals.slice(0, 8).map((signal) => (
            <button type="button" key={signal.id} onClick={() => setSelectedSymbol(signal.metalSymbol)}>
              <i className={styles[`severityDot_${signal.severity}`]} />
              <span><strong>{signal.metalSymbol}</strong><small>{signal.metalName}</small></span>
              <span><strong>{signal.label}</strong><small>{signal.trigger.observed.toFixed(1)} {signal.trigger.unit}</small></span>
              <em>{signal.publication}</em>
              <ArrowUpRight size={13} />
            </button>
          ))}
          {!activeSignals.length ? <div className={styles.globalEmpty}><Activity size={18} /><span>No reviewed cross-metal signals yet.</span></div> : null}
        </div>
      </section>

      <section className={styles.globalSignals}>
        <header><div><span>Online catalyst wire</span><small>New source records stay quarantined until operator review</small></div><strong>{onlineSignals.length.toString().padStart(2, "0")}</strong></header>
        <div>
          {onlineSignals.slice(0, 8).map((signal) => (
            <button type="button" key={signal.id} onClick={() => setSelectedSymbol(signal.metalSymbol)}>
              <i className={styles[`severityDot_${signal.severity}`]} />
              <span><strong>{signal.metalSymbol}</strong><small>{signal.metalName}</small></span>
              <span><strong>{signal.label}</strong><small>{signal.category.replaceAll("-", " ")} · {signal.source.publisher}</small></span>
              <em>{signal.publication}</em>
              <ArrowUpRight size={13} />
            </button>
          ))}
          {!onlineSignals.length ? <div className={styles.globalEmpty}><Activity size={18} /><span>{onlineDetector?.summary.lastRunAt ? "No online catalyst matched this metal in the retained window." : "The first scheduled scan will establish source fingerprints."}</span></div> : null}
        </div>
      </section>
    </section>
  );
}
