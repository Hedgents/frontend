"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  Database,
  Factory,
  FlaskConical,
  Gavel,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  useScarcityOracleIndex,
  type CatalystCategory,
  type ScarcityOracleIndex,
} from "@/hooks/use-scarcity-exchange";
import styles from "./scarcity-catalysts.module.css";

interface CatalystMarket {
  slug: string;
  lifecycle: string;
  metal: { id: string; symbol: string; name: string };
}

type CatalystFilter = "all" | CatalystCategory;
type IndexedMetal = ScarcityOracleIndex["metals"][number];

const categoryMeta: Record<CatalystCategory, { label: string; short: string; icon: ReactNode }> = {
  "price-data": { label: "Price & data", short: "DATA", icon: <Database size={15} /> },
  "supply-projects": { label: "Supply & projects", short: "BUILD", icon: <Factory size={15} /> },
  policy: { label: "Policy", short: "RULE", icon: <Gavel size={15} /> },
  science: { label: "Science", short: "SCI", icon: <FlaskConical size={15} /> },
};

const filterOrder: CatalystFilter[] = ["all", "price-data", "supply-projects", "policy", "science"];

function categoryLabel(category: CatalystFilter) {
  return category === "all" ? "All" : categoryMeta[category].label;
}

function selectedTone(entry: IndexedMetal | undefined) {
  if (!entry) return "#d5aa55";
  if (entry.marketNamespace.primaryCategory === "science") return "#72aab2";
  if (entry.marketNamespace.primaryCategory === "policy") return "#d76f5f";
  if (entry.marketNamespace.primaryCategory === "supply-projects") return "#b8d36d";
  return "#d5aa55";
}

function categoryCount(index: ScarcityOracleIndex | undefined, filter: CatalystFilter) {
  if (!index) return "—";
  return filter === "all" ? index.count : index.marketNamespaceCoverage.categories[filter];
}

