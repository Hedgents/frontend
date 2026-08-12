"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  CircleAlert,
  CircleDollarSign,
  ChevronDown,
  Coins,
  Crosshair,
  Database,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Target,
  Timer,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import type { ScarcityMarket } from "./ScarcityExchange";
import type { ScarcityDataSnapshot } from "@/hooks/use-scarcity-exchange";
import {
  useScarcityCurveMarketState,
  useScarcityCurvePortfolio,
} from "@/hooks/use-scarcity-exchange";
import {
  curveBucketToNormalized,
  curveScenarioPayout,
  curveWeight,
  displayValueToNormalized,
  normalizedToCurveBucket,
  normalizedToDisplayValue,
} from "@/lib/scarcity-curve-math";
import {
  ScarcityCurveClaimAction,
  ScarcityCurveStakeAction,
  ScarcityCurveWithdrawAction,
} from "./ScarcityCurveWalletActions";
import { ScarcityInstrumentTabs } from "./ScarcityInstrumentTabs";
import styles from "./scarcity-curve-market.module.css";

function formatDateTime(value: string | number | bigint) {
  const parsed = typeof value === "string" && value.includes("T")
    ? new Date(value)
    : new Date(Number(value) * 1_000);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
}

function formatBaseUnits(value: bigint | string | undefined, maximumFractionDigits = 2) {
  const amount = typeof value === "bigint" ? value : BigInt(value || "0");
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").slice(0, maximumFractionDigits).replace(/0+$/, "");
  return fraction ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString();
}

function parseUsdc(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,10}(?:\.\d{0,6})?$/.test(normalized)) return 0n;
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function metricUnit(unit: string) {
  return unit === "score-0-100" ? "score" : unit;
}

function metricValue(value: number, precision: number) {
  return value.toFixed(Math.min(precision, 2));
}

