"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  Braces,
  Check,
  ChevronDown,
  Copy,
  Database,
  Download,
  FlaskConical,
  LockKeyhole,
  Search,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Unplug,
  UserCheck,
  WalletCards,
  X,
} from "lucide-react";
import {
  useConnect as useSolanaConnect,
  useConnectedWallet,
  useDisconnect as useSolanaDisconnect,
  useWalletStatus,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import { useClient } from "@solana/react";
import type { AppSolanaClient } from "@/app/providers";
import {
  ScarcityOrderCancel,
  ScarcityOrderFill,
  ScarcityOrderSubmit,
  ScarcityRedeemAction,
  ScarcitySetAction,
  ScarcityTransactionRecovery,
} from "./ScarcityWalletActions";
import { ScarcityOracle } from "./ScarcityOracle";
import { MetalPulse } from "./MetalPulse";
import { PulseMarket } from "./PulseMarket";
import { ScarcityCurveMarket } from "./ScarcityCurveMarket";
import { ScarcityInstrumentTabs } from "./ScarcityInstrumentTabs";
import {
  useScarcityCurvePortfolio,
  useScarcityMarketState,
  useScarcityPortfolio,
  useScarcityData,
  type ScarcityBookOrder,
} from "@/hooks/use-scarcity-exchange";
import { getPeriodicElement } from "@/lib/scarcity/periodic-table";
import styles from "./scarcity-exchange.module.css";

export type ScarcityMarket = {
  slug: string;
  marketId: string;
  questionHash: string;
  rulesHash: string;
  canonicalQuestion: string;
  canonicalRules: string;
  title: string;
  question: string;
  metal: { id: string; symbol: string; name: string };
  marketKind: "data" | "event";
  category: "price-data" | "supply-projects" | "policy" | "science";
  resolutionTarget: {
    kind: "data";
    metricId: string;
    metricLabel: string;
    methodologyVersion: string;
    unit: string;
    comparator: "greater-than-or-equal" | "less-than-or-equal";
    threshold: number;
    observedAt: string;
    precision: number;
  } | {
    kind: "event";
    eventLabel: string;
    qualifyingOutcome: string;
    resolvesAt: string;
    resolverLabel: string;
  } | {
    // A scalar curve round settles on a continuous value, so it has no comparator and no threshold.
    // Giving it the data shape would mean displaying a threshold that does not exist.
    kind: "curve";
    metricId: string;
    metricLabel: string;
    methodologyVersion: string;
    unit: string;
    observedAt: string;
    precision: number;
  };
  sources: Array<{ id: string; publisher: string; title: string; url: string; cadence: string }>;
  schedule: { opensAt: string; closesAt: string; resolveAfter: string };
  lifecycle: string;
  publication: string;
  warning: string | null;
  curve: null | {
    slug: string;
    marketId: string;
    metricHash: string;
    rulesHash: string;
    canonicalMetric: string;
    canonicalRules: string;
    title: string;
    metric: {
      id: string;
      label: string;
      methodologyVersion: string;
      unit: string;
      observedAt: string;
      precision: number;
    };
    displayRange: { minimum: number; midpoint: number; maximum: number };
    bucketCount: number;
    targetJackpotBps: number;
    jackpotLeverageCap: number;
    /** True only when a round for this curve exists on chain. Specifications are not tradeable. */
    deployed: boolean;
  };
};

export type ScarcityView = "oracle" | "markets" | "pulse" | "evidence";
type ScarcityInstrument = "curve" | "event";

const scarcityNavigation: Array<{ view: ScarcityView; label: string }> = [
  { view: "oracle", label: "Intelligence" },
  { view: "markets", label: "Trade" },
  { view: "pulse", label: "Price market" },
];

const scarcityViews = new Set<ScarcityView>(["oracle", "markets", "pulse", "evidence"]);

const metalVisuals: Record<string, { atomic: string; tone: string; position: string }> = {
  gold: { atomic: "79", tone: "#d8b458", position: "11 · 6" },
  silver: { atomic: "47", tone: "#c9d0d0", position: "11 · 5" },
  copper: { atomic: "29", tone: "#d17c50", position: "11 · 4" },
  uranium: { atomic: "92", tone: "#a9cf58", position: "actinide" },
  cobalt: { atomic: "27", tone: "#77a7ce", position: "9 · 4" },
  lithium: { atomic: "3", tone: "#d7d2c7", position: "1 · 2" },
  platinum: { atomic: "78", tone: "#aeb6bd", position: "10 · 6" },
  palladium: { atomic: "46", tone: "#b6a7c7", position: "10 · 5" },
};

const categoryTones: Record<string, string> = {
  "alkali-metal": "#c7ad75",
  "alkaline-earth-metal": "#c9bfa4",
  "transition-metal": "#aeb8bf",
  "post-transition-metal": "#93a6aa",
  lanthanide: "#b08d70",
  actinide: "#8ea66f",
  metalloid: "#8fa6a0",
  "reactive-nonmetal": "#a6aaa4",
  halogen: "#94a8aa",
  "noble-gas": "#a39aae",
};

function visualForMetal(metal: ScarcityMarket["metal"]) {
  const custom = metalVisuals[metal.id];
  if (custom) return custom;
  const element = getPeriodicElement(metal.symbol) ?? getPeriodicElement(metal.name);
  return {
    atomic: element ? String(element.atomicNumber) : "—",
    tone: element ? categoryTones[element.category] ?? "#aeb8bf" : "#aeb8bf",
    position: element
      ? element.group === null ? element.category.replace("-", " ") : `${element.group} · ${element.period}`
      : "reference",
  };
}

function shortHash(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function shortAddress(value: string) {
  return `${value.slice(0, 5)}…${value.slice(-4)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function humanizeQuestion(value: string) {
  return value.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g, (date) => formatDateTime(date));
}

function isZeroHash(value: string | undefined) {
  return !value || /^0+$/.test(value);
}

function exactUsdc(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function baseUnits(value: string | undefined, decimals = 6) {
  if (!value || !/^\d+$/.test(value)) return "—";
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction.slice(0, 4)}` : whole;
}

function centsFromMicro(value: string) {
  return (Number(value) / 10_000).toFixed(2);
}

function PortfolioOrderCancel(props: {
  order: ScarcityBookOrder & { slug: string };
  marketId: string;
  onConfirmed: () => void;
}) {
  const chainQuery = useScarcityMarketState(props.order.slug);
  if (!chainQuery.data?.state) return <span>Unavailable</span>;
  return (
    <ScarcityOrderCancel
      state={chainQuery.data.state}
      marketId={props.marketId}
      order={props.order}
      onConfirmed={() => { void chainQuery.refetch(); props.onConfirmed(); }}
    />
  );
}

export function ScarcityPortfolioPanel({
  markets,
  owner,
  onOpenScarcity,
}: {
  markets: ScarcityMarket[];
  owner: string | null;
  onOpenScarcity: () => void;
}) {
  const portfolioQuery = useScarcityPortfolio(owner, Boolean(owner));
  const curvePortfolioQuery = useScarcityCurvePortfolio(owner, Boolean(owner));
  const portfolioReady = Boolean(owner && portfolioQuery.data?.deployment);
  const curvePortfolioReady = Boolean(owner && curvePortfolioQuery.data?.deployment);
  const heldPositions = portfolioQuery.data?.positions.filter((position) =>
    BigInt(position.yes || "0") > 0n || BigInt(position.no || "0") > 0n || BigInt(position.claimable || "0") > 0n,
  ) ?? [];
  const curvePositions = curvePortfolioQuery.data?.positions.filter((position) =>
    BigInt(position.stake || "0") > 0n || BigInt(position.claimable || "0") > 0n,
  ) ?? [];
  const totalClaimable = BigInt(portfolioQuery.data?.totals.claimable || "0")
    + BigInt(curvePortfolioQuery.data?.totals.claimable || "0");

  return (
    <section className={styles.portfolioEmbed} aria-labelledby="scarcity-portfolio-title">
      <header className={styles.portfolioEmbedHeader}>
        <div>
          <span>02 / Scarcity trading</span>
          <h2 id="scarcity-portfolio-title">Scarcity positions</h2>
          <p>Curve forecasts and event markets read from the same connected Solana wallet.</p>
        </div>
        <div>
          {owner ? <>
            <button type="button" onClick={() => { void portfolioQuery.refetch(); void curvePortfolioQuery.refetch(); }} disabled={portfolioQuery.isFetching || curvePortfolioQuery.isFetching}>{portfolioQuery.isFetching || curvePortfolioQuery.isFetching ? "Refreshing" : "Refresh"}</button>
            <button type="button" onClick={onOpenScarcity}>Open scarcity <ArrowRight size={13} /></button>
          </> : <span className={styles.portfolioAwaiting}>Shared wallet not connected</span>}
        </div>
      </header>

      {portfolioReady || curvePortfolioReady ? <>
        <div className={styles.portfolioMetrics}>
          <article><span>Active positions</span><strong>{heldPositions.length + curvePositions.length}</strong><small>Numerical forecasts + event markets</small></article>
          <article><span>Wallet USDC</span><strong>{baseUnits(portfolioQuery.data?.totals.collateralBalance)}</strong><small>Settlement collateral available</small></article>
          <article><span>USDC committed</span><strong>{baseUnits((BigInt(portfolioQuery.data?.totals.usdcEscrow || "0") + BigInt(curvePortfolioQuery.data?.totals.totalStaked || "0")).toString())}</strong><small>Open event orders + curve stakes</small></article>
          <article><span>Claimable</span><strong>{baseUnits(totalClaimable.toString())}</strong><small>Resolved forecasts and contracts</small></article>
        </div>
        {curvePositions.length ? <div className={styles.curvePositionLedger}>
          <header><span>Curve forecasts</span><small>Nontransferable onchain positions</small></header>
          {curvePositions.map((position) => {
            const market = markets.find((candidate) => candidate.curve?.slug === position.slug || candidate.slug === position.slug);
            if (!market?.curve) return null;
            const normalized = -1_000_000 + Math.round(position.bucket * 2_000_000 / Math.max(1, position.bucketCount - 1));
            const value = market.curve.displayRange.minimum + (normalized + 1_000_000) / 2_000_000 * (market.curve.displayRange.maximum - market.curve.displayRange.minimum);
            return <div key={`${position.market}-${position.bucket}`}>
              <span><i style={{ background: visualForMetal(market.metal).tone }} /><strong>{market.metal.symbol}</strong><small>{market.curve.metric.label}</small></span>
              <span><strong>{value.toFixed(Math.min(market.curve.metric.precision, 2))}</strong><small>{market.curve.metric.unit} · bucket {position.bucket + 1}</small></span>
              <span><strong>{baseUnits(position.stake)}</strong><small>USDC staked</small></span>
              <span><strong>{position.status === "unresolved" ? "Open" : position.claimed ? "Claimed" : baseUnits(position.claimable)}</strong><small>{position.status === "unresolved" ? "Forecast active" : position.claimed ? "Settled" : "USDC claimable"}</small></span>
            </div>;
          })}
        </div> : null}
        <div className={styles.positionLedger}>
          <div className={styles.ledgerHeader}><span>Event market</span><span>YES</span><span>NO</span><span>Orders</span><span>Claim</span></div>
          {markets.map((market) => {
            const position = portfolioQuery.data?.positions.find((candidate) => candidate.slug === market.slug);
            const tone = metalVisuals[market.metal.id]?.tone ?? "#cf9e47";
            return (
              <div className={styles.ledgerRow} key={market.slug}>
                <div><i style={{ background: tone }} /><strong>{market.metal.symbol}</strong><span>{market.title}</span></div>
                <span>{baseUnits(position?.yes)}</span><span>{baseUnits(position?.no)}</span><span>{portfolioQuery.data?.orders.filter((order) => order.slug === market.slug).length ?? 0}</span><span>{baseUnits(position?.claimable)}</span>
              </div>
            );
          })}
        </div>
      </> : null}

      {(!portfolioReady && !curvePortfolioReady) || heldPositions.length + curvePositions.length === 0 ? <div className={styles.portfolioEmpty}>
        <WalletCards size={22} />
        <div>
          <strong>{portfolioQuery.isLoading || curvePortfolioQuery.isLoading ? "Reading scarcity accounts…" : portfolioQuery.error instanceof Error ? portfolioQuery.error.message : curvePortfolioQuery.error instanceof Error ? curvePortfolioQuery.error.message : portfolioReady || curvePortfolioReady ? heldPositions.length + curvePositions.length ? "Scarcity positions indexed from Solana." : "No scarcity positions in this wallet yet." : owner ? "No verified Scarcity Exchange deployment is configured." : "Connect once to read both sides of your portfolio."}</strong>
          <span>Hedgents does not keep a private balance ledger. Token inventory, outcome balances, collateral, and escrow remain wallet-derived.</span>
        </div>
        {!owner ? <span className={styles.portfolioUnavailable}>Connect above once</span> : <span className={styles.portfolioUnavailable}>{portfolioReady || curvePortfolioReady ? `${shortAddress(owner)} · onchain` : "Opens with deployment"}</span>}
      </div> : null}

      {portfolioQuery.data?.orders.length ? <div className={styles.openOrderLedger}>
        <header><span>Scarcity open orders</span><small>Escrow can always be reclaimed by the maker.</small></header>
        {portfolioQuery.data.orders.map((order) => {
          const market = markets.find((candidate) => candidate.slug === order.slug);
          if (!market) return null;
          return <div key={order.address}>
            <span><strong>{market.metal.symbol} {order.outcome.toUpperCase()}</strong><small>{order.side} · {centsFromMicro(order.priceMicroUsdc)}¢ · {order.state ?? "open"}</small></span>
            <span>{baseUnits(order.remainingQuantity)} contracts</span>
            <PortfolioOrderCancel order={order} marketId={market.marketId} onConfirmed={() => void portfolioQuery.refetch()} />
          </div>;
        })}
      </div> : null}
    </section>
  );
}

export function ScarcityExchange({ markets, defaultDataset, initialView = "markets" }: { markets: ScarcityMarket[]; defaultDataset?: string; initialView?: ScarcityView }) {
  const solanaClient = useClient<AppSolanaClient>();
  const solanaWallets = useWallets(solanaClient);
  const solanaStatus = useWalletStatus(solanaClient);
  const solanaConnected = useConnectedWallet(solanaClient);
  const solanaConnect = useSolanaConnect(solanaClient);
  const solanaDisconnect = useSolanaDisconnect(solanaClient);
  const defaultMarketSlug = markets.find((market) => market.metal.id === "copper")?.slug ?? markets[0]?.slug;
  const [activeSlug, setActiveSlug] = useState(defaultMarketSlug);
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [price, setPrice] = useState("50");
  const [quantity, setQuantity] = useState("10");
  const [walletOpen, setWalletOpen] = useState(false);
  const [view, setView] = useState<ScarcityView>(initialView);
  const [instrument, setInstrument] = useState<ScarcityInstrument>("curve");
  const [ticketOpenMobile, setTicketOpenMobile] = useState(false);
  const [verificationState, setVerificationState] = useState<"idle" | "checking" | "verified" | "mismatch">("idle");
  const [marketQuery, setMarketQuery] = useState("");
  const [copiedDocument, setCopiedDocument] = useState<"question" | "rules" | null>(null);

  const active = markets.find((market) => market.slug === activeSlug) ?? markets[0];
  const curveEvidence = instrument === "curve" ? active.curve : null;
  const evidenceMarketId = curveEvidence?.marketId ?? active.marketId;
  const evidencePrimaryHash = curveEvidence?.metricHash ?? active.questionHash;
  const evidenceRulesHash = curveEvidence?.rulesHash ?? active.rulesHash;
  const evidencePrimaryDocument = curveEvidence?.canonicalMetric ?? active.canonicalQuestion;
  const evidenceRulesDocument = curveEvidence?.canonicalRules ?? active.canonicalRules;
  const dataResolution = active.resolutionTarget.kind === "data" ? active.resolutionTarget : null;
  const eventResolution = active.resolutionTarget.kind === "event" ? active.resolutionTarget : null;
  const chainQuery = useScarcityMarketState(active.slug);
  const scarcityDataQuery = useScarcityData(active.metal.id, defaultDataset);
  const chainState = chainQuery.data?.state ?? null;
  const ownerAddress = solanaConnected?.account.address ?? null;
  const portfolioQuery = useScarcityPortfolio(ownerAddress, Boolean(chainState));
  const visual = visualForMetal(active.metal);
  const priceNumber = Math.min(100, Math.max(0, Number(price) || 0));
  const quantityNumber = Math.max(0, Number(quantity) || 0);
  const notional = (priceNumber / 100) * quantityNumber;
  const feeBps = chainState?.deployment.tradingFeeBps ?? 50;
  const fee = notional * (feeBps / 10_000);
  const possiblePayout = quantityNumber;
  const activeStyle = {
    "--metal-tone": view === "pulse" ? metalVisuals.gold.tone : visual.tone,
  } as CSSProperties;
  const marketCount = markets.length;
  const filteredMarkets = useMemo(() => {
    const normalized = marketQuery.trim().toLowerCase();
    if (!normalized) return markets;
    return markets.filter((market) =>
      `${market.metal.symbol} ${market.metal.name} ${market.title} ${market.question}`.toLowerCase().includes(normalized),
    );
  }, [marketQuery, markets]);
  const featuredMarkets = useMemo(() => {
    const candidates = marketQuery ? filteredMarkets : markets;
    const selected = candidates.find((market) => market.slug === active.slug) ?? candidates[0] ?? active;
    return [selected, ...candidates.filter((market) => market.slug !== selected.slug)].slice(0, 3);
  }, [active, filteredMarkets, marketQuery, markets]);
  const visibleOrders = useMemo(
    () => chainState?.orders.filter((order) => order.outcome === outcome.toLowerCase()) ?? [],
    [chainState?.orders, outcome],
  );
  const bestBid = visibleOrders.find((order) => order.side === "bid");
  const bestAsk = visibleOrders.find((order) => order.side === "ask");
  const midpoint = bestBid && bestAsk
    ? (Number(bestBid.priceMicroUsdc) + Number(bestAsk.priceMicroUsdc)) / 20_000
    : bestBid ? Number(bestBid.priceMicroUsdc) / 10_000 : bestAsk ? Number(bestAsk.priceMicroUsdc) / 10_000 : null;
  const activePosition = portfolioQuery.data?.positions.find((position) => position.slug === active.slug);
  const hasVerifiedData = Boolean(scarcityDataQuery.data?.dataConfidence.sourceCount);
  const availableBalance = orderSide === "BUY"
    ? baseUnits(portfolioQuery.data?.totals.collateralBalance)
    : baseUnits(outcome === "YES" ? activePosition?.yes : activePosition?.no);
  const recoverTransactions = useCallback(() => {
    void chainQuery.refetch();
    void portfolioQuery.refetch();
  }, [chainQuery, portfolioQuery]);

  const navigateScarcity = useCallback((nextView: ScarcityView, nextSlug = active.slug, mode: "push" | "replace" = "push", nextInstrument: ScarcityInstrument = instrument) => {
    setView(nextView);
    setActiveSlug(nextSlug);
    if (nextView === "markets") setInstrument(nextInstrument);
    setVerificationState("idle");
    setTicketOpenMobile(false);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const locationIsCurrent = url.searchParams.get("scx") === nextView
      && url.searchParams.get("market") === nextSlug
      && (nextView !== "markets" || url.searchParams.get("instrument") === nextInstrument);
    url.searchParams.set("scx", nextView);
    url.searchParams.set("market", nextSlug);
    if (nextView === "markets") url.searchParams.set("instrument", nextInstrument);
    const historyState = {
      ...(window.history.state ?? {}),
      hedgentsScarcity: { view: nextView, market: nextSlug, instrument: nextInstrument },
    };
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (locationIsCurrent && mode === "push") return;
    if (mode === "replace") window.history.replaceState(historyState, "", nextUrl);
    else window.history.pushState(historyState, "", nextUrl);
  }, [active.slug, instrument]);

  const openInstrument = useCallback((nextInstrument: ScarcityInstrument) => {
    const nextMarket = nextInstrument === "curve" && !active.curve
      ? markets.find((market) => market.metal.id === active.metal.id && market.curve?.deployed)
        ?? markets.find((market) => market.curve?.deployed)
        ?? active
      : active;
    navigateScarcity("markets", nextMarket.slug, "push", nextInstrument);
  }, [active, markets, navigateScarcity]);

  useEffect(() => {
    const syncFromLocation = () => {
      const url = new URL(window.location.href);
      const requestedView = url.searchParams.get("scx");
      const requestedMarket = url.searchParams.get("market");
      const requestedInstrument = url.searchParams.get("instrument");
      const normalizedView = requestedView === "catalysts" ? "oracle" : requestedView;
      const nextView = normalizedView && scarcityViews.has(normalizedView as ScarcityView)
        ? normalizedView as ScarcityView
        : initialView;
      let nextSlug = requestedMarket && markets.some((market) => market.slug === requestedMarket)
        ? requestedMarket
        : defaultMarketSlug;
      const locationMarket = markets.find((market) => market.slug === nextSlug);
      const nextInstrument: ScarcityInstrument = requestedInstrument === "event"
        ? "event"
        : requestedInstrument === "curve"
          ? "curve"
          : locationMarket?.curve ? "curve" : "event";
      if (nextView === "markets" && nextInstrument === "curve" && !locationMarket?.curve) {
        nextSlug = markets.find((market) => market.metal.id === locationMarket?.metal.id && market.curve)?.slug
          ?? markets.find((market) => market.curve)?.slug
          ?? nextSlug;
      }
      setView(nextView);
      setActiveSlug(nextSlug);
      setInstrument(nextInstrument);
      setVerificationState("idle");
      setTicketOpenMobile(false);

      if (requestedView !== nextView || requestedMarket !== nextSlug || (nextView === "markets" && requestedInstrument !== nextInstrument)) {
        url.searchParams.set("scx", nextView);
        url.searchParams.set("market", nextSlug);
        if (nextView === "markets") url.searchParams.set("instrument", nextInstrument);
        window.history.replaceState({
          ...(window.history.state ?? {}),
          hedgentsScarcity: { view: nextView, market: nextSlug, instrument: nextInstrument },
        }, "", `${url.pathname}${url.search}${url.hash}`);
      }
    };

    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [defaultMarketSlug, initialView, markets]);

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
  }

  async function copyCanonicalDocument(kind: "question" | "rules") {
    const value = kind === "question" ? evidencePrimaryDocument : evidenceRulesDocument;
    await copyText(JSON.stringify(JSON.parse(value), null, 2));
    setCopiedDocument(kind);
    window.setTimeout(() => setCopiedDocument((current) => current === kind ? null : current), 1_800);
  }

  async function reproduceCommitments() {
    setVerificationState("checking");
    const digest = async (value: string) => {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const [questionHash, rulesHash] = await Promise.all([digest(evidencePrimaryDocument), digest(evidenceRulesDocument)]);
    setVerificationState(questionHash === evidencePrimaryHash && rulesHash === evidenceRulesHash ? "verified" : "mismatch");
  }

  function downloadVerificationBundle() {
    const blob = new Blob([JSON.stringify({
      instrument,
      marketId: evidenceMarketId,
      [curveEvidence ? "metricHash" : "questionHash"]: evidencePrimaryHash,
      rulesHash: evidenceRulesHash,
      [curveEvidence ? "metric" : "question"]: JSON.parse(evidencePrimaryDocument),
      rules: JSON.parse(evidenceRulesDocument),
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${curveEvidence?.slug ?? active.slug}-verification-bundle.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadEvidenceRegistry() {
    const registry = instrument === "curve"
      ? markets.filter((market) => market.curve).map((market) => ({
        instrument: "curve",
        marketId: market.curve!.marketId,
        slug: market.curve!.slug,
        metal: market.metal,
        title: market.curve!.title,
        metricHash: market.curve!.metricHash,
        rulesHash: market.curve!.rulesHash,
        sources: market.sources,
        lifecycle: market.lifecycle,
        publication: market.publication,
      }))
      : markets.map((market) => ({
      instrument: "event",
      marketId: market.marketId,
      slug: market.slug,
      metal: market.metal,
      title: market.title,
      questionHash: market.questionHash,
      rulesHash: market.rulesHash,
      sources: market.sources,
      lifecycle: market.lifecycle,
      publication: market.publication,
    }));
    const blob = new Blob([JSON.stringify(registry, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hedgents-scarcity-${instrument}-evidence-registry.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className={`${styles.exchange} ${view === "markets" && instrument === "curve" ? styles.exchangeCurve : styles.exchangeScrollable}`} style={activeStyle} aria-label="Scarcity workspace">
      <div className={styles.atmosphere} aria-hidden="true" />
      <header className={styles.embeddedHeader}>
        <div className={styles.division}>
          <span>SCX</span>
          <div><strong>Scarcity workspace</strong><small>Oracle · curve + event markets</small></div>
        </div>
        <nav className={styles.headerNav} aria-label="Scarcity Exchange navigation">
          {scarcityNavigation.map((item) => (
            <button
              type="button"
              key={item.view}
              className={view === item.view ? styles.navActive : undefined}
              onClick={() => navigateScarcity(item.view)}
              aria-current={view === item.view ? "page" : undefined}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={`${styles.trustCenterButton} ${view === "evidence" ? styles.trustCenterActive : ""}`}
            onClick={() => navigateScarcity("evidence")}
            aria-current={view === "evidence" ? "page" : undefined}
          >
            <ShieldCheck size={13} aria-hidden="true" />
            <span>Trust center</span>
          </button>
          <span className={`${styles.buildBadge} ${view === "evidence" || view === "pulse" || view === "oracle" || instrument === "curve" || !chainState ? styles.specificationBadge : ""}`}><i /> {view === "evidence" ? "Rules + policies" : view === "pulse" ? "Paper simulator" : view === "oracle" ? "99 metal paths" : instrument === "curve" ? "Curve forecasts" : chainState ? `${chainState.deployment.cluster} live` : "Specification only"}</span>
        </div>
      </header>

      <ScarcityTransactionRecovery
        wallet={ownerAddress}
        onRecovered={recoverTransactions}
      />

      {view === "pulse" ? (
        <>
          {/* The real, on-chain round: this is what a tester takes a side on. The paper simulator
              below it is a rehearsal tool and stays clearly second. */}
          <PulseMarket onConnect={() => setWalletOpen(true)} />
          <MetalPulse />
        </>
      ) : view === "oracle" ? (
        <ScarcityOracle
          markets={markets}
          dataset={defaultDataset}
          onOpenMarket={(slug) => {
            const market = markets.find((candidate) => candidate.slug === slug);
            navigateScarcity("markets", slug, "push", market?.curve ? "curve" : "event");
          }}
        />
      ) : view === "markets" ? instrument === "curve" ? (
        <ScarcityCurveMarket
          markets={markets}
          active={active}
          data={scarcityDataQuery.data}
          owner={ownerAddress}
          onSelect={(slug) => navigateScarcity("markets", slug, "push", "curve")}
          onOpenEvents={() => openInstrument("event")}
          onOpenVerify={() => navigateScarcity("evidence")}
          onConnect={() => setWalletOpen(true)}
        />
      ) : <>
      <div className={styles.eventInstrumentBar} aria-label="Scarcity market instrument">
        <ScarcityInstrumentTabs
          active="event"
          onCurve={() => openInstrument("curve")}
          onEvent={() => undefined}
        />
        <p>Two instruments, one metal-state oracle. Curve forecasts are the default for numerical evidence.</p>
      </div>
      <section className={styles.marketDiscovery} aria-labelledby="scarcity-markets-title">
        <div className={styles.marketDiscoveryIntro}>
          <div>
            <span>Event markets / {marketCount} canonical questions</span>
            <h1 id="scarcity-markets-title">Trade the catalyst.</h1>
            <p>Choose an objective question, inspect its evidence, then express a YES or NO view when an onchain deployment is live.</p>
          </div>
          <aside className={`${styles.marketStateBanner} ${chainState ? styles.marketLiveBanner : styles.marketPaperBanner}`} aria-live="polite">
            <i />
            <div>
              <strong>{chainQuery.isLoading ? "Checking deployment" : chainState ? `${chainState.deployment.cluster} market live` : "Paper market · trading disabled"}</strong>
              <span>{chainState ? "Orders settle from the frozen evidence contract below." : "Specification and evidence only. No wallet action can move value."}</span>
            </div>
          </aside>
        </div>
        <div className={styles.featuredMarketGrid} aria-label="Featured market questions">
          {featuredMarkets.map((market) => {
            const item = visualForMetal(market.metal);
            const selected = market.slug === active.slug;
            const cardResolution = market.resolutionTarget;
            return <button
              type="button"
              key={market.slug}
              className={selected ? styles.featuredMarketActive : undefined}
              style={{ "--element-tone": item.tone } as CSSProperties}
              onClick={() => navigateScarcity("markets", market.slug)}
              aria-pressed={selected}
            >
              <span className={styles.featuredMarketMetal}><i /> {market.metal.symbol} · {market.metal.name}</span>
              <strong>{humanizeQuestion(market.question)}</strong>
              <span className={styles.featuredMarketMeta}>
                <em>{market.slug === active.slug && chainState ? `${chainState.deployment.cluster} live` : market.lifecycle}</em>
                <small>Closes {formatDate(market.schedule.closesAt)}</small>
                <small>{cardResolution.kind === "event" ? cardResolution.resolverLabel : cardResolution.methodologyVersion} · {market.sources.length} source{market.sources.length === 1 ? "" : "s"}</small>
              </span>
            </button>;
          })}
        </div>
      </section>

      <section className={styles.tape} aria-label="Search and select a scarcity market">
        <label className={styles.marketSearch}>
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={marketQuery}
            onChange={(event) => setMarketQuery(event.target.value)}
            placeholder="Search metal or question"
            aria-label="Search scarcity markets"
          />
          <small>{filteredMarkets.length} / {marketCount}</small>
        </label>
        <div className={styles.elementRail}>
          {filteredMarkets.map((market, index) => {
            const item = visualForMetal(market.metal);
            const selected = market.slug === active.slug;
            return (
              <button
                type="button"
                key={market.slug}
                onClick={() => navigateScarcity("markets", market.slug)}
                className={selected ? styles.elementActive : ""}
                style={{ "--element-tone": item.tone, "--delay": `${Math.min(index, 12) * 30}ms` } as CSSProperties}
                aria-pressed={selected}
                title={market.title}
              >
                <i />
                <strong>{market.metal.symbol}</strong>
                <span>{market.metal.name}</span>
                <small>{market.sources.length} source{market.sources.length === 1 ? "" : "s"}</small>
              </button>
            );
          })}
          {!filteredMarkets.length ? <p className={styles.marketSearchEmpty}>No contract matches “{marketQuery}”.</p> : null}
        </div>
        <span className={styles.railAffordance} aria-hidden="true">Scroll metals →</span>
      </section>

      <div className={styles.workspace}>
        <section className={styles.marketCanvas}>
          <div className={styles.marketHeader}>
            <div className={styles.atomicHero} aria-hidden="true">
              <span>{visual.atomic}</span>
              <strong>{active.metal.symbol}</strong>
              <small>{active.metal.name}</small>
            </div>
            <div className={styles.marketIdentity}>
              <div className={styles.eyebrow}>
                <span>SCX / {active.marketKind.toUpperCase()} / {active.metal.symbol.toUpperCase()} / 2026</span>
                <span className={styles.researchState}><i /> {active.lifecycle}</span>
              </div>
              <h1>{active.title}</h1>
              <p>{humanizeQuestion(active.question)}</p>
              <div className={styles.marketMeta}>
                <span><Database size={13} /> {dataResolution ? `Method ${dataResolution.methodologyVersion}` : eventResolution?.resolverLabel}</span>
                <span><LockKeyhole size={13} /> Fully collateralized</span>
                <span><ShieldCheck size={13} /> Objective resolution</span>
              </div>
            </div>
            <div className={styles.quoteVoid}>
              <span>Last probability</span>
              <strong>{midpoint === null ? "—" : `${midpoint.toFixed(2)}¢`}</strong>
              <small>{chainState ? `${visibleOrders.length} open ${outcome} orders` : "No live market"}</small>
            </div>
          </div>

          <div className={styles.contractGrid}>
            {dataResolution ? <article className={styles.thresholdCard}>
              <header><span>Data resolution threshold</span><FlaskConical size={15} /></header>
              <div className={styles.thresholdValue}>
                <strong>{dataResolution.threshold.toFixed(dataResolution.precision)}</strong>
                <span>/ 100</span>
              </div>
              <p>{dataResolution.metricLabel}</p>
              <div className={styles.thresholdScale} aria-hidden="true">
                <i style={{ width: `${dataResolution.threshold}%` }} />
                <span style={{ left: `${dataResolution.threshold}%` }} />
              </div>
              <footer>
                <span>Observe {formatDate(dataResolution.observedAt)}</span>
                <span>{dataResolution.comparator === "greater-than-or-equal" ? "≥ threshold = YES" : "≤ threshold = YES"}</span>
              </footer>
            </article> : eventResolution ? <article className={styles.thresholdCard}>
              <header><span>Event resolution criterion</span><BookOpenCheck size={15} /></header>
              <div className={styles.eventCriterion}><strong>{eventResolution.eventLabel}</strong><span>{eventResolution.qualifyingOutcome}</span></div>
              <footer><span>Resolve {formatDate(eventResolution.resolvesAt)}</span><span>{eventResolution.resolverLabel}</span></footer>
            </article> : null}

            <article className={styles.commitmentCard}>
              <header><span>Immutable contract</span><Braces size={15} /></header>
              <dl>
                <div><dt>Market ID</dt><dd>{shortHash(active.marketId)}</dd></div>
                <div><dt>Question</dt><dd>{shortHash(active.questionHash)}</dd></div>
                <div><dt>Rules</dt><dd>{shortHash(active.rulesHash)}</dd></div>
              </dl>
              <button type="button" onClick={() => navigateScarcity("evidence")}>Rules &amp; evidence <ArrowUpRight size={13} /></button>
            </article>

            <article className={styles.lifecycleCard}>
              <header><span>Contract clock</span><span>UTC</span></header>
              <div className={styles.timeline}>
                <div className={styles.timelineDone}><i><Check size={10} /></i><span>Research<small>Specification compiled</small></span></div>
                <div><i>02</i><span>Open<small>{formatDate(active.schedule.opensAt)}</small></span></div>
                <div><i>03</i><span>Close<small>{formatDate(active.schedule.closesAt)}</small></span></div>
                <div><i>04</i><span>Resolve<small>{formatDate(active.schedule.resolveAfter)}</small></span></div>
              </div>
            </article>
          </div>

          <section className={styles.dataFoundation}>
            <header>
              <div><span>Published physical-market evidence</span><small>{scarcityDataQuery.data?.dataset.label ?? "Loading verified production store"}</small></div>
              <em className={!hasVerifiedData ? styles.emptyDataTag : undefined}>{scarcityDataQuery.isLoading ? "loading" : hasVerifiedData ? "verified inputs" : "no verified data"}</em>
            </header>
            <div className={styles.dataFoundationGrid}>
              <div title="A 0–100 normalized summary of short-term physical supply pressure. It is an evidence score, not a market probability."><span>Market tightness · score</span><strong>{scarcityDataQuery.data?.marketTightness.score?.toFixed(1) ?? "—"}</strong><small>{Math.round((scarcityDataQuery.data?.marketTightness.coverageRatio ?? 0) * 100)}% metric coverage · not probability</small></div>
              <div title="A 0–100 normalized summary of longer-term supply constraints. It is an evidence score, not a market probability."><span>Structural scarcity · score</span><strong>{scarcityDataQuery.data?.structuralScarcity.score?.toFixed(1) ?? "—"}</strong><small>{Math.round((scarcityDataQuery.data?.structuralScarcity.coverageRatio ?? 0) * 100)}% metric coverage · not probability</small></div>
              <div><span>Data confidence</span><strong>{scarcityDataQuery.data ? Math.round(scarcityDataQuery.data.dataConfidence.score) : "—"}</strong><small>{scarcityDataQuery.data?.dataConfidence.grade ?? "unavailable"} · {scarcityDataQuery.data?.dataConfidence.sourceCount ?? 0} sources</small></div>
              <div className={styles.dataEvidenceLinks}>
                <span>Auditable inputs</span>
                {scarcityDataQuery.data ? [...scarcityDataQuery.data.marketTightness.metrics, ...scarcityDataQuery.data.structuralScarcity.metrics]
                  .flatMap((metric) => metric.observationIds.map((id) => ({ id, label: metric.label })))
                  .slice(0, 3)
                  .map((item) => <a key={item.id} href={`/api/scarcity/observations/${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer">{item.label} <ArrowUpRight size={11} /></a>) : null}
                {!scarcityDataQuery.isLoading && !scarcityDataQuery.data?.dataConfidence.sourceCount ? <small>No reviewed production observations published.</small> : null}
                {scarcityDataQuery.error instanceof Error ? <small>{scarcityDataQuery.error.message}</small> : null}
              </div>
            </div>
          </section>

          <section className={styles.marketDepth}>
            <div className={styles.depthHeader}>
              <div><span>Order book</span><small>Escrowed, non-custodial limit orders</small></div>
              <div className={styles.outcomeTabs}>
                <button type="button" onClick={() => setOutcome("YES")} className={outcome === "YES" ? styles.yesActive : ""}>YES</button>
                <button type="button" onClick={() => setOutcome("NO")} className={outcome === "NO" ? styles.noActive : ""}>NO</button>
              </div>
            </div>
            <div className={styles.bookHead}><span>Price</span><span>Contracts</span><span>Total USDC</span><span>Depth</span><span>Action</span></div>
            {visibleOrders.length ? (
              <div className={styles.bookRows}>
                {visibleOrders.map((order) => {
                  const quote = Number(order.priceMicroUsdc) / 1_000_000 * Number(order.remainingQuantity) / 1_000_000;
                  return (
                    <div className={`${styles.bookRow} ${order.side === "bid" ? styles.bidRow : styles.askRow}`} key={order.address}>
                      <span>{centsFromMicro(order.priceMicroUsdc)}¢ <small>{order.side}</small></span>
                      <span>{baseUnits(order.remainingQuantity)}</span>
                      <span>{exactUsdc(quote)}</span>
                      <span>{((Number(order.remainingQuantity) / 1_000_000) * 8).toFixed(0)}%</span>
                      {chainState?.market.status === "unresolved" ? <ScarcityOrderFill
                          state={chainState}
                          marketId={active.marketId}
                          order={order}
                          onConnect={() => setWalletOpen(true)}
                          onConfirmed={() => void chainQuery.refetch()}
                        /> : <span>Closed</span>}
                    </div>
                  );
                })}
              </div>
            ) : <div className={styles.emptyBook}>
              <div className={styles.emptyPulse}><i /><i /><i /></div>
              <strong>No live {outcome} bids or asks</strong>
              <p>{chainState ? "This deployed market has no active orders on this outcome." : "The settlement program is built and locally verified. Orders remain disabled until a verified deployment manifest is configured."}</p>
            </div>}
            <div className={styles.midpoint}><span>{midpoint === null ? "—" : `${midpoint.toFixed(2)}¢`}</span><small>{bestBid && bestAsk ? `${(Number(bestAsk.priceMicroUsdc) - Number(bestBid.priceMicroUsdc)) / 10_000}¢ spread` : "spread unavailable"}</small></div>
          </section>

          <section className={styles.executionPath}>
            <div><span>01</span><strong>Commit USDC</strong><small>Mint equal YES + NO</small></div>
            <i />
            <div><span>02</span><strong>Express a view</strong><small>Escrow bid or ask</small></div>
            <i />
            <div><span>03</span><strong>Publish evidence</strong><small>Hash the source report</small></div>
            <i />
            <div><span>04</span><strong>Redeem</strong><small>Winner receives USDC</small></div>
          </section>
        </section>

        {chainState ? <aside className={`${styles.orderTicket} ${ticketOpenMobile ? styles.ticketMobileOpen : styles.ticketMobileClosed}`}>
          <div className={styles.ticketTopline}>
            <div><span>{active.metal.symbol} · {outcome} order</span><small>{chainState.deployment.cluster} · onchain</small></div>
            <button type="button" onClick={() => setTicketOpenMobile(false)} aria-label="Close order ticket"><ChevronDown size={15} /></button>
          </div>
          <div className={styles.sideSwitch}>
            <button type="button" onClick={() => setOrderSide("BUY")} className={orderSide === "BUY" ? styles.buyActive : ""}>Buy</button>
            <button type="button" onClick={() => setOrderSide("SELL")} className={orderSide === "SELL" ? styles.sellActive : ""}>Sell</button>
          </div>
          <div className={styles.outcomeChoice}>
              <button type="button" onClick={() => setOutcome("YES")} className={outcome === "YES" ? styles.yesChoice : ""}>
              <span>YES</span><small>{dataResolution ? "Metric reaches threshold" : "Named event occurs"}</small>
              </button>
              <button type="button" onClick={() => setOutcome("NO")} className={outcome === "NO" ? styles.noChoice : ""}>
              <span>NO</span><small>{dataResolution ? "Metric misses threshold" : "Named event does not occur"}</small>
            </button>
          </div>
          <label className={styles.ticketInput}>
            <span>Limit price</span>
            <div><input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" aria-label="Limit price in cents" /><strong>¢</strong></div>
            <small>Implied probability {priceNumber.toFixed(1)}%</small>
          </label>
          <label className={styles.ticketInput}>
            <span>Contracts</span>
            <div><input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" aria-label="Number of contracts" /><strong>{outcome}</strong></div>
            <small>Each winning contract redeems for 1 USDC · available {availableBalance} {orderSide === "BUY" ? "USDC" : outcome}</small>
          </label>
          <dl className={styles.orderMath}>
            <div><dt>Notional</dt><dd>{exactUsdc(notional)}</dd></div>
            <div><dt>Trading fee · {(feeBps / 100).toFixed(2)}%</dt><dd>{exactUsdc(fee)}</dd></div>
            <div><dt>Maximum payout</dt><dd>{exactUsdc(possiblePayout)}</dd></div>
            <div><dt>Maximum profit</dt><dd>{exactUsdc(Math.max(0, possiblePayout - notional - fee))}</dd></div>
            <div><dt>Order expiry</dt><dd>{formatDateTime(new Date(Number(chainState.market.closesAt) * 1_000).toISOString())}</dd></div>
          </dl>
          {chainState?.market.status === "unresolved" ? <div className={styles.primarySetActions}>
            <div><span>Primary liquidity</span><small>1 USDC mints one YES + one NO. Merge a pair to recover 1 USDC.</small></div>
            <div>
              <ScarcitySetAction state={chainState} marketId={active.marketId} kind="mint" quantity={quantity} onConnect={() => setWalletOpen(true)} onConfirmed={() => void chainQuery.refetch()} />
              <ScarcitySetAction state={chainState} marketId={active.marketId} kind="merge" quantity={quantity} onConnect={() => setWalletOpen(true)} onConfirmed={() => void chainQuery.refetch()} />
            </div>
          </div> : null}
          {chainState.market.status === "unresolved" ? (
            <div className={styles.submitOrderAction}>
              <ScarcityOrderSubmit
                state={chainState}
                marketId={active.marketId}
                outcome={outcome}
                orderSide={orderSide}
                price={price}
                quantity={quantity}
                onConnect={() => setWalletOpen(true)}
                onConfirmed={() => void chainQuery.refetch()}
              />
            </div>
          ) : <div className={styles.submitOrderAction}>
            <ScarcityRedeemAction
              state={chainState}
              marketId={active.marketId}
              outcome={outcome}
              quantity={quantity}
              onConnect={() => setWalletOpen(true)}
              onConfirmed={() => { void chainQuery.refetch(); void portfolioQuery.refetch(); }}
            />
          </div>}
          <p className={styles.ticketWarning}>{chainQuery.error instanceof Error ? chainQuery.error.message : "Review every amount and the wallet simulation before signing. Markets settle from the committed evidence rules."}</p>
          <div className={styles.solvencyNote}>
            <ShieldCheck size={17} />
            <div><strong>Solvency before liquidity</strong><span>One USDC enters the vault before every complete outcome pair is issued.</span></div>
          </div>
        </aside> : <aside className={`${styles.orderTicket} ${styles.researchTicket}`}>
          <div className={styles.researchLockIcon}><LockKeyhole size={22} /></div>
          <span className={styles.researchLockKicker}>Contract specification</span>
          <h2>Trading has not opened.</h2>
          <p>Review the methodology and evidence while the Solana deployment is prepared. No wallet connection or value-moving action is available in this state.</p>
          <dl className={styles.researchCommitments}>
            <div><dt>Metal</dt><dd>{active.metal.symbol} · {active.metal.name}</dd></div>
            <div><dt>Outcome</dt><dd>Binary YES / NO</dd></div>
            <div><dt>Collateral</dt><dd>USDC when deployed</dd></div>
          </dl>
          <button type="button" className={styles.researchEvidenceButton} onClick={() => navigateScarcity("evidence")}>Review rules &amp; evidence <ArrowRight size={14} /></button>
        </aside>}
      </div>
      {chainState ? <button type="button" className={styles.mobileTradeBar} onClick={() => setTicketOpenMobile(true)}>
        <span><i style={{ background: visual.tone }} />{active.metal.symbol} · {outcome}<small>{midpoint === null ? "No midpoint" : `${midpoint.toFixed(2)}¢ midpoint`}</small></span>
        <strong>Trade</strong>
      </button> : null}
      </> : (
        <section className={styles.secondaryView} data-testid="trust-center">
          <header className={`${styles.secondaryHeader} ${styles.trustHero}`}>
            <div>
              <span>Trust center / Closed-beta controls</span>
              <h1>Rules before risk.</h1>
            </div>
            <div className={styles.trustHeroAside}>
              <p>Understand the market contract, product risks, eligibility checks, and data handling before connecting a wallet or committing capital.</p>
              <div>
                <span><i /> Invite-only beta</span>
                <button type="button" onClick={() => navigateScarcity("markets", active.slug, "push", instrument)}><ArrowLeft size={13} aria-hidden="true" /> Back to trade</button>
              </div>
            </div>
          </header>

          <nav className={styles.trustDirectory} aria-label="Trust Center sections">
            <a href="#market-rules"><span>01</span><strong>Rules &amp; evidence</strong><small>Frozen market inputs and reproducible hashes</small></a>
            <a href="#risk-disclosures"><span>02</span><strong>Risk &amp; beta</strong><small>Loss, liquidity, oracle, and launch status</small></a>
            <a href="#access-eligibility"><span>03</span><strong>Access &amp; eligibility</strong><small>Residence checks and issuer restrictions</small></a>
            <a href="#beta-terms"><span>04</span><strong>Terms &amp; privacy</strong><small>Beta-use conditions and data handling</small></a>
          </nav>

          <section className={styles.trustPolicySection} aria-labelledby="beta-notices-title">
            <header>
              <div><span>Operating notices / Current implementation</span><h2 id="beta-notices-title">What the closed beta does—and does not—promise.</h2></div>
              <p>These factual notices describe the current product controls. They do not replace issuer terms or the formal legal documents required before public launch.</p>
            </header>
            <div className={styles.trustPolicyGrid}>
              <article id="risk-disclosures">
                <ShieldAlert size={18} aria-hidden="true" />
                <span>Risk disclosures</span>
                <h3>You can lose the full amount at risk.</h3>
                <ul>
                  <li>Scarcity stakes can be lost; curve payouts depend on accuracy and crowding in the shared trader pool.</li>
                  <li>Metal tokens carry price, liquidity, issuer, custody, redemption, tracking, smart-contract, and venue risk.</li>
                  <li>A displayed product is not a promise that an executable route or settlement will remain available.</li>
                </ul>
                <small>Scarcity markets remain research or practice experiences unless the interface shows a verified live deployment.</small>
              </article>

              <article id="access-eligibility">
                <UserCheck size={18} aria-hidden="true" />
                <span>Access &amp; eligibility</span>
                <h3>Product access is checked at order time.</h3>
                <ul>
                  <li>The beta compares declared residence with the request country and requires legal-age and issuer-term attestations.</li>
                  <li>Issuer restrictions still apply independently; selected products fail closed outside approved deployment policies.</li>
                  <li>These controls are not identity verification, KYC, legal advice, or a guarantee of regulatory eligibility.</li>
                </ul>
                <small>Never bypass an issuer, venue, or local-law restriction because the interface permits a quote.</small>
              </article>

              <article id="beta-terms">
                <Scale size={18} aria-hidden="true" />
                <span>Closed-beta use terms</span>
                <h3>Access is limited, revocable, and non-advisory.</h3>
                <ul>
                  <li>You control your wallet and must approve every transaction; connecting alone does not authorize movement of funds.</li>
                  <li>Hedgents may pause execution, reduce limits, or withdraw beta access to protect users or the system.</li>
                  <li>Prices, signals, scores, and portfolio calculations are informational—not investment, legal, tax, or accounting advice.</li>
                </ul>
                <small className={styles.policyPending}>Formal public Terms of Use · pending reviewed publication</small>
              </article>

              <article id="terms-privacy">
                <LockKeyhole size={18} aria-hidden="true" />
                <span>Privacy &amp; data handling</span>
                <h3>Collect less; keep sensitive actions in the wallet.</h3>
                <ul>
                  <li>An essential invite session cookie controls beta access; network location is processed for security and eligibility checks.</li>
                  <li>Pending receipts and preferences are stored locally. Clearing site data can remove local history unless receipts were exported.</li>
                  <li>Optional diagnostics are pseudonymous and exclude wallet addresses, signatures, and exact trade amounts.</li>
                </ul>
                <small className={styles.policyPending}>Formal public Privacy Policy · pending reviewed publication</small>
              </article>
            </div>
          </section>

          <section className={styles.evidenceLead} id="market-rules" aria-labelledby="market-rules-title">
            <div><span>Market integrity / Content-addressed</span><h2 id="market-rules-title">Rules &amp; Evidence</h2></div>
            <p>The market {curveEvidence ? "metric" : "question"} and resolution rules are content-addressed. Reproduce those commitments locally; after resolution, compare the published report hash and source records with the Solana account. Commitments make changes detectable, but source selection and the designated resolver still require trust.</p>
          </section>
          <div className={styles.evidenceRail}>
            <article><span>01</span><Database size={18} /><strong>Collect</strong><p>Ingest only committed sources with publication and retrieval timestamps.</p></article>
            <article><span>02</span><FlaskConical size={18} /><strong>Calculate</strong><p>Run the frozen methodology and preserve every transformation.</p></article>
            <article><span>03</span><Braces size={18} /><strong>Commit</strong><p>Canonicalize the report and hash it in the resolution transaction.</p></article>
            <article><span>04</span><ShieldCheck size={18} /><strong>Verify</strong><p>Compare the public report hash with the market account on Solana.</p></article>
          </div>
          <section className={styles.evidenceInspector} aria-labelledby="evidence-inspector-title">
            <header>
              <div><span>{active.metal.symbol} / {curveEvidence ? "curve" : "event"} verification bundle</span><h2 id="evidence-inspector-title">{curveEvidence?.title ?? active.title}</h2></div>
              <div className={styles.evidenceInspectorActions}>
                <button type="button" onClick={() => void reproduceCommitments()}>{verificationState === "checking" ? "Reproducing…" : "Reproduce hashes"}</button>
                <button type="button" onClick={downloadVerificationBundle}>Download JSON</button>
              </div>
            </header>
            {verificationState !== "idle" ? <p className={verificationState === "verified" ? styles.verificationSuccess : styles.verificationFailure} role="status">
              {verificationState === "checking" ? "Hashing canonical documents in this browser…" : verificationState === "verified" ? `${curveEvidence ? "Metric" : "Question"} and rules commitments reproduced locally.` : "Commitment mismatch. Do not use this specification."}
            </p> : null}
            <div className={styles.hashLedger}>
              <div><span>Market ID</span><code>{evidenceMarketId}</code><button type="button" onClick={() => void copyText(evidenceMarketId)}>Copy</button></div>
              <div><span>{curveEvidence ? "Metric" : "Question"} SHA-256</span><code>{evidencePrimaryHash}</code><button type="button" onClick={() => void copyText(evidencePrimaryHash)}>Copy</button></div>
              <div><span>Rules SHA-256</span><code>{evidenceRulesHash}</code><button type="button" onClick={() => void copyText(evidenceRulesHash)}>Copy</button></div>
              {!curveEvidence && !isZeroHash(chainState?.market.resolutionReportHash) ? <div><span>Resolution report</span><code>{chainState?.market.resolutionReportHash}</code><a href={`/api/scarcity/resolutions/${chainState?.market.resolutionReportHash}`} target="_blank" rel="noreferrer">Open</a></div> : null}
            </div>
            <div className={styles.evidenceDetailGrid}>
              <article>
                <header><span>Frozen resolution inputs</span><small>{curveEvidence ? "The metric range and payout kernel are immutable" : dataResolution ? "Data inputs are evidence, not probability" : "The event, deadline, and resolver are immutable"}</small></header>
                {curveEvidence ? <dl>
                  <div><dt>Metric</dt><dd>{curveEvidence.metric.label}</dd></div>
                  <div><dt>Metric ID</dt><dd>{curveEvidence.metric.id}</dd></div>
                  <div><dt>Display range</dt><dd>{curveEvidence.displayRange.minimum}–{curveEvidence.displayRange.maximum} {curveEvidence.metric.unit}</dd></div>
                  <div><dt>Observation time</dt><dd><time dateTime={curveEvidence.metric.observedAt}>{formatDateTime(curveEvidence.metric.observedAt)}</time></dd></div>
                  <div><dt>Curve engine</dt><dd>{curveEvidence.bucketCount} buckets · {(curveEvidence.targetJackpotBps / 100).toFixed(0)}% exact target · {curveEvidence.jackpotLeverageCap}× cap</dd></div>
                  <div><dt>Methodology</dt><dd>{curveEvidence.metric.methodologyVersion}</dd></div>
                </dl> : dataResolution ? <dl>
                  <div><dt>Metric</dt><dd>{dataResolution.metricLabel}</dd></div>
                  <div><dt>Metric ID</dt><dd>{dataResolution.metricId}</dd></div>
                  <div><dt>Threshold</dt><dd>{dataResolution.comparator === "greater-than-or-equal" ? "≥" : "≤"} {dataResolution.threshold} {dataResolution.unit}</dd></div>
                  <div><dt>Observation time</dt><dd><time dateTime={dataResolution.observedAt} title={dataResolution.observedAt}>{formatDateTime(dataResolution.observedAt)}</time></dd></div>
                  <div><dt>Methodology</dt><dd>{dataResolution.methodologyVersion}</dd></div>
                </dl> : eventResolution ? <dl>
                  <div><dt>Event</dt><dd>{eventResolution.eventLabel}</dd></div>
                  <div><dt>YES criterion</dt><dd>{eventResolution.qualifyingOutcome}</dd></div>
                  <div><dt>Deadline</dt><dd><time dateTime={eventResolution.resolvesAt}>{formatDateTime(eventResolution.resolvesAt)}</time></dd></div>
                  <div><dt>Resolver</dt><dd>{eventResolution.resolverLabel}</dd></div>
                </dl> : null}
                <div className={styles.sourceList}>
                  <span>Committed source documents</span>
                  {active.sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><strong>{source.publisher}</strong><small>{source.title} · {source.cadence}</small><ArrowUpRight size={13} /></a>)}
                  {scarcityDataQuery.data ? [...scarcityDataQuery.data.marketTightness.metrics, ...scarcityDataQuery.data.structuralScarcity.metrics]
                    .flatMap((metric) => metric.observationIds.map((id) => ({ id, label: metric.label })))
                    .map((item) => <a key={item.id} href={`/api/scarcity/observations/${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer"><strong>{item.label}</strong><small>Reviewed observation record</small><ArrowUpRight size={13} /></a>) : null}
                </div>
                {!curveEvidence && chainState ? <a className={styles.explorerLink} href={`https://explorer.solana.com/address/${chainState.deployment.market}${chainState.deployment.cluster === "devnet" ? "?cluster=devnet" : ""}`} target="_blank" rel="noreferrer">Inspect market account on Solana Explorer <ArrowUpRight size={13} /></a> : <p className={styles.noOnchainEvidence}>{curveEvidence ? "The Trade view verifies curve account discovery when a reviewed deployment manifest is configured." : "No onchain address exists for this research specification."}</p>}
              </article>
              <article className={styles.canonicalDocuments}>
                <header>
                  <div><span>Canonical documents</span><small>Exact bytes committed by the hashes above</small></div>
                  <div className={styles.canonicalActions}>
                    <button type="button" onClick={() => void copyCanonicalDocument("question")}><Copy size={13} /> {copiedDocument === "question" ? "Copied" : curveEvidence ? "Metric" : "Question"}</button>
                    <button type="button" onClick={() => void copyCanonicalDocument("rules")}><Copy size={13} /> {copiedDocument === "rules" ? "Copied" : "Rules"}</button>
                  </div>
                </header>
                <details><summary>{curveEvidence ? "Metric" : "Question"} document <span>Expand canonical JSON</span></summary><pre>{JSON.stringify(JSON.parse(evidencePrimaryDocument), null, 2)}</pre></details>
                <details><summary>Resolution rules <span>Expand canonical JSON</span></summary><pre>{JSON.stringify(JSON.parse(evidenceRulesDocument), null, 2)}</pre></details>
              </article>
            </div>
          </section>
          <section className={styles.evidenceRegistry} aria-labelledby="evidence-registry-title">
            <header>
              <div><span>Complete {curveEvidence ? "curve" : "event"} registry</span><h2 id="evidence-registry-title">All {curveEvidence ? markets.filter((market) => market.curve).length : marketCount} metal specifications</h2><small>Collapsed by default to keep verification focused on the selected market.</small></div>
              <button type="button" onClick={downloadEvidenceRegistry}><Download size={14} /> Download registry</button>
            </header>
            <details>
              <summary><span>Browse every evidence record</span><span>{curveEvidence ? markets.filter((market) => market.curve).length : marketCount} markets <ChevronDown size={15} /></span></summary>
              <div className={styles.evidenceTable} role="table" aria-label="Scarcity evidence registry">
                <div className={styles.evidenceHead} role="row"><span role="columnheader">Metal market</span><span role="columnheader">{curveEvidence ? "Metric" : "Question"} hash</span><span role="columnheader">Rules hash</span><span role="columnheader">Source</span><span role="columnheader">State</span></div>
                {(curveEvidence ? markets.filter((market) => market.curve) : markets).map((market) => (
                  <div role="row" key={market.slug} className={`${styles.evidenceRow} ${market.slug === active.slug ? styles.evidenceSelected : ""}`}>
                    <span role="cell"><button type="button" className={styles.evidenceMarketButton} onClick={() => navigateScarcity("evidence", market.slug)} aria-current={market.slug === active.slug ? "true" : undefined}><i style={{ color: visualForMetal(market.metal).tone }}>{market.metal.symbol}</i>{curveEvidence ? market.curve?.title : market.title}</button></span>
                    <code role="cell">{shortHash(curveEvidence ? market.curve!.metricHash : market.questionHash)}</code>
                    <code role="cell">{shortHash(curveEvidence ? market.curve!.rulesHash : market.rulesHash)}</code>
                    <span role="cell">{market.sources[0]?.publisher ?? "—"}</span>
                    <span role="cell"><em>{!curveEvidence && market.slug === active.slug && chainState ? "Onchain" : market.lifecycle}</em></span>
                  </div>
                ))}
              </div>
            </details>
          </section>
        </section>
      )}

      {walletOpen ? (
        <div className={styles.walletOverlay} role="presentation" onMouseDown={() => setWalletOpen(false)}>
          <section
            className={styles.walletDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scarcity-wallet-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div><span>Solana settlement</span><h2 id="scarcity-wallet-title">Connect wallet</h2></div>
              <button type="button" onClick={() => setWalletOpen(false)} aria-label="Close wallet dialog"><X size={16} /></button>
            </header>
            <p>Outcome positions, USDC escrow, order signatures, and redemption all stay in your Solana wallet.</p>
            {solanaConnected ? (
              <div className={styles.connectedWallet}>
                <div><i /><span><strong>{solanaConnected.wallet.name}</strong><small>{solanaConnected.account.address}</small></span></div>
                <button type="button" onClick={() => solanaDisconnect.dispatch()} disabled={solanaDisconnect.isRunning}>
                  <Unplug size={13} /> Disconnect
                </button>
              </div>
            ) : (
              <div className={styles.walletList}>
                {solanaWallets.length > 0 ? solanaWallets.map((wallet) => (
                  <button
                    type="button"
                    key={wallet.name}
                    onClick={() => solanaConnect.dispatch(wallet)}
                    disabled={solanaConnect.isRunning || solanaStatus === "pending"}
                  >
                    {wallet.icon ? <img src={wallet.icon} alt="" /> : <WalletCards size={17} />}
                    <span>Connect {wallet.name}</span>
                    <ArrowRight size={14} />
                  </button>
                )) : <p>No Wallet Standard wallet was found in this browser.</p>}
              </div>
            )}
            {solanaConnect.error ? <small className={styles.walletError}>{solanaConnect.error instanceof Error ? solanaConnect.error.message : "Wallet connection failed."}</small> : null}
            <div className={styles.walletSafety}><ShieldCheck size={15} /><span>Connecting is free and does not authorize a transaction.</span></div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