export function ScarcityCatalysts(props: {
  markets: CatalystMarket[];
  dataset?: string;
  onOpenMarket: (slug: string) => void;
}) {
  const [selectedSymbol, setSelectedSymbol] = useState("Ge");
  const [filter, setFilter] = useState<CatalystFilter>("all");
  const [query, setQuery] = useState("");
  const indexQuery = useScarcityOracleIndex(props.dataset);
  const marketBySymbol = useMemo(
    () => new Map(props.markets.map((market) => [market.metal.symbol, market])),
    [props.markets],
  );
  const search = query.trim().toLowerCase();
  const entries = indexQuery.data?.metals ?? [];
  const selected = entries.find((entry) => entry.metal.symbol === selectedSymbol) ?? entries[0];
  const filtered = useMemo(() => entries.filter((entry) => {
    const matchesCategory = filter === "all" || entry.marketNamespace.eligibleCategories.includes(filter);
    const matchesQuery = !search
      || entry.metal.symbol.toLowerCase().includes(search)
      || entry.metal.name.toLowerCase().includes(search)
      || entry.reference.referenceName.toLowerCase().includes(search);
    return matchesCategory && matchesQuery;
  }), [entries, filter, search]);
  const selectedMarket = selected ? marketBySymbol.get(selected.metal.symbol) : undefined;
  const tone = selectedTone(selected);
  const dataPath = selected?.marketNamespace.paths.find((path) => path.kind === "data");
  const eventPath = selected?.marketNamespace.paths.find((path) => path.kind === "event");
  const rootStyle = { "--catalyst-tone": tone } as CSSProperties;

  return (
    <section className={styles.catalysts} style={rootStyle}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span>Hedgents / Metal catalyst map</span>
          <h1>Every metal has<br /><em>a future to predict.</em></h1>
          <p>Prices · supply · policy · projects · science. Hedgents turns objective observations and verifiable future events into binary metal markets.</p>
        </div>
        <div className={styles.coveragePlate}>
          <div className={styles.coverageNumber}>
            <small>TRACKED CELLS</small>
            <strong>{indexQuery.data?.count ?? "—"}</strong>
            <span>of 118 elements</span>
          </div>
          <dl>
            <div><dt>Objective reference</dt><dd>{indexQuery.data?.marketNamespaceCoverage.mapped ?? "—"}</dd></div>
            <div><dt>Data eligible</dt><dd>{indexQuery.data?.marketNamespaceCoverage.dataEligible ?? "—"}</dd></div>
            <div><dt>Event eligible</dt><dd>{indexQuery.data?.marketNamespaceCoverage.eventEligible ?? "—"}</dd></div>
            <div><dt>Compiled research markets</dt><dd>{props.markets.length}</dd></div>
          </dl>
        </div>
      </header>

      <section className={styles.twoPath} aria-label="Two paths from metal intelligence to a market">
        <div className={styles.pathLabel}><span>Two paths</span><strong>One evidence standard</strong></div>
        <div className={styles.pathBranch}>
          <i>01A</i>
          <div><Database size={15} /><span>Structured data</span><small>price · production · inventory · score</small></div>
          <ArrowRight size={14} />
          <div><span>Numerical signal</span><small>threshold + observation time</small></div>
        </div>
        <div className={`${styles.pathBranch} ${styles.eventBranch}`}>
          <i>01B</i>
          <div><BookOpenCheck size={15} /><span>Named event</span><small>policy · project · report · science</small></div>
          <ArrowRight size={14} />
          <div><span>Event catalyst</span><small>outcome + deadline + resolver</small></div>
        </div>
        <div className={styles.pathMerge}>
          <span>Frozen rules</span><ArrowRight size={14} /><span>Evidence review</span><ArrowRight size={14} /><strong>Market</strong>
        </div>
      </section>

      <div className={styles.catalystToolbar}>
        <div className={styles.filters} aria-label="Filter market catalyst namespaces">
          {filterOrder.map((item) => (
            <button type="button" key={item} className={filter === item ? styles.filterActive : undefined} onClick={() => setFilter(item)}>
              <span>{categoryLabel(item)}</span><small>{categoryCount(indexQuery.data, item)}</small>
            </button>
          ))}
        </div>
        <label className={styles.searchBox}>
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find metal, symbol, or reference" aria-label="Find a catalyst namespace" />
          <small>{filtered.length.toString().padStart(2, "0")}</small>
        </label>
      </div>

      <div className={styles.mapWorkspace}>
        <section className={styles.namespaceMap} aria-label="Metal catalyst namespaces">
          <header><span>Opportunity map</span><small>Choose a cell to inspect its market paths</small></header>
          <div className={styles.namespaceGrid}>
            {filtered.map((entry, index) => {
              const active = entry.metal.symbol === selected?.metal.symbol;
              const market = marketBySymbol.get(entry.metal.symbol);
              const primary = categoryMeta[entry.marketNamespace.primaryCategory];
              return (
                <button
                  type="button"
                  key={entry.metal.id}
                  className={active ? styles.namespaceActive : undefined}
                  onClick={() => setSelectedSymbol(entry.metal.symbol)}
                  aria-pressed={active}
                  style={{ "--cell-delay": `${Math.min(index, 24) * 18}ms` } as CSSProperties}
                  title={`${entry.metal.name} · ${entry.marketNamespace.primaryQuestion}`}
                >
                  <small>{entry.metal.atomicNumber}</small>
                  <strong>{entry.metal.symbol}</strong>
                  <span>{entry.metal.name}</span>
                  <em>{primary.short}</em>
                  {market ? <i title="Compiled research market" /> : null}
                </button>
              );
            })}
          </div>
          {!indexQuery.isLoading && filtered.length === 0 ? <div className={styles.noResults}>No namespace matches this filter.</div> : null}
        </section>

        <aside className={styles.namespaceDetail}>
          {selected ? <>
            <header className={styles.detailHeader}>
              <div className={styles.atomicTile}><small>{selected.metal.atomicNumber}</small><strong>{selected.metal.symbol}</strong><span>{selected.metal.name}</span></div>
              <div>
                <span>MARKET NAMESPACE / {selected.metal.symbol}</span>
                <h2>{selected.metal.name}</h2>
                <p>{selected.metal.description}</p>
              </div>
            </header>

            <div className={styles.categoryTags}>
              {selected.marketNamespace.eligibleCategories.map((category) => <span key={category}>{categoryMeta[category].icon}{categoryMeta[category].label}</span>)}
            </div>

            <section className={styles.primaryTemplate}>
              <header><span>{selected.marketNamespace.primaryPath} contract / primary template</span><em>{selected.reference.cadence}</em></header>
              <p>{selected.marketNamespace.primaryQuestion}</p>
              <a href={selected.marketNamespace.resolver.primarySourceUrl} target="_blank" rel="noreferrer">
                {selected.marketNamespace.resolver.primarySourceName} <ArrowUpRight size={12} />
              </a>
            </section>

            <div className={styles.pathCards}>
              <article className={dataPath?.eligible ? styles.pathEligible : styles.pathUnavailable}>
                <header><Database size={14} /><span>Data market</span><em>{dataPath?.eligible ? "eligible" : "not defensible"}</em></header>
                <p>{dataPath?.description}</p>
              </article>
              <article className={styles.pathEligible}>
                <header><BookOpenCheck size={14} /><span>Event market</span><em>eligible</em></header>
                <p>{eventPath?.description}</p>
              </article>
            </div>

            <section className={styles.activationGate}>
              <header><span>Event activation gate</span><ShieldCheck size={15} /></header>
              <ol>
                <li><i>01</i><div><strong>Name the outcome</strong><small>No vague “news about” contracts.</small></div></li>
                <li><i>02</i><div><strong>Freeze the deadline</strong><small>One time window, fixed before trading.</small></div></li>
                <li><i>03</i><div><strong>Name the resolver</strong><small>Primary authority outranks reporting about it.</small></div></li>
                <li><i>04</i><div><strong>Define invalid</strong><small>Inconclusive evidence returns the invalid outcome.</small></div></li>
              </ol>
            </section>

            <section className={styles.evidenceHierarchy}>
              <header><span>Resolution hierarchy</span><small>News is evidence, never the outcome itself</small></header>
              {selected.marketNamespace.resolver.evidenceHierarchy.map((rule, index) => <div key={rule}><i>{index + 1}</i><span>{rule}</span></div>)}
              <p>{selected.marketNamespace.resolver.invalidWhen}</p>
            </section>

            {selectedMarket ? <button type="button" className={styles.openMarket} onClick={() => props.onOpenMarket(selectedMarket.slug)}>
              <span><strong>Open compiled {selected.metal.symbol} market</strong><small>{selectedMarket.lifecycle} specification</small></span><ArrowRight size={15} />
            </button> : <div className={styles.researchOnly}><span>Namespace covered</span><small>The next step is selecting a timely catalyst and freezing a complete contract—not inventing a price.</small></div>}
          </> : <div className={styles.detailLoading}>Loading objective market namespaces…</div>}
        </aside>
      </div>
    </section>
  );
}