function formatSignedBaseUnits(value: bigint) {
  const sign = value > 0n ? "+" : value < 0n ? "−" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${formatBaseUnits(absolute)} USDC`;
}

function formatPayoutMultiple(payout: bigint, stake: bigint) {
  if (stake <= 0n) return "—";
  return `${(Number(payout * 100n / stake) / 100).toFixed(2)}×`;
}

function offsetBucket(bucket: number, distance: number, bucketCount: number) {
  if (bucket + distance < bucketCount) return bucket + distance;
  return Math.max(0, bucket - distance);
}

function lifecycleLabel(status: string | undefined, deployed: boolean) {
  if (!deployed) return "Research specification";
  if (status === "unresolved") return "Open forecast pool";
  if (status === "resolved") return "Resolved · claims open";
  if (status === "invalid") return "Invalid · refunds open";
  return "Checking Solana";
}

export function ScarcityCurveMarket({
  markets,
  active,
  data,
  owner,
  onSelect,
  onOpenEvents,
  onOpenVerify,
  onConnect,
}: {
  markets: ScarcityMarket[];
  active: ScarcityMarket;
  data: ScarcityDataSnapshot | undefined;
  owner: string | null;
  onSelect: (slug: string) => void;
  onOpenEvents: () => void;
  onOpenVerify: () => void;
  onConnect: () => void;
}) {
  const curveMarkets = useMemo(() => markets.filter((market) => market.curve), [markets]);
  const curve = active.curve ?? curveMarkets[0]?.curve ?? null;
  const curveMarket = active.curve ? active : curveMarkets[0] ?? active;
  const [query, setQuery] = useState("");
  const [forecast, setForecast] = useState(curve?.displayRange.midpoint ?? 50);
  const [stake, setStake] = useState("25");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const chainQuery = useScarcityCurveMarketState(curve?.slug ?? "");
  const chainState = chainQuery.data?.state ?? null;
  const portfolioQuery = useScarcityCurvePortfolio(owner, Boolean(owner && chainState));

  useEffect(() => {
    if (!curve) return;
    const current = data?.marketTightness.score;
    const initial = current === null || current === undefined
      ? curve.displayRange.midpoint
      : Math.min(curve.displayRange.maximum, Math.max(curve.displayRange.minimum, current));
    const normalized = displayValueToNormalized(initial, curve.displayRange.minimum, curve.displayRange.maximum);
    const bucket = normalizedToCurveBucket(normalized, curve.bucketCount);
    setForecast(normalizedToDisplayValue(
      curveBucketToNormalized(bucket, curve.bucketCount),
      curve.displayRange.minimum,
      curve.displayRange.maximum,
    ));
  }, [curve, data?.marketTightness.score]);

  if (!curve) {
    return <section className={styles.unavailable}>
      <LockKeyhole size={24} />
      <span>Curve specification unavailable</span>
      <h2>This market resolves to a named event, not a number.</h2>
      <p>Curve forecasts only open when a reviewed metric has explicit units, range, normalization, and evidence rules.</p>
      <button type="button" onClick={onOpenEvents}>Open event markets <ArrowRight size={14} /></button>
    </section>;
  }

  const normalized = displayValueToNormalized(forecast, curve.displayRange.minimum, curve.displayRange.maximum);
  const selectedBucket = normalizedToCurveBucket(normalized, curve.bucketCount);
  const snappedForecast = normalizedToDisplayValue(
    curveBucketToNormalized(selectedBucket, curve.bucketCount),
    curve.displayRange.minimum,
    curve.displayRange.maximum,
  );
  const bucketStakes = chainState?.market.bucketStakes.map((value) => BigInt(value))
    ?? Array.from({ length: curve.bucketCount }, () => 0n);
  const poolStake = bucketStakes.reduce((total, amount) => total + amount, 0n);
  const maxBucketStake = bucketStakes.reduce((maximum, amount) => amount > maximum ? amount : maximum, 0n);
  const consensusIndex = poolStake > 0n
    ? Number(bucketStakes.reduce((total, amount, bucket) => total + amount * BigInt(bucket) * 10_000n, 0n) / poolStake) / 10_000
    : null;
  const consensusValue = consensusIndex === null ? null : normalizedToDisplayValue(
    Math.round(-1_000_000 + consensusIndex * 2_000_000 / (curve.bucketCount - 1)),
    curve.displayRange.minimum,
    curve.displayRange.maximum,
  );
  const currentScore = data?.marketTightness.score ?? null;
  const currentPercent = currentScore === null
    ? null
    : (currentScore - curve.displayRange.minimum) / (curve.displayRange.maximum - curve.displayRange.minimum) * 100;
  const selectedPercent = selectedBucket / (curve.bucketCount - 1) * 100;
  const consensusPercent = consensusIndex === null ? null : consensusIndex / (curve.bucketCount - 1) * 100;
  const ownerPositions = portfolioQuery.data?.positions.filter((position) => position.slug === curve.slug) ?? [];
  const selectedPosition = ownerPositions.find((position) => position.bucket === selectedBucket);
  const newStake = parseUsdc(stake);
  const payoutPreview = (() => {
    if (newStake <= 0n) return null;
    const mode = !chainState
      ? "research"
      : chainState.market.status === "unresolved"
        ? "live"
        : "closed";
    const isLive = mode === "live";
    const previewStakes = isLive
      ? [...bucketStakes]
      : Array.from({ length: curve.bucketCount }, () => 5_000_000n);
    previewStakes[selectedBucket] = (previewStakes[selectedBucket] ?? 0n) + newStake;
    const positionStake = isLive
      ? BigInt(selectedPosition?.stake ?? "0") + newStake
      : newStake;
    const inputs = {
      bucketStakes: previewStakes,
      positionBucket: selectedBucket,
      positionStake,
      feeBps: chainState?.market.feeBps ?? 50,
      jackpotBps: chainState?.market.jackpotBps ?? curve.targetJackpotBps,
      jackpotLeverageCap: chainState?.market.jackpotLeverageCap ?? curve.jackpotLeverageCap,
    };
    const outcomes = [
      { id: "exact", label: "Exact result", distance: 0, bucket: selectedBucket },
      { id: "close", label: "1 bucket away", distance: 1, bucket: offsetBucket(selectedBucket, 1, curve.bucketCount) },
      { id: "far", label: "10 buckets away", distance: 10, bucket: offsetBucket(selectedBucket, 10, curve.bucketCount) },
    ] as const;
    const scenarios = outcomes.map((outcome) => {
      const result = curveScenarioPayout({ ...inputs, winningBucket: outcome.bucket });
      return {
        ...outcome,
        payout: result.payout,
        profit: result.payout - positionStake,
        multiple: formatPayoutMultiple(result.payout, positionStake),
      };
    });
    return {
      mode,
      isLive,
      pool: previewStakes.reduce((total, amount) => total + amount, 0n),
      positionStake,
      feeBps: inputs.feeBps,
      scenarios,
    };
  })();
  const exactPreview = payoutPreview?.scenarios[0] ?? null;
  const farPreview = payoutPreview?.scenarios[2] ?? null;
  const filteredMarkets = curveMarkets.filter((market) => {
    const needle = query.trim().toLowerCase();
    return !needle || `${market.metal.symbol} ${market.metal.name} ${market.curve?.metric.label}`.toLowerCase().includes(needle);
  });
  const accuracyPoints = Array.from({ length: curve.bucketCount }, (_, bucket) => {
    const x = bucket / (curve.bucketCount - 1) * 1000;
    const weight = curveWeight(bucket, selectedBucket, curve.bucketCount);
    const y = 190 - weight / curve.bucketCount * 138;
    return `${x},${y}`;
  }).join(" ");

  /**
   * What a stake in each bucket would actually return if that bucket wins, against the live book.
   *
   * The weight curve above is the static kernel and it is the same shape whatever anyone else has
   * staked. This is the number that decides whether a forecast is worth making, because a
   * parimutuel dilutes: the crowded bucket pays least, so following the pool is punished even when
   * it is right. Showing it before the stake turns that from a hidden trap into a visible choice,
   * and it is information an order book cannot display at all.
   */
  const bucketMultiples = (() => {
    // One collateral unit when nothing is typed yet, so the strip is populated on first paint.
    const stakeUnit = newStake > 0n ? newStake : 1_000_000n;
    const live = Boolean(chainState) && chainState?.market.status === "unresolved";
    const book = live ? bucketStakes : Array.from({ length: curve.bucketCount }, () => 5_000_000n);
    return Array.from({ length: curve.bucketCount }, (_, bucket) => {
      const stakes = [...book];
      stakes[bucket] = (stakes[bucket] ?? 0n) + stakeUnit;
      const result = curveScenarioPayout({
        bucketStakes: stakes,
        positionBucket: bucket,
        positionStake: stakeUnit,
        winningBucket: bucket,
        feeBps: chainState?.market.feeBps ?? 50,
        jackpotBps: chainState?.market.jackpotBps ?? curve.targetJackpotBps,
        jackpotLeverageCap: chainState?.market.jackpotLeverageCap ?? curve.jackpotLeverageCap,
      });
      return { bucket, multiple: Number(result.payout * 100n / stakeUnit) / 100, live };
    });
  })();
  const bestMultiple = bucketMultiples.reduce(
    (best, entry) => (entry.multiple > best.multiple ? entry : best),
    bucketMultiples[0],
  );
  const selectedMultiple = bucketMultiples[selectedBucket]?.multiple ?? 0;
  const selectedBucketStake = bucketStakes[selectedBucket] ?? 0n;
  const status = chainState?.market.status;
  const displayUnit = metricUnit(curve.metric.unit);
  const closeTime = chainState
    ? formatDateTime(chainState.market.closesAt)
    : formatDateTime(curve.metric.observedAt);
  const refreshAll = () => {
    void chainQuery.refetch();
    void portfolioQuery.refetch();
  };

  return <section className={styles.curveShell} aria-labelledby="curve-market-title" data-testid="curve-shell">
    <header className={styles.commandBar}>
      <ScarcityInstrumentTabs active="curve" onCurve={() => undefined} onEvent={onOpenEvents} />
      <button type="button" className={styles.catalogToggle} onClick={() => setCatalogOpen((open) => !open)} aria-expanded={catalogOpen} aria-controls="curve-market-catalog">
        <span>{curveMarket.metal.symbol}</span> {curveMarket.metal.name} · {curve.metric.label}
      </button>
      <div className={styles.commandStatus}>
        <i data-live={Boolean(chainState)} />
        <span>{lifecycleLabel(status, Boolean(chainState))}</span>
      </div>
    </header>

    <div className={styles.curveWorkspace}>
      <aside id="curve-market-catalog" className={`${styles.marketCatalog} ${catalogOpen ? styles.catalogOpen : ""}`} aria-label="Curve forecast markets" data-testid="curve-catalog">
        <div className={styles.catalogHeading}>
          <div><span>Numerical markets</span><strong>{curveMarkets.length} committed curves</strong></div>
          <label><span className={styles.srOnly}>Search curve markets</span><input type="search" placeholder="Search metal" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        </div>
        <div className={styles.catalogList}>
          {filteredMarkets.map((market) => {
            const selected = market.curve?.slug === curve.slug;
            return <button
              type="button"
              key={market.slug}
              className={selected ? styles.marketActive : undefined}
              onClick={() => { onSelect(market.slug); setCatalogOpen(false); }}
              aria-pressed={selected}
            >
              <span className={styles.elementTile}><small>{market.metal.symbol}</small><strong>{market.metal.name}</strong></span>
              <span className={styles.marketDescriptor}><strong>{market.curve?.metric.label}</strong><small>{market.curve?.metric.unit} · resolves {formatDateTime(market.curve?.metric.observedAt ?? market.schedule.resolveAfter)}</small></span>
              <i />
            </button>;
          })}
          {!filteredMarkets.length ? <p className={styles.catalogEmpty}>No numerical curve matches “{query}”.</p> : null}
        </div>
        <footer><span>Curve positions are nontransferable.</span><button type="button" onClick={onOpenVerify}>Rules &amp; evidence</button></footer>
      </aside>

      <main className={styles.marketMain}>
        <div className={styles.marketMiddle} data-testid="curve-middle-scroll">
        <div className={styles.marketIntro}>
        <header className={styles.metricHeader}>
          <div>
            <span>SCX / {curveMarket.metal.symbol} / forecast pool</span>
            <h1 id="curve-market-title">Predict {curveMarket.metal.name}&apos;s final scarcity score.</h1>
            <p>Pick a number from 0 (loose supply) to 100 (tight supply). Closer forecasts earn more of the shared USDC pool; payout minus stake is your profit or loss, and your stake is the most you can lose. The oracle publishes the final {curve.metric.label.toLowerCase()} at <time dateTime={curve.metric.observedAt}>{formatDateTime(curve.metric.observedAt)}</time>.</p>
          </div>
          <dl>
            <div><dt>Latest oracle score</dt><dd>{currentScore === null ? <span className={styles.missingValue}>Awaiting data</span> : <>{metricValue(currentScore, curve.metric.precision)} <small>{displayUnit}</small></>}</dd></div>
            <div><dt>Crowd forecast</dt><dd>{consensusValue === null ? <span className={styles.missingValue}>No pool activity</span> : <>{metricValue(consensusValue, curve.metric.precision)} <small>{displayUnit}</small></>}</dd></div>
            <div><dt>Resolution data</dt><dd>{data?.dataConfidence.grade === "insufficient" || !data ? <span className={styles.missingValue}>Not ready</span> : metricValue(data.dataConfidence.score, 2)}<small>{data?.dataConfidence.grade ?? "unavailable"}</small></dd></div>
          </dl>
        </header>

        <section className={styles.payoutLesson} aria-labelledby="curve-payout-lesson-title">
          <header className={styles.lessonSummary}>
            <div>
              <span><Coins size={14} /> 60-second payout guide</span>
              <h2 id="curve-payout-lesson-title">Closer to the final score earns a larger share.</h2>
              <p>Everyone puts USDC into one pool. After the oracle publishes one final number, the pool is divided by accuracy. Exact forecasts also share the bonus pool.</p>
            </div>
            <aside>
              <CircleAlert size={16} />
              <span><strong>Your maximum loss is your stake.</strong> Hedgents does not fund a yield; profitable forecasts are paid by the shared trader pool. Even an exact forecast can lose if that bucket is crowded.</span>
            </aside>
          </header>

          <details className={styles.lessonDetails}>
            <summary><span>See exactly how the pool pays</span><small>Exact, near and far outcomes</small><ChevronDown size={15} aria-hidden="true" /></summary>
            <div className={styles.payoutFlow} aria-label="Three steps to a curve payout">
              <article><i>1</i><span>Choose</span><strong>{metricValue(snappedForecast, curve.metric.precision)} {displayUnit}</strong><small>Your forecast</small></article>
              <ArrowRight size={16} aria-hidden="true" />
              <article><i>2</i><span>Resolve</span><strong>One final score</strong><small>Published from frozen evidence</small></article>
              <ArrowRight size={16} aria-hidden="true" />
              <article><i>3</i><span>Get paid</span><strong>Accuracy decides</strong><small>Payout minus stake = profit or loss</small></article>
            </div>

            {payoutPreview ? <div className={styles.payoutExamples} aria-live="polite">
              <div className={styles.exampleIntro}>
                <span>{payoutPreview.mode === "live" ? "Live pool preview" : payoutPreview.mode === "closed" ? "Closed market · sample payout model" : "Interactive learning example"}</span>
                <strong>{payoutPreview.isLive && selectedPosition
                  ? `Your position would total ${formatBaseUnits(payoutPreview.positionStake)} USDC after adding ${formatBaseUnits(newStake)} at ${metricValue(snappedForecast, curve.metric.precision)}`
                  : `If you put ${formatBaseUnits(payoutPreview.positionStake)} USDC at ${metricValue(snappedForecast, curve.metric.precision)}`}</strong>
                <small>Move your forecast or change the USDC amount—the examples update instantly.</small>
              </div>
              <div className={styles.exampleScenarios}>
                {payoutPreview.scenarios.map((item) => <article key={item.id} data-result={item.profit > 0n ? "profit" : item.profit < 0n ? "loss" : "flat"}>
                  <span>{item.label}</span>
                  <strong>{item.multiple}</strong>
                  <small>{formatBaseUnits(item.payout)} USDC payout</small>
                  <em>{formatSignedBaseUnits(item.profit)}</em>
                </article>)}
              </div>
              <footer>
                <span>{payoutPreview.mode === "live"
                  ? `Models a ${formatBaseUnits(payoutPreview.pool)} USDC pool after adding your stake.`
                  : payoutPreview.mode === "closed"
                    ? `Sample model only: 5 USDC in each of 41 buckets plus your stake; it does not use the settled pool.`
                    : `Learning example: 5 USDC in each of 41 buckets plus your stake; ${payoutPreview.feeBps / 100}% fee.`}</span>
                <a href="#curve-forecast-ticket">Build this forecast <ArrowRight size={13} /></a>
              </footer>
            </div> : <p className={styles.exampleInvalid}>Enter a USDC amount above zero to see example payouts.</p>}
          </details>
        </section>
        </div>

        <div className={styles.marketAnalysis}>

        <section className={styles.assay} aria-label={`Payout weight and USDC pool distribution across ${curve.bucketCount} ${displayUnit} buckets`}>
          <div className={styles.assayTopline}>
            <div><Crosshair size={14} /><span>Drag your forecast</span><strong>{metricValue(snappedForecast, curve.metric.precision)}</strong><small>{displayUnit}</small></div>
            <div><span>Bucket</span><strong>{String(selectedBucket + 1).padStart(2, "0")}</strong><small>of {curve.bucketCount}</small></div>
          </div>
          <div className={styles.plotLegend}>
            <span><i /> Line = your payout weight by published result</span>
            <span><i /> Bars = USDC staked across the pool</span>
          </div>
          <div className={styles.multipleStrip} aria-label="Payout if each forecast turns out to be exactly right">
            <div className={styles.multipleStripHead}>
              <span>{bucketMultiples[0]?.live ? "If you are exactly right, this bucket pays" : "Sample pool · pays if exactly right"}</span>
              <strong>
                {selectedMultiple.toFixed(2)}× here
                {bestMultiple && bestMultiple.bucket !== selectedBucket ? (
                  <em> · {bestMultiple.multiple.toFixed(2)}× at {normalizedToDisplayValue(
                    curveBucketToNormalized(bestMultiple.bucket, curve.bucketCount),
                    curve.displayRange.minimum,
                    curve.displayRange.maximum,
                  ).toFixed(1)}</em>
                ) : null}
              </strong>
            </div>
            <div className={styles.multipleBars} aria-hidden="true">
              {bucketMultiples.map((entry) => (
                <i
                  key={entry.bucket}
                  data-selected={entry.bucket === selectedBucket}
                  title={`${entry.multiple.toFixed(2)}×`}
                  style={{
                    "--multiple-height": `${Math.max(
                      3,
                      Math.min(100, entry.multiple / Math.max(bestMultiple?.multiple ?? 1, 0.01) * 100),
                    )}%`,
                  } as CSSProperties}
                />
              ))}
            </div>
            <p className={styles.multipleNote}>
              A crowded forecast splits the same pool more ways, so it pays less even when it wins.
              Picking where others have not is what a shared pool rewards.
            </p>
          </div>
          <div className={styles.plot}>
            <svg className={styles.accuracyTrace} viewBox="0 0 1000 220" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--metal-tone)" stopOpacity=".18" />
                  <stop offset="1" stopColor="var(--metal-tone)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={`0,210 ${accuracyPoints} 1000,210`} fill="url(#curve-fill)" />
              <polyline points={accuracyPoints} fill="none" stroke="var(--metal-tone)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className={styles.histogram} aria-hidden="true">
              {bucketStakes.map((amount, bucket) => {
                const height = maxBucketStake === 0n ? 3 : Math.max(3, Number(amount * 8_000n / maxBucketStake) / 100);
                return <i key={bucket} data-selected={bucket === selectedBucket} style={{ "--bar-height": `${height}%` } as CSSProperties} />;
              })}
            </div>
            {currentPercent !== null ? <span className={`${styles.needle} ${styles.currentNeedle}`} style={{ left: `${currentPercent}%` }}><i /><small>Oracle</small></span> : null}
            {consensusPercent !== null ? <span className={`${styles.needle} ${styles.consensusNeedle}`} style={{ left: `${consensusPercent}%` }}><i /><small>Pool</small></span> : null}
            <span className={`${styles.needle} ${styles.forecastNeedle}`} style={{ left: `${selectedPercent}%` }}><i /><small>You</small></span>
          </div>
          <div className={styles.axis} aria-hidden="true">
            <span><strong>{curve.displayRange.minimum}</strong><small>Loose</small></span>
            <span><strong>{curve.displayRange.midpoint}</strong><small>Neutral</small></span>
            <span><strong>{curve.displayRange.maximum}</strong><small>Tight</small></span>
          </div>
          <label className={styles.forecastControl}>
            <span className={styles.srOnly}>Your forecast in {displayUnit}</span>
            <input
              type="range"
              min={curve.displayRange.minimum}
              max={curve.displayRange.maximum}
              step={(curve.displayRange.maximum - curve.displayRange.minimum) / (curve.bucketCount - 1)}
              value={snappedForecast}
              onChange={(event) => setForecast(Number(event.target.value))}
              aria-valuetext={`${metricValue(snappedForecast, curve.metric.precision)} ${displayUnit}, bucket ${selectedBucket + 1} of ${curve.bucketCount}`}
            />
          </label>
        </section>

        <div className={styles.readoutGrid}>
          <article><span><CircleDollarSign size={14} /> {chainState ? status === "unresolved" ? "Live USDC pool" : "Settled onchain pool" : "Demo USDC pool"}</span><strong>{chainState ? `${formatBaseUnits(poolStake)} USDC` : payoutPreview ? `${formatBaseUnits(payoutPreview.pool)} demo` : "—"}</strong><small>{chainState ? `${formatBaseUnits(selectedBucketStake)} USDC at your forecast` : "Illustrative pool—not a live quote"}</small></article>
          <article><span><Target size={14} /> New USDC at risk</span><strong>{newStake > 0n ? `${formatBaseUnits(newStake)} USDC` : "—"}</strong><small>{payoutPreview?.isLive && selectedPosition ? `Total position after this order: ${formatBaseUnits(payoutPreview.positionStake)} USDC` : "You can withdraw before close; after close this stake is at risk."}</small></article>
          <article><span><TrendingUp size={14} /> Total payout if exact</span><strong>{exactPreview ? `${formatBaseUnits(exactPreview.payout)} USDC` : "—"}</strong><small>{exactPreview ? `${formatSignedBaseUnits(exactPreview.profit)} total P/L in this ${payoutPreview?.mode === "live" ? "live preview" : "sample model"}` : "Enter a stake to preview"}</small></article>
          <article><span><Timer size={14} /> Forecast closes</span><strong>{closeTime.split(",")[0]}</strong><small>{closeTime}</small></article>
        </div>

        <details className={styles.mechanics}>
          <summary><span>What happens after you stake</span><small>Fully collateralized · no leverage</small><ChevronDown size={14} aria-hidden="true" /></summary>
          <div>
            <article><i>01</i><strong>Stake behind one number</strong><p>Your USDC joins the shared pool at the nearest score bucket.</p></article>
            <article><i>02</i><strong>The oracle sets the result</strong><p>A frozen source report produces one auditable final score.</p></article>
            <article><i>03</i><strong>Closer forecasts take more</strong><p>The remaining pool is paid by accuracy; exact forecasts also split the bonus.</p></article>
          </div>
          <p className={styles.poolTruth}><Database size={14} /> {curveMarket.sources[0]?.publisher ?? "Hedgents"} evidence is committed before trading. If valid evidence cannot produce the score, every position receives a one-for-one refund.</p>
        </details>

        {ownerPositions.length ? <section className={styles.positionStrip} aria-labelledby="curve-position-title">
          <header><div><WalletCards size={15} /><span id="curve-position-title">Your forecasts in this market</span></div><button type="button" onClick={refreshAll} disabled={portfolioQuery.isFetching}><RefreshCw size={13} /> Refresh</button></header>
          <div>{ownerPositions.map((position) => {
            const value = normalizedToDisplayValue(curveBucketToNormalized(position.bucket, position.bucketCount), curve.displayRange.minimum, curve.displayRange.maximum);
            return <article key={`${position.market}-${position.bucket}`} data-selected={position.bucket === selectedBucket}>
              <span><strong>{metricValue(value, curve.metric.precision)}</strong><small>{displayUnit} · bucket {position.bucket + 1}</small></span>
              <span><strong>{formatBaseUnits(position.stake)}</strong><small>USDC staked</small></span>
              <span><strong>{position.claimed ? "Claimed" : position.status === "unresolved" ? "Open" : `${formatBaseUnits(position.claimable)} USDC`}</strong><small>{position.claimed ? "Position settled" : position.status === "unresolved" ? "Withdrawable before close" : "Claimable"}</small></span>
              <button type="button" onClick={() => setForecast(value)}>Select</button>
            </article>;
          })}</div>
        </section> : null}
        </div>
        </div>

      <aside className={styles.forecastTicket} id="curve-forecast-ticket" data-testid="curve-ticket">
        <div className={styles.ticketHeader}>
          <div><span>Build your forecast</span><strong>{curveMarket.metal.symbol} · {curve.metric.label}</strong></div>
          <em>{chainState ? chainState.deployment.cluster.replace("-beta", "") : "learning mode"}</em>
        </div>
        <p className={styles.ticketPrinciple}><Coins size={14} /><span><strong>Closer earns more.</strong> Your stake is the most you can lose.</span></p>
        <label className={styles.valueInput}>
          <span>1. Your forecast score</span>
          <div><input
            type="number"
            min={curve.displayRange.minimum}
            max={curve.displayRange.maximum}
            step={(curve.displayRange.maximum - curve.displayRange.minimum) / (curve.bucketCount - 1)}
            value={snappedForecast}
            onChange={(event) => setForecast(Number(event.target.value))}
          /><strong>{displayUnit}</strong></div>
          <small>0 = loose supply · 100 = tight supply · bucket {selectedBucket + 1} of {curve.bucketCount}</small>
        </label>
        <label className={styles.valueInput}>
          <span>2. USDC at risk</span>
          <div><input type="text" inputMode="decimal" value={stake} onChange={(event) => setStake(event.target.value)} /><strong>USDC</strong></div>
          <small>{selectedPosition ? `${formatBaseUnits(selectedPosition.stake)} USDC already at this score` : "This is the most you can lose; withdraw before the pool closes"}</small>
        </label>
        <dl className={styles.ticketMath}>
          <div><dt>Total position after order</dt><dd>{payoutPreview ? `${formatBaseUnits(payoutPreview.positionStake)} USDC` : "—"}</dd></div>
          <div><dt>Total payout if exact</dt><dd>{exactPreview ? `${formatBaseUnits(exactPreview.payout)} USDC` : "—"} <small>{exactPreview?.multiple ?? ""}</small></dd></div>
          <div><dt>Total P/L if exact</dt><dd data-result={exactPreview ? exactPreview.profit > 0n ? "profit" : exactPreview.profit < 0n ? "loss" : "flat" : "flat"}>{exactPreview ? formatSignedBaseUnits(exactPreview.profit) : "—"}</dd></div>
        </dl>

        {chainState ? <div className={styles.ticketActions} aria-live="polite">
          {status === "unresolved" ? <>
            <ScarcityCurveStakeAction
              state={chainState}
              marketId={curve.marketId}
              bucket={selectedBucket}
              amount={stake}
              hasPosition={Boolean(selectedPosition)}
              displayValue={metricValue(snappedForecast, curve.metric.precision)}
              unit={displayUnit}
              onConnect={onConnect}
              onConfirmed={refreshAll}
            />
            {selectedPosition && BigInt(selectedPosition.stake) > 0n ? <ScarcityCurveWithdrawAction
              state={chainState}
              marketId={curve.marketId}
              bucket={selectedBucket}
              amount={stake}
              displayValue={metricValue(snappedForecast, curve.metric.precision)}
              unit={displayUnit}
              onConnect={onConnect}
              onConfirmed={refreshAll}
            /> : null}
          </> : selectedPosition && !selectedPosition.claimed ? <ScarcityCurveClaimAction
            state={chainState}
            marketId={curve.marketId}
            bucket={selectedBucket}
            stake={selectedPosition.stake}
            claimable={selectedPosition.claimable}
            displayValue={metricValue(snappedForecast, curve.metric.precision)}
            unit={displayUnit}
            onConnect={onConnect}
            onConfirmed={refreshAll}
          /> : <p className={styles.noPosition}>No unclaimed position at this forecast.</p>}
        </div> : <div className={styles.researchGate}>
          <LockKeyhole size={20} />
          <div><strong>Practice mode · no funds move</strong><span>Change the score and USDC amount to learn the payout. Wallet actions appear only after a verified Solana pool opens.</span></div>
          <button type="button" onClick={onOpenVerify}>Open rules &amp; evidence <ArrowRight size={13} /></button>
        </div>}

        <details className={styles.ticketDetails}>
          <summary><span>Payout assumptions + pool safety</span><ChevronDown size={14} aria-hidden="true" /></summary>
          <div>
            <dl><div><dt>10 away: payout · P/L</dt><dd data-result={farPreview ? farPreview.profit > 0n ? "profit" : farPreview.profit < 0n ? "loss" : "flat" : "flat"}>{farPreview ? `${formatBaseUnits(farPreview.payout)} · ${formatSignedBaseUnits(farPreview.profit)}` : "—"}</dd></div></dl>
            <p className={styles.scenarioNotice}>{payoutPreview?.mode === "live"
              ? "Live total-position preview only. Other stakes can change your payout until the pool closes."
              : payoutPreview?.mode === "closed"
                ? "Closed market—sample payout model only. It is separate from the settled onchain pool."
                : "Learning example only—not a quote. Live payout depends on the final pool, your accuracy, and the protocol fee."}</p>
            <div className={styles.custodyNote}><ShieldCheck size={16} /><span><strong>What protects the pool.</strong> Stakes stay in the Solana program vault. Positions are nontransferable; invalid markets refund one-for-one.</span></div>
          </div>
        </details>
      </aside>
      </main>
    </div>
  </section>;
}
