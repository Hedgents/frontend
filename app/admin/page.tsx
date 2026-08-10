import { cookies } from "next/headers";
import Image from "next/image";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, verifyAccessSession } from "@/lib/access-auth";
import { getAnalyticsSnapshot, type AnalyticsSnapshot } from "@/lib/analytics-store";
import { LogoutButton } from "./LogoutButton";
import { InviteManager } from "./InviteManager";
import { ScarcityMarketManager } from "./ScarcityMarketManager";
import { ScarcityDataManager } from "./ScarcityDataManager";
import { OnlineDetectorManager } from "./OnlineDetectorManager";
import { loadScarcityMarketCatalog } from "@/lib/scarcity-market-store";
import { loadScarcityOperatorConfig } from "@/lib/scarcity-operator";
import { scarcityDataStorageConfigured } from "@/lib/scarcity-data-store";
import styles from "./admin.module.css";
import { getBetaReadiness, type ReadinessCheck } from "@/lib/beta-readiness";

export const dynamic = "force-dynamic";

function percent(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

function fallbackSnapshot(days: number): AnalyticsSnapshot {
  return {
    generatedAt: new Date().toISOString(), rangeDays: days, storageConfigured: false, truncated: false,
    totalEvents: 0, uniqueSessions: 0,
    metrics: { inviteRedemptions: 0, quotesReady: 0, ordersSubmitted: 0, ordersConfirmed: 0, failures: 0, quoteToSubmitPct: null, submitToConfirmPct: null },
    eventCounts: {}, topProducts: [], topMetals: [], recentEvents: [],
  };
}

function Ranking({ rows }: { rows: Array<{ label: string; count: number }> }) {
  if (!rows.length) return <p className={styles.empty}>No consented product activity in this range.</p>;
  const maximum = Math.max(...rows.map((row) => row.count));
  return <div className={styles.ranking}>{rows.map((row) => (
    <div className={styles.rank} key={row.label}>
      <div className={styles.rankBody}>
        <span className={styles.rankBar} style={{ width: `${Math.max(8, row.count / maximum * 100)}%` }} />
        <span className={styles.rankLabel}>{row.label}</span>
      </div>
      <span className={styles.rankCount}>{row.count}</span>
    </div>
  ))}</div>;
}

function ReadinessEntry({ entry }: { entry: ReadinessCheck }) {
  return (
    <article className={entry.status === "ready" ? styles.readinessReady : entry.status === "blocked" ? styles.readinessBlocked : styles.readinessPending}>
      <i aria-hidden="true" />
      <span><strong>{entry.label}</strong><small>{entry.detail}</small></span>
      <em>{entry.status}</em>
    </article>
  );
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const cookieStore = await cookies();
  if (!verifyAccessSession(cookieStore.get(ADMIN_COOKIE)?.value, "admin")) redirect("/admin/login");
  const requestedDays = Number((await searchParams).days);
  const days = requestedDays === 30 ? 30 : 7;
  const [snapshot, readiness, scarcityCatalog] = await Promise.all([
    getAnalyticsSnapshot(days).catch(() => fallbackSnapshot(days)),
    getBetaReadiness(),
    loadScarcityMarketCatalog(),
  ]);
  const cards = [
    ["Invite entries", snapshot.metrics.inviteRedemptions],
    ["Anonymous sessions", snapshot.uniqueSessions],
    ["Quotes ready", snapshot.metrics.quotesReady],
    ["Orders submitted", snapshot.metrics.ordersSubmitted],
    ["Confirmed", snapshot.metrics.ordersConfirmed],
    ["Submit → confirm", percent(snapshot.metrics.submitToConfirmPct)],
  ];
  const scarcityMarkets = scarcityCatalog.map((market) => ({
    slug: market.question.slug,
    title: market.question.title,
    metal: market.question.metal,
    marketId: market.marketId,
    questionHash: market.questionHash,
    rulesHash: market.rulesHash,
    question: market.question,
    rules: market.rules,
  }));
  const scarcityOperator = loadScarcityOperatorConfig();
  const scarcityStorageReady = scarcityDataStorageConfigured();
  const readinessActions = readiness.checks
    .filter((entry) => entry.status !== "ready")
    .sort((left, right) => Number(left.status === "external") - Number(right.status === "external"));
  const readinessComplete = readiness.checks.filter((entry) => entry.status === "ready");
  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Image className={styles.mark} src="/brand/hedgents-source-app-icon.png" alt="" width={330} height={330} />
          <div><strong>Hedgents operator</strong><span>Anonymous beta intelligence</span></div>
        </div>
        <LogoutButton />
      </header>
      <section className={styles.heading}>
        <div><p className={styles.kicker}>Terminal / analytics</p><h1>Execution funnel</h1></div>
        <div className={styles.headingMeta}>Updated {new Date(snapshot.generatedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC<br />{snapshot.totalEvents} events in the selected range</div>
      </section>
      {!snapshot.storageConfigured ? <div className={styles.notice}>Private analytics storage is not connected in this environment. The terminal remains operational, but this dashboard cannot retain events.</div> : null}
      {snapshot.truncated ? <div className={styles.notice}>This view reached its 20,000-event safety bound. Export or archive older telemetry before treating these totals as complete.</div> : null}
      <nav className={styles.range} aria-label="Analytics range">
        <a className={days === 7 ? styles.active : ""} href="/admin?days=7">7 days</a>
        <a className={days === 30 ? styles.active : ""} href="/admin?days=30">30 days</a>
        <a className={styles.refresh} href={`/admin?days=${days}`}>Refresh</a>
      </nav>
      <nav className={styles.sectionNav} aria-label="Operator sections"><a href="#readiness">Readiness</a><a href="#analytics">Analytics</a><a href="#scarcity-markets">Markets</a><a href="#online-detector">Detector</a><a href="#scarcity-data-publication">Evidence</a><a href="#beta-invitations">Invites</a></nav>
      <section className={styles.readinessPanel} id="readiness" aria-labelledby="readiness-title">
        <header><div><p className={styles.kicker}>Release control</p><h2 id="readiness-title">Beta readiness</h2></div><strong>{readiness.ready} ready · {readiness.blocked} blocked · {readiness.external} external</strong></header>
        <div className={styles.readinessQueueHeader}><div><strong>Action queue</strong><small>Blocking configuration first, then work dependent on external review or infrastructure.</small></div><span>{readinessActions.length} open</span></div>
        {readinessActions.length ? <div className={styles.readinessQueue}>{readinessActions.map((entry) => <ReadinessEntry entry={entry} key={entry.id} />)}</div> : <p className={styles.readinessClear}>No beta readiness actions are open.</p>}
        {readinessComplete.length ? <details className={styles.readinessComplete}>
          <summary><span>Completed checks</span><strong>{readinessComplete.length} satisfied</strong></summary>
          <div>{readinessComplete.map((entry) => <ReadinessEntry entry={entry} key={entry.id} />)}</div>
        </details> : null}
      </section>
      <section className={styles.metrics} id="analytics">{cards.map(([label, value]) => <div className={styles.metric} key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
      <ScarcityMarketManager markets={scarcityMarkets} operator={scarcityOperator} durableStorage={scarcityStorageReady} />
      <OnlineDetectorManager durableStorage={scarcityStorageReady} />
      <ScarcityDataManager durableStorage={scarcityStorageReady} />
      <InviteManager />
      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>Recent signal</h2>
          {snapshot.recentEvents.length ? <div className={styles.eventRows}>{snapshot.recentEvents.map((event, index) => (
            <div className={styles.event} key={`${event.occurredAt}-${event.name}-${index}`}>
              <time>{new Date(event.occurredAt).toLocaleString("en-GB", { timeZone: "UTC", hour12: false })}</time>
              <strong>{event.name.replaceAll("_", " ")}</strong>
              <code>{Object.entries(event.properties).map(([key, value]) => `${key}:${value}`).join(" · ") || "anonymous"}</code>
            </div>
          ))}</div> : <p className={styles.empty}>No events yet. Successful invite entry and consented terminal diagnostics will appear here.</p>}
        </section>
        <aside className={styles.card}>
          <h2>Market interest</h2>
          <p className={styles.sectionLabel}>Products</p><Ranking rows={snapshot.topProducts} />
          <p className={styles.sectionLabel}>Metals</p><Ranking rows={snapshot.topMetals} />
          <p className={styles.sectionLabel}>Reliability</p>
          <div className={styles.metrics} style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className={styles.metric}><span>Failures</span><strong>{snapshot.metrics.failures}</strong></div>
            <div className={styles.metric}><span>Quote → submit</span><strong>{percent(snapshot.metrics.quoteToSubmitPct)}</strong></div>
          </div>
        </aside>
      </div>
      <p className={styles.privacy}>Privacy boundary: events contain an irreversible anonymous session hash and allowlisted funnel metadata only. Wallet addresses, balances, signed transactions, eligibility evidence, IP addresses, and plaintext invite codes are never written to analytics storage.</p>
    </main>
  );
}
