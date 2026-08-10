"use client";

import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  Info,
  Layers3,
  Route,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  WalletCards,
  Unplug,
  X,
} from "lucide-react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import {
  useConnect as useSolanaConnect,
  useConnectedWallet,
  useDisconnect as useSolanaDisconnect,
  useWalletStatus,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import {
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
} from "@solana/kit";
import { createTransactionSignerFromWalletAccount } from "@solana/wallet-account-signer";
import { useClient } from "@solana/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useConnect as useEvmConnect,
  useConnection,
  useConnectors,
  useDisconnect as useEvmDisconnect,
  useSwitchChain,
} from "wagmi";
import type { AppSolanaClient } from "@/app/providers";
import { useMetalQuotes } from "@/hooks/use-metal-quotes";
import { usePortfolio } from "@/hooks/use-portfolio";
import { useProductRegistry } from "@/hooks/use-product-registry";
import { useRouteComparison } from "@/hooks/use-route-comparison";
import {
  diagnosticsConsentEnabled,
  setDiagnosticsConsent,
  trackBetaEvent,
} from "@/lib/beta-telemetry";
import { actionableExecutionError, amountBucket } from "@/lib/execution-errors";
import type { PublicExecutionControls } from "@/lib/execution-controls";
import { readPendingCctpFunding } from "@/lib/cctp-funding-storage";
import { normalizeExecutionReceipt, parseExecutionReceipt } from "@/lib/execution-receipts";
import { calculatePortfolioAccounting } from "@/lib/portfolio-accounting";
import { routeAvailabilityLabel } from "@/lib/route-availability";
import type {
  ExecutionRecord,
  JupiterExecutionResult,
  JupiterOrderQuote,
  PortfolioSnapshot,
  ProductRouteComparison,
  RegistryHealth,
  RouteComparisonResponse,
  TradeSide,
} from "@/lib/execution-types";
import {
  executionSubmissionState,
  isExecutionRecoveryPending,
  mergeRecoveredExecutionRecord,
} from "@/lib/execution-records";
import {
  getSolanaExecutionProduct,
  getSolanaSettlementAsset,
  isSolanaExecutionProduct,
  solanaSettlementAssets,
  type SettlementAssetId,
} from "@/lib/product-registry";
import type { LiveQuote, MetalQuoteResponse } from "@/lib/quote-types";
import type { CctpSourceId } from "@/lib/rail-cctp";
import type { PublicTerminalFeatures } from "@/lib/terminal-feature-controls";
import { defaultAmountForTradeSide } from "@/lib/trade-ticket-state";
import { SCARCITY_TRACKED_ELEMENT_COUNT } from "@/lib/scarcity/registry";
import type { ScarcityMarket } from "./ScarcityExchange";
import {
  DEFAULT_ELEMENT_TONE,
  elementTones,
  ExposureLane,
  metalMarkets,
  MetalMarket,
  MetalProduct,
} from "@/lib/metals";
import styles from "./metal-terminal.module.css";

const CctpFundingPanel = dynamic(
  () => import("./CctpFundingPanel").then((module) => module.CctpFundingPanel),
  { ssr: false },
);
const ScarcityExchange = dynamic(
  () => import("./ScarcityExchange").then((module) => module.ScarcityExchange),
  { ssr: false },
);
const ScarcityPortfolioPanel = dynamic(
  () => import("./ScarcityExchange").then((module) => module.ScarcityPortfolioPanel),
  { ssr: false },
);

export type TerminalView = "markets" | "scarcity" | "portfolio" | "orders";
type LaneFilter = "All" | ExposureLane;
type FundingSourceId = "solana" | CctpSourceId;
type ExecutionPhase =
  | "idle"
  | "ordering"
  | "ready"
  | "signing"
  | "submitting"
  | "success"
  | "failed";

const laneFilters: LaneFilter[] = ["All", "Own", "Invest", "Hedge"];
const currencyFormatters = new Map<number, Intl.NumberFormat>();
const trackedProductCount = metalMarkets.reduce(
  (total, market) => total + market.products.length,
  0,
);
const registeredAdapterCount = metalMarkets.reduce(
  (total, market) =>
    total + market.products.filter((product) => product.availability === "Executable").length,
  0,
);
const terminalViewLabels: Record<TerminalView, string> = {
  markets: "Metal tokens",
  scarcity: "Scarcity markets",
  portfolio: "Portfolio",
  orders: "Orders",
};
const terminalViews = new Set<TerminalView>(["markets", "scarcity", "portfolio", "orders"]);
const buyAmountPresets = [10, 25, 50, 100] as const;
const evmSourceNetworks = [
  { id: "ethereum", chainId: 1, label: "Ethereum", tone: "#a7b5d8", funding: "CCTP canary" },
  { id: "base", chainId: 8453, label: "Base", tone: "#5d86ff", funding: "CCTP alpha" },
  { id: "bnb", chainId: 56, label: "BNB Chain", tone: "#f3ba2f", funding: "Wallet only" },
] as const;
const fundingSources: Array<{
  id: FundingSourceId;
  label: string;
  tone: string;
  note: string;
  disclosure: string;
}> = [
  { id: "solana", label: "Solana", tone: "#9b7aff", note: "Direct", disclosure: "" },
  {
    id: "ethereum",
    label: "Ethereum",
    tone: "#a7b5d8",
    note: "CCTP canary",
    disclosure: "Ethereum → Solana has completed a small-value mainnet canary. The SDK remains unaudited alpha software.",
  },
  {
    id: "base",
    label: "Base",
    tone: "#5d86ff",
    note: "CCTP alpha",
    disclosure: "Base is supported by the CCTP adapter but has not yet completed the SDK's published mainnet canary gate.",
  },
];

function currency(value: number, maximumFractionDigits = 2) {
  let formatter = currencyFormatters.get(maximumFractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: Math.min(2, maximumFractionDigits),
      maximumFractionDigits,
    });
    currencyFormatters.set(maximumFractionDigits, formatter);
  }
  return formatter.format(value);
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function shortAddress(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

function baseUnits(value: string, decimals: number, maximumFractionDigits = 6) {
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = padded.slice(-decimals).replace(/0+$/, "").slice(0, maximumFractionDigits);
  return fraction ? `${whole}.${fraction}` : whole;
}

function baseUnitsNumber(value: string, decimals: number) {
  return Number(value) / 10 ** decimals;
}

function decodeBase64(value: string) {
  return Uint8Array.from(window.atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(value: ArrayLike<number>) {
  let binary = "";
  for (let index = 0; index < value.length; index += 1) {
    binary += String.fromCharCode(value[index]);
  }
  return window.btoa(binary);
}

function walletErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The wallet request did not complete.";
}

function downloadExecutionReceipt(record: ExecutionRecord) {
  const receipt = {
    schema: "hedgents.execution-receipt.v2",
    exportedAt: new Date().toISOString(),
    ...record,
  };
  const url = window.URL.createObjectURL(
    new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `hedgents-${record.id.replace(/[^a-z0-9-]/gi, "-")}.json`;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

async function recoverExecutionRecord(record: ExecutionRecord) {
  if (!record.signature || !record.recoveryAuthorization) {
    throw new Error("This receipt does not contain signed recovery evidence.");
  }
  const response = await fetch("/api/execution/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      signature: record.signature,
      recoveryAuthorization: record.recoveryAuthorization,
    }),
  });
  const payload = (await response.json()) as {
    status?: ExecutionRecord["status"];
    settlement?: ExecutionRecord["settlement"];
    error?: string;
  };
  if (!response.ok || !payload.status || !payload.settlement) {
    throw new Error(payload.error ?? "Settlement could not be recovered yet.");
  }
  return mergeRecoveredExecutionRecord(record, payload.settlement);
}

function quoteLabel(quote: LiveQuote | undefined, loading = false) {
  if (loading && !quote) return "Connecting feed";
  if (!quote || quote.freshness === "unavailable") return "Feed unavailable";
  if (quote.kind === "venue-probe") return "Live route probe";
  if (quote.freshness === "closed") return "Reference market closed";
  if (quote.freshness === "delayed") return "Delayed reference";
  return "Live reference";
}

function quoteAge(quote: LiveQuote | undefined) {
  if (!quote?.publishedAt) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(quote.publishedAt)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function availabilityClass(availability: MetalMarket["availability"]) {
  if (availability === "Executable") return styles.statusMapped;
  if (availability === "Indicative") return styles.statusIndicative;
  return styles.statusDiscovery;
}

function StatusBadge({
  status,
  live = false,
}: {
  status: MetalMarket["availability"];
  live?: boolean;
}) {
  return (
    <span
      className={classNames(
        styles.statusBadge,
        live ? styles.statusLive : availabilityClass(status),
      )}
    >
      <i />
      {live ? "Live route" : status === "Executable" ? "Mapped" : status}
    </span>
  );
}

function ElementMark({ market, compact = false }: { market: MetalMarket; compact?: boolean }) {
  return (
    <span
      className={classNames(styles.elementMark, compact && styles.elementMarkCompact)}
      style={
        {
          "--element-tone": elementTones[market.symbol] ?? DEFAULT_ELEMENT_TONE,
        } as React.CSSProperties
      }
    >
      <small>{market.atomicNumber}</small>
      <strong>{market.symbol}</strong>
    </span>
  );
}

export function MetalTerminal({
  scarcityMarkets,
  initialView = "markets",
  executionControl,
  terminalFeatures,
}: {
  scarcityMarkets: ScarcityMarket[];
  initialView?: TerminalView;
  executionControl: PublicExecutionControls;
  terminalFeatures: PublicTerminalFeatures;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const requestedMetalId = searchParams.get("metal");
  const initialMetalId = metalMarkets.some((market) => market.id === requestedMetalId)
    ? requestedMetalId!
    : "gold";
  const requestedProductId = searchParams.get("product");
  const initialProductId = metalMarkets
    .find((market) => market.id === initialMetalId)
    ?.products.some((product) => product.id === requestedProductId)
    ? requestedProductId
    : null;
  const solanaClient = useClient<AppSolanaClient>();
  const solanaConnection = useConnectedWallet(solanaClient);
  const evmConnection = useConnection();
  const liveQuotes = useMetalQuotes();
  const portfolio = usePortfolio(solanaConnection?.account.address ?? null);
  const [view, setView] = useState<TerminalView>(
    requestedView && terminalViews.has(requestedView as TerminalView)
      ? (requestedView as TerminalView)
      : initialView,
  );
  const [selectedMetalId, setSelectedMetalId] = useState(initialMetalId);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(initialProductId);
  const [laneFilter, setLaneFilter] = useState<LaneFilter>("All");
  const [onlyExecutable, setOnlyExecutable] = useState(false);
  const [query, setQuery] = useState("");
  const [amount, setAmount] = useState(String(Math.min(100, executionControl.maxUsd)));
  const [tradeSide, setTradeSide] = useState<TradeSide>("buy");
  const [settlementAssetId, setSettlementAssetId] = useState<SettlementAssetId>("usdc");
  const [hedgeEnabled, setHedgeEnabled] = useState(false);
  const [walletPanelOpen, setWalletPanelOpen] = useState(false);
  const [fundingPanelOpen, setFundingPanelOpen] = useState(false);
  const [fundingSourceId, setFundingSourceId] = useState<FundingSourceId>("solana");
  const [pendingFundingSourceId, setPendingFundingSourceId] = useState<CctpSourceId | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [executionInputAmount, setExecutionInputAmount] = useState(amount);
  const [executionPhase, setExecutionPhase] = useState<ExecutionPhase>("idle");
  const [executionOrder, setExecutionOrder] = useState<JupiterOrderQuote | null>(null);
  const [executionResult, setExecutionResult] = useState<JupiterExecutionResult | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [executionErrorCode, setExecutionErrorCode] = useState<string | null>(null);
  const [eligibilityAccepted, setEligibilityAccepted] = useState(false);
  const [eligibilityCountryCode, setEligibilityCountryCode] = useState("");
  const [executionRecords, setExecutionRecords] = useState<ExecutionRecord[]>([]);
  const [recordsHydrated, setRecordsHydrated] = useState(false);

  const selectedMarket =
    metalMarkets.find((market) => market.id === selectedMetalId) ?? metalMarkets[0];
  const rankedProducts = useMemo(
    () =>
      [...selectedMarket.products].sort(
        (left, right) => {
          const leftHasQuote = liveQuotes.data?.products[left.id]?.priceUsd != null;
          const rightHasQuote = liveQuotes.data?.products[right.id]?.priceUsd != null;
          if (leftHasQuote !== rightHasQuote) return leftHasQuote ? -1 : 1;
          return (
            (left.allInFeeBps ?? Number.POSITIVE_INFINITY) -
            (right.allInFeeBps ?? Number.POSITIVE_INFINITY)
          );
        },
      ),
    [liveQuotes.data?.products, selectedMarket],
  );
  const bestProduct = rankedProducts[0] ?? selectedMarket.products[0];
  const selectedProduct =
    selectedMarket.products.find((product) => product.id === selectedProductId) ?? bestProduct;
  const selectedSettlementAsset = getSolanaSettlementAsset(settlementAssetId) ?? solanaSettlementAssets.usdc;
  // The router step is where USDC becomes the metal token, so it takes the
  // selected metal's tone. Input (USDC) and Settlement (your wallet) keep their
  // own identity colours — recolouring all three would erase the meaning of each.
  const metalTone = elementTones[selectedMarket.symbol] ?? DEFAULT_ELEMENT_TONE;
  const selectedFundingSource =
    fundingSources.find((source) => source.id === fundingSourceId) ?? fundingSources[0];
  const executionRail = tradeSide === "sell"
    ? [
        { id: "input", label: "Input", value: selectedProduct.ticker, tone: metalTone },
        { id: "router", label: "Router", value: "Jupiter Swap V2", tone: "#9da5a2" },
        { id: "custody", label: "Settlement", value: `${selectedSettlementAsset.symbol} · your wallet`, tone: "#65c995" },
      ]
    : fundingSourceId === "solana"
    ? [
        { id: "input", label: "Input", value: "Native Solana USDC", tone: "#9b7aff" },
        { id: "router", label: "Router", value: "Jupiter Swap V2", tone: metalTone },
        { id: "custody", label: "Settlement", value: "Your Solana wallet", tone: "#65c995" },
      ]
    : [
        { id: "input", label: "Input", value: `${selectedFundingSource.label} USDC`, tone: selectedFundingSource.tone },
        { id: "funding", label: "Funding", value: "Circle CCTP V2", tone: "#4a90e2" },
        { id: "router", label: "Router", value: "Jupiter Swap V2", tone: metalTone },
        { id: "custody", label: "Settlement", value: "Your Solana wallet", tone: "#65c995" },
      ];
  const parsedAmount = Math.max(0, Number.parseFloat(amount) || 0);
  const executableIds = useMemo(
    () => selectedMarket.products.filter((product) => isSolanaExecutionProduct(product.id)).map((product) => product.id),
    [selectedMarket],
  );
  const routeComparison = useRouteComparison(
    tradeSide === "buy" ? executableIds : [selectedProduct.id].filter(isSolanaExecutionProduct),
    amount,
    {
      side: tradeSide,
      settlementAssetIds: tradeSide === "sell" ? ["usdc", "usdt", "usdg"] : ["usdc"],
      enabled: executionControl.enabled,
    },
  );
  const comparisonByProduct = useMemo(
    () => new Map(
      (routeComparison.data?.routes ?? [])
        .filter((route) => route.settlementAssetId === settlementAssetId)
        .map((route) => [route.productId, route]),
    ),
    [routeComparison.data?.routes, settlementAssetId],
  );
  const bestRouteProductIds = useMemo(() => {
    if (tradeSide === "sell") return new Set<string>();
    const grouped = new Map<string, ProductRouteComparison[]>();
    for (const route of routeComparison.data?.routes ?? []) {
      if (!route.available || !route.outputAmount) continue;
      const group = grouped.get(route.comparisonGroup) ?? [];
      group.push(route);
      grouped.set(route.comparisonGroup, group);
    }
    const best = new Set<string>();
    for (const routes of grouped.values()) {
      if (routes.length < 2) continue;
      routes.sort(
        (left, right) =>
          baseUnitsNumber(right.outputAmount!, right.outputDecimals) -
          baseUnitsNumber(left.outputAmount!, left.outputDecimals),
      );
      best.add(routes[0].productId);
    }
    return best;
  }, [routeComparison.data?.routes, tradeSide]);
  const registry = useProductRegistry(selectedProduct.id);
  const selectedExactRoute = comparisonByProduct.get(selectedProduct.id);

  const filteredMarkets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return metalMarkets.filter((market) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        market.name.toLowerCase().includes(normalizedQuery) ||
        market.symbol.toLowerCase().includes(normalizedQuery) ||
        market.products.some((product) =>
          `${product.name} ${product.ticker}`.toLowerCase().includes(normalizedQuery),
        );
      const matchesLane =
        laneFilter === "All" || market.products.some((product) => product.lane === laneFilter);
      const matchesAvailability = !onlyExecutable || market.availability === "Executable";
      return matchesQuery && matchesLane && matchesAvailability;
    });
  }, [laneFilter, onlyExecutable, query]);

  const routeFee = tradeSide === "buy" && selectedProduct.allInFeeBps !== null
    ? (parsedAmount * selectedProduct.allInFeeBps) / 10_000
    : 0;
  const deliveredValue = tradeSide === "buy" ? Math.max(0, parsedAmount - routeFee) : 0;
  const selectedMarketQuote = liveQuotes.data?.markets[selectedMarket.id];
  const independentProductQuote = liveQuotes.data?.products[selectedProduct.id];
  const routeProbePrice = registry.data?.liquidity.impliedUnitPriceUsd ?? null;
  const selectedProductQuote: LiveQuote | undefined =
    independentProductQuote?.priceUsd != null
      ? independentProductQuote
      : routeProbePrice != null
        ? {
            id: selectedProduct.id,
            priceUsd: routeProbePrice,
            change24h: null,
            confidenceUsd: null,
            publishedAt: registry.data?.checkedAt ?? null,
            freshness: "live",
            source: "Jupiter Swap V2",
            sourceSymbol: `$${registry.data?.liquidity.probeInputUsd ?? 100} USDC probe`,
            kind: "venue-probe",
            note: "Implied unit price from the selected product's live Jupiter probe; the exact order size is re-quoted before signing.",
          }
        : independentProductQuote;
  const selectedProductPrice = selectedProductQuote?.priceUsd ?? null;
  const estimatedUnits = selectedExactRoute?.available && selectedExactRoute.outputAmount
    ? baseUnitsNumber(selectedExactRoute.outputAmount, selectedExactRoute.outputDecimals)
    : tradeSide === "buy" && selectedProductPrice && selectedProductPrice > 0
      ? deliveredValue / selectedProductPrice
      : 0;
  const hedgeNotional = tradeSide === "buy" && hedgeEnabled ? deliveredValue * 0.8 : 0;
  const solanaWalletConnected = Boolean(solanaConnection?.signer);
  const hasExecutionAdapter = isSolanaExecutionProduct(selectedProduct.id);
  const selectedProductBalance = portfolio.data?.balances.find(
    (balance) => balance.productId === selectedProduct.id,
  );
  const hasEnoughMetal = tradeSide === "buy" || !selectedExactRoute?.inputAmount ||
    BigInt(selectedProductBalance?.rawAmount ?? "0") >= BigInt(selectedExactRoute.inputAmount);
  const registryReady = tradeSide === "buy"
    ? registry.data?.ready === true
    : registry.data?.identity.status === "verified" && registry.data?.onchain.status === "verified";
  const canReview =
    executionControl.enabled &&
    hasExecutionAdapter &&
    registryReady &&
    selectedExactRoute?.available === true &&
    parsedAmount > 0 &&
    solanaWalletConnected &&
    hasEnoughMetal &&
    eligibilityAccepted &&
    /^[A-Z]{2}$/.test(eligibilityCountryCode);
  const crossChainFundingSelected = tradeSide === "buy" && fundingSourceId !== "solana";
  const newRailFundingAllowed = terminalFeatures.railFundingEnabled && executionControl.enabled;
  const canStartSelectedRoute = canReview &&
    (!crossChainFundingSelected || (newRailFundingAllowed && Boolean(evmConnection.address)));
  const connectedWalletCount = Number(Boolean(solanaConnection)) + Number(evmConnection.isConnected);
  const walletSummary = [
    solanaConnection?.account ? `SOL ${shortAddress(solanaConnection.account.address)}` : null,
    evmConnection.address ? `EVM ${shortAddress(evmConnection.address)}` : null,
  ].filter(Boolean).join(" · ");
  const routeNodes = tradeSide === "buy"
    ? ["Solana USDC", selectedProduct.venue, selectedProduct.ticker]
    : [selectedProduct.ticker, selectedProduct.venue, `Solana ${selectedSettlementAsset.symbol}`];

  const updateTerminalUrl = (
    next: { view?: TerminalView; metalId?: string; productId?: string | null },
    mode: "push" | "replace" = "push",
  ) => {
    const url = new URL(window.location.href);
    const nextView = next.view ?? view;
    const nextMetalId = next.metalId ?? selectedMetalId;
    const nextProductId = next.productId === undefined ? selectedProductId : next.productId;

    if (nextView === "markets") url.searchParams.delete("view");
    else url.searchParams.set("view", nextView);
    url.searchParams.set("metal", nextMetalId);
    if (nextProductId) url.searchParams.set("product", nextProductId);
    else url.searchParams.delete("product");

    const nextHref = `${pathname}${url.search}${url.hash}`;
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextHref === currentHref) return;
    window.history[mode === "push" ? "pushState" : "replaceState"](
      window.history.state,
      "",
      nextHref,
    );
  };

  const navigateToView = (nextView: TerminalView) => {
    setView(nextView);
    updateTerminalUrl({ view: nextView });
  };

  const scrollToTerminalTarget = (targetId: string) => {
    if (!window.matchMedia("(max-width: 1020px)").matches) return;
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    });
  };

  const syncPendingFunding = useCallback(() => {
    setPendingFundingSourceId(
      readPendingCctpFunding(window.localStorage)?.sourceId ?? null,
    );
  }, []);

  const closeFundingPanel = useCallback(() => {
    setFundingPanelOpen(false);
    syncPendingFunding();
  }, [syncPendingFunding]);

  useEffect(() => {
    syncPendingFunding();
  }, [syncPendingFunding]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("hedgents:metal-orders");
      if (stored) {
        const parsed = JSON.parse(stored) as unknown;
        if (!Array.isArray(parsed)) throw new Error("Stored order history is malformed.");
        setExecutionRecords(parsed.flatMap((candidate) => {
          try {
            return [normalizeExecutionReceipt(candidate)];
          } catch {
            return [];
          }
        }));
      }
      setEligibilityCountryCode(
        window.localStorage.getItem("hedgents:eligibility-country") ?? "",
      );
    } catch {
      window.localStorage.removeItem("hedgents:metal-orders");
    } finally {
      setRecordsHydrated(true);
    }
  }, []);

  useEffect(() => {
    const nextViewParam = searchParams.get("view");
    const nextView = nextViewParam && terminalViews.has(nextViewParam as TerminalView)
      ? (nextViewParam as TerminalView)
      : initialView;
    const nextMetalParam = searchParams.get("metal");
    const nextMarket = metalMarkets.find((market) => market.id === nextMetalParam) ?? metalMarkets[0];
    const nextProductParam = searchParams.get("product");
    const nextProductId = nextMarket.products.some((product) => product.id === nextProductParam)
      ? nextProductParam
      : null;

    setView(nextView);
    setSelectedMetalId(nextMarket.id);
    setSelectedProductId(nextProductId);
  }, [initialView, searchParams]);

  const pendingRecoveryKey = executionRecords
    .filter(isExecutionRecoveryPending)
    .map((record) => `${record.requestId ?? record.id}:${record.signature}`)
    .join("|");

  useEffect(() => {
    if (!recordsHydrated || !pendingRecoveryKey) return;
    let cancelled = false;
    const recoverPending = async () => {
      const candidates = executionRecords.filter(
        isExecutionRecoveryPending,
      );
      const recovered = await Promise.all(candidates.map(async (record) => {
        try {
          const next = await recoverExecutionRecord(record);
          if (record.settlement?.status !== "verified" && next.settlement?.status === "verified") {
            trackBetaEvent("settlement_verified", {
              productId: record.productId,
              metal: record.metal,
              requestId: record.requestId,
            });
          }
          return next;
        } catch {
          return record;
        }
      }));
      if (cancelled) return;
      setExecutionRecords((current) => {
        const byRequest = new Map(
          recovered.map((record) => [record.requestId ?? record.id, record]),
        );
        const next = current.map((record) => byRequest.get(record.requestId ?? record.id) ?? record);
        window.localStorage.setItem("hedgents:metal-orders", JSON.stringify(next));
        return next;
      });
    };
    void recoverPending();
    const interval = window.setInterval(() => void recoverPending(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pendingRecoveryKey, recordsHydrated]);

  useEffect(() => {
    if (!routeComparison.data) return;
    trackBetaEvent("route_comparison_loaded", {
      metal: selectedMarket.id,
      amountBucket: amountBucket(parsedAmount),
      liveRouteCount: routeComparison.data.routes.filter((route) => route.available).length,
      adapterCount: routeComparison.data.routes.length,
    });
  }, [parsedAmount, routeComparison.data, selectedMarket.id]);

  useEffect(() => {
    if (!routeComparison.error) return;
    trackBetaEvent("route_comparison_failed", {
      metal: selectedMarket.id,
      errorCode: "comparison_unavailable",
      amountBucket: amountBucket(parsedAmount),
    });
  }, [parsedAmount, routeComparison.error, selectedMarket.id]);

  useEffect(() => {
    if (!walletPanelOpen && !reviewOpen && !fundingPanelOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setWalletPanelOpen(false);
      closeFundingPanel();
      if (executionPhase !== "signing" && executionPhase !== "submitting") setReviewOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeFundingPanel, executionPhase, fundingPanelOpen, reviewOpen, walletPanelOpen]);

  const chooseMarket = (market: MetalMarket) => {
    setSelectedMetalId(market.id);
    setSelectedProductId(null);
    setHedgeEnabled(false);
    updateTerminalUrl({ metalId: market.id, productId: null });
    scrollToTerminalTarget("selected-product");
  };

  const chooseProduct = (productId: string) => {
    setSelectedProductId(productId);
    updateTerminalUrl({ metalId: selectedMarket.id, productId });
    scrollToTerminalTarget("order-ticket");
  };

  const chooseTradeSide = (side: TradeSide) => {
    if (side === tradeSide) return;
    setTradeSide(side);
    setAmount(defaultAmountForTradeSide(
      side,
      executionControl.maxUsd,
      selectedProductBalance?.amount,
    ));
    if (side === "buy") {
      setSettlementAssetId("usdc");
      setFundingSourceId("solana");
    }
    if (side === "sell") {
      setFundingSourceId("solana");
      setHedgeEnabled(false);
    }
  };

  const saveExecutionRecord = (record: ExecutionRecord) => {
    setExecutionRecords((current) => {
      const next = [
        record,
        ...current.filter((candidate) =>
          record.requestId
            ? candidate.requestId !== record.requestId
            : candidate.id !== record.id),
      ].slice(0, 25);
      window.localStorage.setItem("hedgents:metal-orders", JSON.stringify(next));
      return next;
    });
  };

  const updateEligibilityCountryCode = (value: string) => {
    const normalized = value.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase();
    setEligibilityCountryCode(normalized);
    window.localStorage.setItem("hedgents:eligibility-country", normalized);
  };

  const retrySettlementRecovery = async (record: ExecutionRecord) => {
    try {
      const recovered = await recoverExecutionRecord(record);
      saveExecutionRecord(recovered);
      if (record.settlement?.status !== "verified" && recovered.settlement?.status === "verified") {
        trackBetaEvent("settlement_verified", {
          productId: record.productId,
          metal: record.metal,
          requestId: record.requestId,
        });
      }
    } catch (error) {
      saveExecutionRecord({
        ...record,
        error: error instanceof Error ? error.message : "Settlement recovery is unavailable.",
      });
    }
  };

  const closeReview = () => {
    if (executionPhase === "signing" || executionPhase === "submitting") return;
    setReviewOpen(false);
  };

  const openReview = async (spotInputAmount = amount) => {
    if (!canReview || !solanaConnection?.account) return;
    setExecutionInputAmount(spotInputAmount);
    setExecutionOrder(null);
    setExecutionResult(null);
    setExecutionError(null);
    setExecutionErrorCode(null);
    setExecutionPhase("ordering");
    setReviewOpen(true);
    trackBetaEvent("order_quote_requested", {
      productId: selectedProduct.id,
      metal: selectedMarket.id,
      amountBucket: amountBucket(Number(spotInputAmount)),
    });
    try {
      const response = await fetch("/api/execution/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: selectedProduct.id,
          side: tradeSide,
          settlementAssetId,
          ...(tradeSide === "buy"
            ? { amountUsd: spotInputAmount }
            : { amountToken: spotInputAmount }),
          taker: solanaConnection.account.address,
          eligibility: {
            countryCode: eligibilityCountryCode,
            legalAge: eligibilityAccepted,
            acceptsIssuerTerms: eligibilityAccepted,
            notRestrictedPerson: eligibilityAccepted,
          },
        }),
      });
      const payload = (await response.json()) as JupiterOrderQuote & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The executable route could not be built.");
      setExecutionOrder(payload);
      setExecutionPhase("ready");
      trackBetaEvent("order_quote_ready", {
        productId: selectedProduct.id,
        metal: selectedMarket.id,
        amountBucket: amountBucket(Number(spotInputAmount)),
      });
    } catch (error) {
      const details = actionableExecutionError(error);
      setExecutionError(`${details.message} ${details.action}`);
      setExecutionErrorCode(details.code);
      setExecutionPhase("failed");
      trackBetaEvent("order_quote_failed", {
        productId: selectedProduct.id,
        metal: selectedMarket.id,
        errorCode: details.code,
        amountBucket: amountBucket(Number(spotInputAmount)),
      });
    }
  };

  const startRoute = () => {
    if (!solanaWalletConnected || (crossChainFundingSelected && !evmConnection.address)) {
      setWalletPanelOpen(true);
      return;
    }
    if (crossChainFundingSelected) {
      if (pendingFundingSourceId && pendingFundingSourceId !== fundingSourceId) {
        setFundingSourceId(pendingFundingSourceId);
        setFundingPanelOpen(true);
        return;
      }
      if (!newRailFundingAllowed) return;
      setFundingPanelOpen(true);
      return;
    }
    void openReview(amount);
  };

  const resumePendingFunding = () => {
    if (!pendingFundingSourceId) return;
    setFundingSourceId(pendingFundingSourceId);
    if (!solanaWalletConnected || !evmConnection.address) {
      setWalletPanelOpen(true);
      return;
    }
    setFundingPanelOpen(true);
  };

  const continueAfterCctpFunding = (receivedAmountBaseUnits: string) => {
    const receivedAmount = baseUnits(receivedAmountBaseUnits, 6);
    setAmount(receivedAmount);
    setFundingPanelOpen(false);
    setPendingFundingSourceId(null);
    void openReview(receivedAmount);
  };

  const submitExecution = async () => {
    if (!executionOrder || !solanaConnection?.account || !eligibilityAccepted) return;
    if (executionOrder.expiresAt && Date.parse(executionOrder.expiresAt) <= Date.now()) {
      setExecutionError("This quote expired. Close the review and build a fresh route.");
      setExecutionErrorCode("quote_expired");
      setExecutionPhase("failed");
      return;
    }

    let pendingRecord: ExecutionRecord | null = null;
    let serverSubmissionState: "not-submitted" | "unknown" | null = null;
    try {
      setExecutionError(null);
      setExecutionErrorCode(null);
      setExecutionPhase("signing");
      trackBetaEvent("order_signature_requested", {
        productId: selectedProduct.id,
        metal: selectedMarket.id,
        amountBucket: amountBucket(parsedAmount),
      });
      const transaction = getTransactionDecoder().decode(decodeBase64(executionOrder.transaction));
      const signer = createTransactionSignerFromWalletAccount(
        solanaConnection.account,
        "solana:mainnet",
      );
      const [signedTransaction] = await signer.modifyAndSignTransactions([transaction]);
      const signedBase64 = encodeBase64(getTransactionEncoder().encode(signedTransaction));
      const signedSignature = String(getSignatureFromTransaction(signedTransaction));

      if (executionControl.rejectionOnly) {
        const message = "The wallet approved the request. The transaction was signed locally, intentionally discarded, and never submitted. No funds moved.";
        setExecutionError(message);
        setExecutionErrorCode("wallet_qa_not_submitted");
        setExecutionPhase("failed");
        trackBetaEvent("wallet_qa_approved", {
          productId: selectedProduct.id,
          metal: selectedMarket.id,
          amountBucket: amountBucket(parsedAmount),
          requestId: executionOrder.requestId,
        });
        return;
      }

      pendingRecord = {
        id: shortAddress(signedSignature),
        productId: selectedProduct.id,
        metal: selectedMarket.name,
        ticker: selectedProduct.ticker,
        side: executionOrder.side,
        settlementAssetId: executionOrder.settlementAssetId,
        inputUsd: executionOrder.side === "buy" ? Number(executionInputAmount) : undefined,
        inputAmount: executionOrder.inputAmount,
        inputDecimals: executionOrder.inputDecimals,
        inputSymbol: executionOrder.side === "buy" ? selectedSettlementAsset.symbol : selectedProduct.ticker,
        outputAmount: executionOrder.outputAmount,
        outputDecimals: executionOrder.outputDecimals,
        outputSymbol: executionOrder.side === "buy" ? selectedProduct.ticker : selectedSettlementAsset.symbol,
        source: "Solana",
        destination: `${executionOrder.side === "buy" ? selectedProduct.ticker : selectedSettlementAsset.symbol} · Solana`,
        status: "Pending",
        submissionState: "unknown",
        walletSigned: true,
        signature: signedSignature,
        timestamp: new Date().toISOString(),
        requestId: executionOrder.requestId,
        recoveryAuthorization: executionOrder.recoveryAuthorization,
        router: executionOrder.router,
        priceImpactPct: executionOrder.priceImpactPct,
        minimumOutputAmount: executionOrder.minimumOutputAmount,
        lastValidBlockHeight: executionOrder.lastValidBlockHeight,
        error: null,
        errorCode: null,
        settlement: {
          status: "pending",
          receivedAmount: null,
          expectedMinimumAmount: executionOrder.minimumOutputAmount,
          verifiedAt: null,
          error: "Signed transaction awaiting independent finalized settlement verification.",
        },
        eligibilityAcknowledged: true,
      };
      saveExecutionRecord(pendingRecord);

      setExecutionPhase("submitting");
      const response = await fetch("/api/execution/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signedTransaction: signedBase64,
          requestId: executionOrder.requestId,
          authorization: executionOrder.authorization,
          lastValidBlockHeight: executionOrder.lastValidBlockHeight,
          eligibility: {
            countryCode: eligibilityCountryCode,
            legalAge: eligibilityAccepted,
            acceptsIssuerTerms: eligibilityAccepted,
            notRestrictedPerson: eligibilityAccepted,
          },
        }),
      });
      const payload = (await response.json()) as JupiterExecutionResult & {
        error?: string;
        submissionState?: "submitted" | "not-submitted" | "unknown";
      };
      serverSubmissionState = payload.submissionState === "not-submitted" ? "not-submitted" : "unknown";
      if (!response.ok && !payload.status) {
        throw new Error(payload.error ?? "The signed route was not accepted.");
      }
      if (payload.submissionState === "submitted") {
        trackBetaEvent("order_submitted", {
          productId: selectedProduct.id,
          metal: selectedMarket.id,
          amountBucket: amountBucket(parsedAmount),
        });
      }
      setExecutionResult(payload);
      const resultFailure = payload.status === "Failed"
        ? actionableExecutionError(payload.error ?? "Jupiter reported a failed execution.")
        : null;
      const record: ExecutionRecord = {
        id: shortAddress(payload.signature ?? signedSignature),
        productId: selectedProduct.id,
        metal: selectedMarket.name,
        ticker: selectedProduct.ticker,
        side: executionOrder.side,
        settlementAssetId: executionOrder.settlementAssetId,
        inputUsd: executionOrder.side === "buy" ? Number(executionInputAmount) : undefined,
        inputAmount: executionOrder.inputAmount,
        inputDecimals: executionOrder.inputDecimals,
        inputSymbol: executionOrder.side === "buy" ? selectedSettlementAsset.symbol : selectedProduct.ticker,
        outputAmount: payload.outputAmount,
        outputDecimals: executionOrder.outputDecimals,
        outputSymbol: executionOrder.side === "buy" ? selectedProduct.ticker : selectedSettlementAsset.symbol,
        source: "Solana",
        destination: `${executionOrder.side === "buy" ? selectedProduct.ticker : selectedSettlementAsset.symbol} · Solana`,
        status: payload.status,
        submissionState: payload.submissionState === "submitted"
          || payload.submissionState === "not-submitted"
          || payload.submissionState === "unknown"
          ? payload.submissionState
          : "unknown",
        walletSigned: true,
        signature: payload.signature ?? signedSignature,
        timestamp: new Date().toISOString(),
        requestId: executionOrder.requestId,
        recoveryAuthorization: executionOrder.recoveryAuthorization,
        router: executionOrder.router,
        priceImpactPct: executionOrder.priceImpactPct,
        minimumOutputAmount: executionOrder.minimumOutputAmount,
        lastValidBlockHeight: executionOrder.lastValidBlockHeight,
        error: payload.error,
        errorCode: resultFailure?.code ?? null,
        settlement: payload.settlement,
        eligibilityAcknowledged: true,
      };
      saveExecutionRecord(record);
      if (payload.status === "Success") {
        setExecutionPhase("success");
        void portfolio.refetch();
        trackBetaEvent("order_confirmed", {
          productId: selectedProduct.id,
          metal: selectedMarket.id,
          amountBucket: amountBucket(parsedAmount),
          requestId: executionOrder.requestId,
        });
        trackBetaEvent(
          payload.settlement?.status === "verified" ? "settlement_verified" : "settlement_pending",
          { productId: selectedProduct.id, metal: selectedMarket.id, requestId: executionOrder.requestId },
        );
      } else if (payload.status === "Pending") {
        setExecutionPhase("success");
        trackBetaEvent("settlement_pending", {
          productId: selectedProduct.id,
          metal: selectedMarket.id,
          requestId: executionOrder.requestId,
        });
      } else {
        const details = resultFailure!;
        setExecutionError(`${details.message} ${details.action}`);
        setExecutionErrorCode(details.code);
        setExecutionPhase("failed");
        trackBetaEvent("order_execution_failed", {
          productId: selectedProduct.id,
          metal: selectedMarket.id,
          errorCode: details.code,
          amountBucket: amountBucket(Number(executionInputAmount)),
        });
      }
    } catch (error) {
      const details = actionableExecutionError(error);
      setExecutionError(`${details.message} ${details.action}`);
      setExecutionErrorCode(details.code);
      setExecutionPhase("failed");
      saveExecutionRecord(pendingRecord ? serverSubmissionState === "not-submitted" ? {
        ...pendingRecord,
        id: `HG-${Date.now().toString().slice(-6)}`,
        status: "Failed",
        submissionState: "not-submitted",
        walletSigned: true,
        signature: null,
        recoveryAuthorization: undefined,
        outputAmount: null,
        settlement: null,
        error: `${details.message} ${details.action} The server blocked submission before any upstream execution call. No funds moved.`,
        errorCode: details.code,
      } : {
        ...pendingRecord,
        submissionState: "unknown",
        error: `${details.message} ${details.action} Submission is unconfirmed; verify this signature before retrying.`,
        errorCode: details.code,
      } : {
        id: `HG-${Date.now().toString().slice(-6)}`,
        productId: selectedProduct.id,
        metal: selectedMarket.name,
        ticker: selectedProduct.ticker,
        side: executionOrder.side,
        settlementAssetId: executionOrder.settlementAssetId,
        inputUsd: executionOrder.side === "buy" ? Number(executionInputAmount) : undefined,
        inputAmount: executionOrder.inputAmount,
        inputDecimals: executionOrder.inputDecimals,
        inputSymbol: executionOrder.side === "buy" ? selectedSettlementAsset.symbol : selectedProduct.ticker,
        outputAmount: null,
        outputDecimals: executionOrder.outputDecimals,
        outputSymbol: executionOrder.side === "buy" ? selectedProduct.ticker : selectedSettlementAsset.symbol,
        source: "Solana",
        destination: `${executionOrder.side === "buy" ? selectedProduct.ticker : selectedSettlementAsset.symbol} · Solana`,
        status: "Failed",
        submissionState: "not-submitted",
        walletSigned: false,
        signature: null,
        timestamp: new Date().toISOString(),
        requestId: executionOrder.requestId,
        recoveryAuthorization: executionOrder.recoveryAuthorization,
        router: executionOrder.router,
        priceImpactPct: executionOrder.priceImpactPct,
        minimumOutputAmount: executionOrder.minimumOutputAmount,
        lastValidBlockHeight: executionOrder.lastValidBlockHeight,
        error: `${details.message} ${details.action}`,
        errorCode: details.code,
        settlement: null,
        eligibilityAcknowledged: eligibilityAccepted,
      });
      trackBetaEvent("order_execution_failed", {
        productId: selectedProduct.id,
        metal: selectedMarket.id,
        errorCode: details.code,
        amountBucket: amountBucket(Number(executionInputAmount)),
      });
    }
  };

  return (
    <div className={classNames(styles.terminal, view === "scarcity" && styles.terminalScarcity)}>
      <a className={styles.skipLink} href="#terminal-content">
        Skip to terminal
      </a>

      <header className={styles.topbar}>
        <button
          className={styles.brand}
          type="button"
          onClick={() => navigateToView("markets")}
          aria-label="Hedgents Metal Terminal home"
        >
          <Image
            src="/brand/hedgents-source-lockup-transparent.png"
            alt=""
            aria-hidden="true"
            width={1275}
            height={355}
            className={styles.brandLogo}
            priority
          />
        </button>

        <nav className={styles.primaryNav} aria-label="Terminal navigation">
          {(["markets", "scarcity", "portfolio", "orders"] as TerminalView[]).map((item) => (
            <button
              type="button"
              key={item}
              className={view === item ? styles.navActive : undefined}
              onClick={() => navigateToView(item)}
            >
              {terminalViewLabels[item]}
            </button>
          ))}
        </nav>

        <div className={styles.topbarActions}>
          <span className={styles.previewPill}>{view === "scarcity" ? "SCX · Curve + event markets" : view === "portfolio" ? "One wallet · Two metal books" : view === "orders" ? "Verified execution history" : "M2 · Two-way Solana execution"}</span>
          <button
            type="button"
            className={styles.walletButton}
            onClick={() => setWalletPanelOpen(true)}
            aria-label={connectedWalletCount > 0 ? "Manage connected wallets" : "Connect wallets"}
          >
            <WalletCards size={15} aria-hidden="true" />
            <span>
              {connectedWalletCount > 0
                ? `${connectedWalletCount} wallet${connectedWalletCount === 1 ? "" : "s"}`
                : "Connect wallets"}
            </span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
        </div>
      </header>

      {view === "markets" ? <section className={styles.capitalRail} aria-label="Selected funding and Solana execution rail">
        <div className={styles.capitalLabel}>
          <span className={styles.pulseDot} />
          Execution rail
        </div>
        <div className={styles.balanceTrack}>
          {executionRail.map((item) => (
            <div
              key={item.id}
              className={classNames(
                styles.balanceItem,
                styles.balanceItemActive,
              )}
            >
              <i style={{ background: item.tone }} />
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>Mainnet</small>
            </div>
          ))}
        </div>
        <div className={styles.railSummary}>
          <span>Wallet handoff</span>
          <strong>
            {walletSummary || "Connect source + settlement"}
          </strong>
        </div>
      </section> : null}

      <main id="terminal-content" className={classNames(styles.main, view === "scarcity" && styles.mainScarcity)}>
        {view === "markets" ? (
          <MarketsView
            filteredMarkets={filteredMarkets}
            selectedMarket={selectedMarket}
            selectedProductId={selectedProduct.id}
            laneFilter={laneFilter}
            onlyExecutable={onlyExecutable}
            query={query}
            amount={amount}
            tradeSide={tradeSide}
            settlementAssetId={settlementAssetId}
            selectedProductBalance={selectedProductBalance?.amount ?? "0"}
            routeFee={routeFee}
            estimatedUnits={estimatedUnits}
            hedgeEnabled={hedgeEnabled}
            hedgeNotional={hedgeNotional}
            routeNodes={routeNodes}
            executionControl={executionControl}
            railFundingEnabled={terminalFeatures.railFundingEnabled}
            canReview={canReview}
            canStartSelectedRoute={canStartSelectedRoute}
            fundingSourceId={fundingSourceId}
            pendingFundingSourceId={pendingFundingSourceId}
            eligibilityAccepted={eligibilityAccepted}
            eligibilityCountryCode={eligibilityCountryCode}
            quoteData={liveQuotes.data}
            selectedProductQuote={selectedProductQuote}
            quoteError={liveQuotes.error}
            quoteLoading={liveQuotes.isLoading}
            quoteRefreshing={liveQuotes.isRefreshing}
            registryHealth={registry.data}
            registryLoading={registry.isLoading}
            registryError={registry.error?.message ?? null}
            routeComparison={routeComparison.data}
            routeComparisonLoading={routeComparison.isLoading}
            routeComparisonError={routeComparison.error?.message ?? null}
            bestRouteProductIds={bestRouteProductIds}
            walletConnected={solanaWalletConnected}
            onQueryChange={setQuery}
            onLaneChange={setLaneFilter}
            onExecutableChange={setOnlyExecutable}
            onChooseMarket={chooseMarket}
            onChooseProduct={chooseProduct}
            onAmountChange={setAmount}
            onTradeSideChange={chooseTradeSide}
            onSettlementAssetChange={setSettlementAssetId}
            onHedgeChange={setHedgeEnabled}
            onFundingSourceChange={setFundingSourceId}
            onResumePendingFunding={resumePendingFunding}
            onEligibilityChange={setEligibilityAccepted}
            onEligibilityCountryChange={updateEligibilityCountryCode}
            onReview={startRoute}
            onConnectWallet={() => setWalletPanelOpen(true)}
            onRefreshQuotes={() => void liveQuotes.refresh()}
          />
        ) : view === "scarcity" ? (
          <ScarcityExchange markets={scarcityMarkets} />
        ) : view === "portfolio" ? (
          <PortfolioView
            owner={solanaConnection?.account.address ?? null}
            snapshot={portfolio.data}
            loading={portfolio.isLoading}
            refreshing={portfolio.isFetching}
            error={portfolio.error?.message ?? null}
            quotes={liveQuotes.data}
            records={executionRecords}
            scarcityMarkets={scarcityMarkets}
            onConnectWallet={() => setWalletPanelOpen(true)}
            onRefresh={() => void portfolio.refetch()}
            onNavigateToMarkets={() => navigateToView("markets")}
            onNavigateToScarcity={() => navigateToView("scarcity")}
            onSell={(productId, balance) => {
              const market = metalMarkets.find((item) => item.products.some((product) => product.id === productId));
              if (market) setSelectedMetalId(market.id);
              setSelectedProductId(productId);
              setTradeSide("sell");
              setFundingSourceId("solana");
              setHedgeEnabled(false);
              setAmount(balance);
              setView("markets");
              updateTerminalUrl({ view: "markets", metalId: market?.id ?? selectedMetalId, productId });
            }}
          />
        ) : (
          <OrdersView
            records={executionRecords}
            onRecover={(record) => void retrySettlementRecovery(record)}
            onImport={(record) => saveExecutionRecord(record)}
          />
        )}
      </main>

      <footer className={styles.footer}>
        <span>Hg / Metal intelligence + execution</span>
        <span>{view === "scarcity" ? `${scarcityMarkets.length} scarcity contracts · ${SCARCITY_TRACKED_ELEMENT_COUNT}-cell materials oracle` : `${registeredAdapterCount} registered Solana adapters · Live Jupiter execution gate`}</span>
        <span className={styles.networkStatus}>
          <i /> Terminal online
        </span>
      </footer>

      {walletPanelOpen ? (
        <WalletPanel
          railFundingEnabled={terminalFeatures.railFundingEnabled}
          onClose={() => setWalletPanelOpen(false)}
        />
      ) : null}

      {fundingPanelOpen && fundingSourceId !== "solana" && evmConnection.address && solanaConnection?.account ? (
        <CctpFundingPanel
          sourceId={fundingSourceId}
          amountUsd={amount}
          sourceAddress={evmConnection.address}
          destinationAddress={solanaConnection.account.address}
          productName={selectedProduct.name}
          ticker={selectedProduct.ticker}
          allowNewFunding={newRailFundingAllowed}
          canContinueToMetal={executionControl.enabled}
          onFunded={continueAfterCctpFunding}
          onClose={closeFundingPanel}
        />
      ) : null}

      {reviewOpen ? (
        <ReviewPanel
          selectedMarket={selectedMarket}
          side={tradeSide}
          settlementSymbol={selectedSettlementAsset.symbol}
          productName={selectedProduct.name}
          ticker={selectedProduct.ticker}
          settlementChain={selectedProduct.settlementChain}
          venue={selectedProduct.venue}
          amount={Number.parseFloat(executionInputAmount) || 0}
          estimatedUnits={estimatedUnits}
          routeFee={routeFee}
          routeNodes={routeNodes}
          hedgeNotional={hedgeNotional}
          hedgeMarket={selectedProduct.hedgeMarket}
          quote={selectedProductQuote}
          eligibility={selectedProduct.eligibility}
          eligibilityCountryCode={eligibilityCountryCode}
          issuerTermsUrl={getSolanaExecutionProduct(selectedProduct.id)?.sources.find((source) => source.kind === "issuer")?.url}
          eligibilityAccepted={eligibilityAccepted}
          executionRisk={registry.data?.controls.note ?? selectedProduct.risk}
          order={executionOrder}
          result={executionResult}
          phase={executionPhase}
          error={executionError}
          errorCode={executionErrorCode}
          rejectionOnly={executionControl.rejectionOnly}
          onEligibilityChange={setEligibilityAccepted}
          onConfirm={() => void submitExecution()}
          onClose={closeReview}
        />
      ) : null}
    </div>
  );
}

interface MarketsViewProps {
  filteredMarkets: MetalMarket[];
  selectedMarket: MetalMarket;
  selectedProductId: string;
  laneFilter: LaneFilter;
  onlyExecutable: boolean;
  query: string;
  amount: string;
  tradeSide: TradeSide;
  settlementAssetId: SettlementAssetId;
  selectedProductBalance: string;
  routeFee: number;
  estimatedUnits: number;
  hedgeEnabled: boolean;
  hedgeNotional: number;
  routeNodes: string[];
  executionControl: PublicExecutionControls;
  railFundingEnabled: boolean;
  canReview: boolean;
  canStartSelectedRoute: boolean;
  fundingSourceId: FundingSourceId;
  pendingFundingSourceId: CctpSourceId | null;
  eligibilityAccepted: boolean;
  eligibilityCountryCode: string;
  quoteData: MetalQuoteResponse | null;
  selectedProductQuote: LiveQuote | undefined;
  quoteError: string | null;
  quoteLoading: boolean;
  quoteRefreshing: boolean;
  registryHealth: RegistryHealth | undefined;
  registryLoading: boolean;
  registryError: string | null;
  routeComparison: RouteComparisonResponse | undefined;
  routeComparisonLoading: boolean;
  routeComparisonError: string | null;
  bestRouteProductIds: Set<string>;
  walletConnected: boolean;
  onQueryChange: (value: string) => void;
  onLaneChange: (lane: LaneFilter) => void;
  onExecutableChange: (value: boolean) => void;
  onChooseMarket: (market: MetalMarket) => void;
  onChooseProduct: (productId: string) => void;
  onAmountChange: (value: string) => void;
  onTradeSideChange: (value: TradeSide) => void;
  onSettlementAssetChange: (value: SettlementAssetId) => void;
  onHedgeChange: (value: boolean) => void;
  onFundingSourceChange: (value: FundingSourceId) => void;
  onResumePendingFunding: () => void;
  onEligibilityChange: (value: boolean) => void;
  onEligibilityCountryChange: (value: string) => void;
  onReview: () => void;
  onConnectWallet: () => void;
  onRefreshQuotes: () => void;
}

function MarketsView({
  filteredMarkets,
  selectedMarket,
  selectedProductId,
  laneFilter,
  onlyExecutable,
  query,
  amount,
  tradeSide,
  settlementAssetId,
  selectedProductBalance,
  routeFee,
  estimatedUnits,
  hedgeEnabled,
  hedgeNotional,
  routeNodes,
  executionControl,
  railFundingEnabled,
  canReview,
  canStartSelectedRoute,
  fundingSourceId,
  pendingFundingSourceId,
  eligibilityAccepted,
  eligibilityCountryCode,
  quoteData,
  selectedProductQuote,
  quoteError,
  quoteLoading,
  quoteRefreshing,
  registryHealth,
  registryLoading,
  registryError,
  routeComparison,
  routeComparisonLoading,
  routeComparisonError,
  bestRouteProductIds,
  walletConnected,
  onQueryChange,
  onLaneChange,
  onExecutableChange,
  onChooseMarket,
  onChooseProduct,
  onAmountChange,
  onTradeSideChange,
  onSettlementAssetChange,
  onHedgeChange,
  onFundingSourceChange,
  onResumePendingFunding,
  onEligibilityChange,
  onEligibilityCountryChange,
  onReview,
  onConnectWallet,
  onRefreshQuotes,
}: MarketsViewProps) {
  const selectedProduct =
    selectedMarket.products.find((product) => product.id === selectedProductId) ??
    selectedMarket.products[0];
  const executionProduct = getSolanaExecutionProduct(selectedProduct.id);
  const comparisonByProduct = new Map(
    routeComparison?.routes
      .filter((route) => route.settlementAssetId === settlementAssetId)
      .map((route) => [route.productId, route]) ?? [],
  );
  const selectedExactRoute = comparisonByProduct.get(selectedProduct.id);

  return (
    <>
      <section className={styles.marketMasthead}>
        <div>
          <p className={styles.overline}>Metal universe / live registry</p>
          <h1>
            Choose the metal.
            <em> We find the market.</em>
          </h1>
        </div>
        <div className={styles.marketStats}>
          <span>
            <small>Tracked</small>
            <strong>{String(metalMarkets.length).padStart(2, "0")}</strong>
          </span>
          <span>
            <small>Products</small>
            <strong>{String(trackedProductCount).padStart(2, "0")}</strong>
          </span>
          <span>
            <small>Adapters</small>
            <strong>{String(registeredAdapterCount).padStart(2, "0")}</strong>
          </span>
        </div>
      </section>

      <div className={styles.workspace}>
        <div className={styles.marketColumn}>
          <section className={styles.marketPanel}>
            <div className={styles.panelToolbar}>
              <label className={styles.searchBox}>
                <Search size={14} aria-hidden="true" />
                <span className={styles.srOnly}>Search metals and products</span>
                <input
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="Search metal or product"
                />
              </label>
              <div className={styles.filterGroup} aria-label="Exposure filters">
                {laneFilters.map((lane) => (
                  <button
                    type="button"
                    key={lane}
                    className={laneFilter === lane ? styles.filterActive : undefined}
                    onClick={() => onLaneChange(lane)}
                  >
                    {lane}
                  </button>
                ))}
              </div>
              <label className={styles.liveFilter}>
                <input
                  type="checkbox"
                  checked={onlyExecutable}
                  onChange={(event) => onExecutableChange(event.target.checked)}
                />
                <span />
                Mapped only
              </label>
            </div>

            <div className={styles.marketTable}>
              <div className={styles.marketTableHeader} aria-hidden="true">
                <span>Metal</span>
                <span>Product coverage</span>
                <span>Reference</span>
                <span>24h</span>
                <span>Registry state</span>
              </div>
              <ul className={styles.marketRows} aria-label="Metal product market">
                {filteredMarkets.map((market, index) => {
                  const lanes = [...new Set(market.products.map((product) => product.lane))];
                  const selected = market.id === selectedMarket.id;
                  const marketQuote = quoteData?.markets[market.id];
                  const displayPrice = marketQuote?.priceUsd;
                  const displayChange = marketQuote?.change24h;
                  return (
                    <li key={market.id}>
                      <button
                        type="button"
                        className={classNames(styles.marketRow, selected && styles.marketRowSelected)}
                        onClick={() => onChooseMarket(market)}
                        style={{ "--row-index": index } as React.CSSProperties}
                        aria-pressed={selected}
                      >
                        <span className={styles.metalIdentity}>
                          <ElementMark market={market} compact />
                          <span>
                            <strong>{market.name}</strong>
                            <small>{market.family}</small>
                          </span>
                        </span>
                        <span className={styles.coverageCell}>
                          <strong>
                            {market.products.length} product{market.products.length === 1 ? "" : "s"}
                          </strong>
                          <small>{lanes.join(" · ")}</small>
                        </span>
                        <span className={styles.priceCell}>
                          <strong>
                            {displayPrice != null
                              ? currency(displayPrice, displayPrice < 10 ? 4 : 2)
                              : quoteLoading
                                ? currency(market.referencePrice)
                                : "—"}
                          </strong>
                          <small>{quoteLabel(marketQuote, quoteLoading)} · per {market.unit}</small>
                        </span>
                        <span
                          className={classNames(
                            styles.changeCell,
                            (displayChange ?? 0) >= 0 ? styles.positive : styles.negative,
                          )}
                        >
                          {displayChange == null
                            ? "—"
                            : `${displayChange >= 0 ? "+" : ""}${displayChange.toFixed(2)}%`}
                        </span>
                        <span className={styles.routeStateCell}>
                          <StatusBadge status={market.availability} />
                          <ChevronRight size={15} aria-hidden="true" />
                        </span>
                      </button>
                    </li>
                  );
                })}
                {filteredMarkets.length === 0 ? (
                  <li className={styles.emptyMarkets}>
                    <SlidersHorizontal size={18} aria-hidden="true" />
                    No products match these filters.
                    <button type="button" onClick={() => onLaneChange("All")}>
                      Clear exposure filter
                    </button>
                  </li>
                ) : null}
              </ul>
            </div>
          </section>

          <section id="selected-product" className={styles.productPanel}>
            <div className={styles.productHeader}>
              <div className={styles.productTitle}>
                <ElementMark market={selectedMarket} />
                <div>
                  <p className={styles.overline}>Selected metal / product comparison</p>
                  <h2>{selectedMarket.name}</h2>
                  <span>
                    {selectedMarket.products.length} mapped product
                    {selectedMarket.products.length === 1 ? "" : "s"} · Reference {" "}
                    {quoteData?.markets[selectedMarket.id]?.priceUsd != null
                      ? currency(
                          quoteData.markets[selectedMarket.id].priceUsd!,
                          quoteData.markets[selectedMarket.id].priceUsd! < 10 ? 4 : 2,
                        )
                      : "No live price"} / {selectedMarket.unit}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className={styles.referenceStamp}
                onClick={onRefreshQuotes}
                disabled={quoteRefreshing}
                title={quoteError ?? "Refresh Pyth references"}
              >
                <RefreshCw
                  size={13}
                  aria-hidden="true"
                  className={quoteRefreshing ? styles.spin : undefined}
                />
                {quoteLabel(quoteData?.markets[selectedMarket.id], quoteLoading)}
                {quoteAge(quoteData?.markets[selectedMarket.id])
                  ? ` · ${quoteAge(quoteData?.markets[selectedMarket.id])}`
                  : ""}
              </button>
            </div>

            <div className={styles.productTabs} role="tablist" aria-label="Available products">
              {selectedMarket.products.map((product) => {
                const exactRoute = comparisonByProduct.get(product.id);
                const routeLabel = !isSolanaExecutionProduct(product.id)
                  ? "Monitoring only"
                  : routeComparisonLoading && !exactRoute
                    ? "Checking exact size"
                    : exactRoute?.available
                      ? bestRouteProductIds.has(product.id)
                        ? "Best equivalent route"
                        : "Live at this size"
                      : exactRoute
                        ? routeAvailabilityLabel(exactRoute.availabilityReason)
                        : "Unavailable at this size";
                return <button
                  type="button"
                  role="tab"
                  aria-selected={product.id === selectedProduct.id}
                  key={product.id}
                  className={classNames(
                    product.id === selectedProduct.id && styles.productTabActive,
                    exactRoute?.available === false && styles.productTabUnavailable,
                  )}
                  onClick={() => onChooseProduct(product.id)}
                >
                  <span>{routeLabel}</span>
                  <strong>{product.name}</strong>
                  <small>
                    {exactRoute?.available && exactRoute.outputAmount
                      ? `${baseUnits(exactRoute.outputAmount, exactRoute.outputDecimals, 5)} ${tradeSide === "buy" ? product.ticker : getSolanaSettlementAsset(settlementAssetId)?.symbol ?? "stable"}`
                      : `${product.ticker} · ${product.settlementChain}`}
                  </small>
                </button>;
              })}
            </div>

            <div className={styles.comparisonStatus} role="status">
              <span>
                <Radio size={12} aria-hidden="true" /> Exact-size route monitor
              </span>
              <strong>
                {routeComparisonLoading && !routeComparison
                  ? "Checking registered adapters…"
                  : routeComparison
                    ? `${routeComparison.routes.filter((route) => route.available).length}/${routeComparison.routes.length} live`
                    : "Comparison unavailable"}
              </strong>
              <small>
                {routeComparisonError ?? (tradeSide === "buy"
                  ? "“Best” is shown only between tokens representing the same underlying exposure."
                  : "USDC, USDT, and USDG exits are quoted independently; choose the settlement asset you actually want.")}
              </small>
            </div>
          </section>

        <section
          className={classNames(styles.productPanel, styles.productDetailsPanel)}
          aria-label={`${selectedProduct.name} product passport`}
        >
          <div className={styles.passport}>
              <div className={styles.passportLead}>
                <div className={styles.passportLeadTop}>
                  <span className={styles.laneBadge}>{selectedProduct.lane}</span>
                  <StatusBadge
                    status={executionProduct && ((tradeSide === "buy"
                      ? registryHealth?.ready !== true
                      : registryHealth?.identity.status !== "verified" || registryHealth?.onchain.status !== "verified") || selectedExactRoute?.available !== true)
                      ? "Indicative"
                      : selectedProduct.availability}
                    live={Boolean(
                      executionProduct &&
                      (tradeSide === "buy"
                        ? registryHealth?.ready === true
                        : registryHealth?.identity.status === "verified" && registryHealth?.onchain.status === "verified") &&
                      selectedExactRoute?.available === true
                    )}
                  />
                </div>
                <p>A ticker is not a product definition.</p>
                <h3>{selectedProduct.structure}</h3>
                <span>{selectedProduct.risk}</span>
                {executionProduct ? (
                  <div className={styles.provenanceSources}>
                    {executionProduct.sources.map((source) => (
                      <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                        {source.label} <ArrowUpRight size={12} aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <span className={styles.provenancePending}>Canonical source verification pending</span>
                )}
              </div>
              <dl className={styles.passportGrid}>
                <div>
                  <dt>Issuer</dt>
                  <dd>{selectedProduct.issuer}</dd>
                </div>
                <div>
                  <dt>What backs it</dt>
                  <dd>{selectedProduct.backing}</dd>
                </div>
                <div>
                  <dt>Custody</dt>
                  <dd>{selectedProduct.custody}</dd>
                </div>
                <div>
                  <dt>Redemption</dt>
                  <dd>{selectedProduct.redemption}</dd>
                </div>
                <div>
                  <dt>Eligibility</dt>
                  <dd>{selectedProduct.eligibility}</dd>
                </div>
                <div>
                  <dt>Liquidity</dt>
                  <dd>{selectedProduct.liquidity}</dd>
                </div>
              </dl>
              <div className={styles.passportFooter}>
                <span>
                  <ShieldCheck size={14} aria-hidden="true" /> Last checked {selectedProduct.verified}
                </span>
                <span>
                  Settlement <strong>{selectedProduct.settlementChain}</strong>
                </span>
                <span>
                  Execution <strong>{selectedProduct.venue}</strong>
                </span>
              </div>
              {executionProduct ? (
                <div className={styles.registryHealth}>
                  <span className={registryHealth?.identity.status === "verified" ? styles.checkPassed : undefined}>
                    <i /> Canonical mint {registryLoading ? "checking" : registryHealth?.identity.status ?? "unavailable"}
                  </span>
                  <span className={registryHealth?.onchain.status === "verified" ? styles.checkPassed : undefined}>
                    <i /> {executionProduct.tokenProgram} account {registryLoading ? "checking" : registryHealth?.onchain.status ?? "unavailable"}
                  </span>
                  <span className={registryHealth?.liquidity.status === "verified" ? styles.checkPassed : undefined}>
                    <i /> $100 route probe {registryLoading ? "checking" : registryHealth?.liquidity.status ?? "unavailable"}
                  </span>
                  {registryError ? <small>{registryError}</small> : null}
                </div>
              ) : null}
          </div>
        </section>
        </div>

        <OrderTicket
          market={selectedMarket}
          productId={selectedProduct.id}
          amount={amount}
          tradeSide={tradeSide}
          settlementAssetId={settlementAssetId}
          selectedProductBalance={selectedProductBalance}
          routeFee={routeFee}
          estimatedUnits={estimatedUnits}
          hedgeEnabled={hedgeEnabled}
          hedgeNotional={hedgeNotional}
          routeNodes={routeNodes}
          executionControl={executionControl}
          railFundingEnabled={railFundingEnabled}
          canReview={canReview}
          canStartSelectedRoute={canStartSelectedRoute}
          fundingSourceId={fundingSourceId}
          pendingFundingSourceId={pendingFundingSourceId}
          eligibilityAccepted={eligibilityAccepted}
          eligibilityCountryCode={eligibilityCountryCode}
          quote={selectedProductQuote}
          quoteLoading={quoteLoading}
          walletConnected={walletConnected}
          executionServiceReady={tradeSide === "buy"
            ? registryHealth?.ready === true
            : registryHealth?.identity.status === "verified" && registryHealth?.onchain.status === "verified"}
          executionServiceLoading={registryLoading}
          executionServiceStatus={registryHealth?.liquidity.status ?? null}
          exactRoute={selectedExactRoute}
          routeComparisonLoading={routeComparisonLoading}
          routeComparisonError={routeComparisonError}
          isBestEquivalentRoute={bestRouteProductIds.has(selectedProduct.id)}
          onAmountChange={onAmountChange}
          onTradeSideChange={onTradeSideChange}
          onSettlementAssetChange={onSettlementAssetChange}
          onHedgeChange={onHedgeChange}
          onFundingSourceChange={onFundingSourceChange}
          onResumePendingFunding={onResumePendingFunding}
          onEligibilityChange={onEligibilityChange}
          onEligibilityCountryChange={onEligibilityCountryChange}
          onReview={onReview}
          onConnectWallet={onConnectWallet}
          onRefreshQuote={onRefreshQuotes}
        />
      </div>
    </>
  );
}

interface OrderTicketProps {
  market: MetalMarket;
  productId: string;
  amount: string;
  tradeSide: TradeSide;
  settlementAssetId: SettlementAssetId;
  selectedProductBalance: string;
  routeFee: number;
  estimatedUnits: number;
  hedgeEnabled: boolean;
  hedgeNotional: number;
  routeNodes: string[];
  executionControl: PublicExecutionControls;
  railFundingEnabled: boolean;
  canReview: boolean;
  canStartSelectedRoute: boolean;
  fundingSourceId: FundingSourceId;
  pendingFundingSourceId: CctpSourceId | null;
  eligibilityAccepted: boolean;
  eligibilityCountryCode: string;
  quote: LiveQuote | undefined;
  quoteLoading: boolean;
  walletConnected: boolean;
  executionServiceReady: boolean;
  executionServiceLoading: boolean;
  executionServiceStatus: RegistryHealth["liquidity"]["status"] | null;
  exactRoute: ProductRouteComparison | undefined;
  routeComparisonLoading: boolean;
  routeComparisonError: string | null;
  isBestEquivalentRoute: boolean;
  onAmountChange: (value: string) => void;
  onTradeSideChange: (value: TradeSide) => void;
  onSettlementAssetChange: (value: SettlementAssetId) => void;
  onHedgeChange: (value: boolean) => void;
  onFundingSourceChange: (value: FundingSourceId) => void;
  onResumePendingFunding: () => void;
  onEligibilityChange: (value: boolean) => void;
  onEligibilityCountryChange: (value: string) => void;
  onReview: () => void;
  onConnectWallet: () => void;
  onRefreshQuote: () => void;
}

function OrderTicket({
  market,
  productId,
  amount,
  tradeSide,
  settlementAssetId,
  selectedProductBalance,
  routeFee,
  estimatedUnits,
  hedgeEnabled,
  hedgeNotional,
  routeNodes,
  executionControl,
  railFundingEnabled,
  canReview,
  canStartSelectedRoute,
  fundingSourceId,
  pendingFundingSourceId,
  eligibilityAccepted,
  eligibilityCountryCode,
  quote,
  quoteLoading,
  walletConnected,
  executionServiceReady,
  executionServiceLoading,
  executionServiceStatus,
  exactRoute,
  routeComparisonLoading,
  routeComparisonError,
  isBestEquivalentRoute,
  onAmountChange,
  onTradeSideChange,
  onSettlementAssetChange,
  onHedgeChange,
  onFundingSourceChange,
  onResumePendingFunding,
  onEligibilityChange,
  onEligibilityCountryChange,
  onReview,
  onConnectWallet,
  onRefreshQuote,
}: OrderTicketProps) {
  const product = market.products.find((item) => item.id === productId) ?? market.products[0];
  const settlementAsset = getSolanaSettlementAsset(settlementAssetId) ?? solanaSettlementAssets.usdc;
  const executionAdapterReady = isSolanaExecutionProduct(product.id);
  const selectedFundingSource =
    fundingSources.find((source) => source.id === fundingSourceId) ?? fundingSources[0];
  const pendingFundingSource = pendingFundingSourceId
    ? fundingSources.find((source) => source.id === pendingFundingSourceId) ?? null
    : null;
  const crossChainFundingSelected = tradeSide === "buy" && fundingSourceId !== "solana";
  const insufficientMetal = tradeSide === "sell" && Number(amount) > Number(selectedProductBalance);
  const shouldConnectWallet =
    executionControl.enabled && executionAdapterReady && executionServiceReady && exactRoute?.available === true && !walletConnected;
  const displayedRouteNodes = crossChainFundingSelected
    ? [
        `${selectedFundingSource.label} USDC`,
        "Circle CCTP V2",
        ...routeNodes,
      ]
    : routeNodes;
  return (
    <aside id="order-ticket" className={styles.ticket} aria-label="Order route">
      <div className={styles.ticketTopline}>
        <div>
          <p className={styles.overline}>Order / Solana two-way execution</p>
          <h2>{tradeSide === "buy" ? `Buy ${market.name}` : `Sell ${product.ticker}`}</h2>
        </div>
        <ElementMark market={market} compact />
      </div>

      <div
        className={classNames(
          styles.betaExecutionControl,
          !executionControl.enabled && styles.betaExecutionControlPaused,
        )}
        role="status"
      >
        <span>{executionControl.rejectionOnly ? "Wallet QA" : executionControl.enabled ? "Closed beta" : "Execution paused"}</span>
        <strong>
          {executionControl.rejectionOnly
            ? `$${executionControl.maxUsd.toLocaleString()} approval test`
            : executionControl.enabled
            ? `$${executionControl.maxUsd.toLocaleString()} maximum per trade`
            : "New quotes and orders are disabled"}
        </strong>
        <small>
          {executionControl.rejectionOnly
            ? "Approved transactions are discarded locally; the server submission guard remains hard-disabled as a second backstop."
            : executionControl.enabled
            ? "The cap is enforced again by the server at quote, order, and submission."
            : "Pending onchain receipts remain recoverable from Orders."}
        </small>
      </div>

      <div className={styles.tradeSidePicker} role="group" aria-label="Trade direction">
        {(["buy", "sell"] as TradeSide[]).map((side) => (
          <button
            type="button"
            key={side}
            aria-pressed={tradeSide === side}
            onClick={() => onTradeSideChange(side)}
          >
            <span>{side}</span>
            <small>{side === "buy" ? "Stable → metal" : "Metal → stable"}</small>
          </button>
        ))}
      </div>

      {tradeSide === "buy" ? (
        <div className={styles.fundingSourcePicker}>
          <span>Pay USDC from</span>
          <div role="group" aria-label="Purchase funding chain">
            {fundingSources.filter((source) => source.id === "solana" || railFundingEnabled).map((source) => (
              <button
                type="button"
                key={source.id}
                aria-pressed={source.id === fundingSourceId}
                onClick={() => onFundingSourceChange(source.id)}
              >
                <i style={{ background: source.tone }} />
                <strong>{source.label}</strong>
                <small>{source.note}</small>
              </button>
            ))}
            {pendingFundingSourceId && pendingFundingSource ? (
              <button
                type="button"
                onClick={onResumePendingFunding}
                aria-label={`Resume pending ${pendingFundingSource.label} CCTP delivery`}
              >
                <i style={{ background: pendingFundingSource.tone }} />
                <strong>Resume {pendingFundingSource.label}</strong>
                <small>Pending delivery</small>
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={styles.settlementPicker}>
          <span>Receive on Solana</span>
          <div role="group" aria-label="Sale settlement asset">
            {Object.values(solanaSettlementAssets).map((asset) => (
              <button
                type="button"
                key={asset.id}
                aria-pressed={asset.id === settlementAssetId}
                onClick={() => onSettlementAssetChange(asset.id)}
              >
                <strong>{asset.symbol}</strong>
                <small>{asset.issuer}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.ticketProduct}>
        <span>{product.lane}</span>
        <div>
          <strong>{product.name}</strong>
          <small>Selected product · {product.ticker} on {product.settlementChain}</small>
        </div>
        <StatusBadge
          status={executionAdapterReady && (!executionServiceReady || exactRoute?.available !== true)
            ? "Indicative"
            : product.availability}
          live={executionAdapterReady && executionServiceReady && exactRoute?.available === true}
        />
      </div>

      <div
        className={classNames(
          styles.liveQuoteStrip,
          quote?.priceUsd != null && styles.liveQuoteStripReady,
        )}
      >
        <span><Radio size={13} aria-hidden="true" /> {quoteLabel(quote, quoteLoading)}</span>
        <strong>
          {quote?.priceUsd != null
            ? currency(quote.priceUsd, quote.priceUsd < 10 ? 4 : 2)
            : "No price"}
        </strong>
        <button type="button" onClick={onRefreshQuote} aria-label="Refresh live quote">
          <RefreshCw size={12} aria-hidden="true" />
        </button>
        <small>
          {quote?.sourceSymbol ?? "Provider not configured"}
          {quoteAge(quote) ? ` · ${quoteAge(quote)}` : ""}
        </small>
      </div>

      <div className={styles.amountHeader}>
        <label className={styles.fieldLabel} htmlFor="trade-amount">
          {tradeSide === "buy" ? "Spend" : "Sell"}
        </label>
        <span>
          {tradeSide === "sell"
            ? `Wallet balance · ${selectedProductBalance} ${product.ticker}`
            : crossChainFundingSelected
              ? "CCTP fees quoted before signing"
              : "Solana balance checked at execution"}
        </span>
      </div>
      <div className={styles.amountInput}>
        <span>{tradeSide === "buy" ? "$" : product.ticker}</span>
        <input
          id="trade-amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value.replace(/[^0-9.]/g, ""))}
          aria-describedby="amount-output"
        />
        {tradeSide === "sell" ? (
          <button type="button" onClick={() => onAmountChange(selectedProductBalance)}>Max</button>
        ) : <span>USDC</span>}
      </div>
      {tradeSide === "buy" ? (
        <div className={styles.amountPresets} role="group" aria-label="Suggested purchase amounts">
          {buyAmountPresets.filter((preset) => preset <= executionControl.maxUsd).map((preset) => (
            <button
              type="button"
              key={preset}
              aria-pressed={Number(amount) === preset}
              onClick={() => onAmountChange(String(preset))}
            >
              {currency(preset, 0)}
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.receiveQuote} id="amount-output">
        <span>{exactRoute?.available ? "You receive · protected estimate" : "Receive estimate"}</span>
        <strong>
          {exactRoute?.available
            ? `${estimatedUnits.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${tradeSide === "buy" ? product.ticker : settlementAsset.symbol}`
            : routeComparisonLoading
              ? "Checking exact-size route…"
              : "No executable route at this size"}
        </strong>
        <small>
          {exactRoute?.available
            ? `${isBestEquivalentRoute ? "Best live output among equivalent products · " : ""}${exactRoute.router ?? "Jupiter"} · ${exactRoute.priceImpactPct?.toFixed(4) ?? "—"}% impact`
            : exactRoute
              ? `${routeAvailabilityLabel(exactRoute.availabilityReason)}${exactRoute.error ? ` · ${exactRoute.error}` : ""}`
              : routeComparisonError ?? quote?.note ?? "The route monitor has not returned a quote."}
        </small>
      </div>

      <details className={styles.ticketDetails}>
        <summary>
          <span><Route size={14} aria-hidden="true" /> Route &amp; fees</span>
          <small>Exact-size details <ChevronDown size={13} aria-hidden="true" /></small>
        </summary>
        <div className={styles.ticketDetailsBody}>
          <div className={styles.routeBlock}>
            <div className={styles.blockHeading}>
              <span>Selected execution route</span>
              <small><Clock3 size={12} aria-hidden="true" /> mainnet</small>
            </div>
            <div className={styles.routePath}>
              {displayedRouteNodes.map((node, index) => (
                <span key={`${node}-${index}`}>
                  <i>{index + 1}</i>
                  <small>{node}</small>
                  {index < displayedRouteNodes.length - 1 ? <ArrowRight size={12} aria-hidden="true" /> : null}
                </span>
              ))}
            </div>
            <p>
              {executionAdapterReady
                ? tradeSide === "sell"
                  ? `Hedgents pins the ${product.ticker} input mint and ${settlementAsset.symbol} output mint, builds the exact-size reverse Jupiter route, simulates it, and verifies the ${settlementAsset.symbol} increase in your wallet.`
                  : crossChainFundingSelected
                  ? "The external Rail SDK first moves native USDC to your Solana wallet through Circle CCTP. After verified delivery, Hedgents rebuilds and simulates the Jupiter metal order for a separate Solana approval."
                  : "Hedgents pins the product mint, requests the exact-size Jupiter route, simulates it, and returns the metal directly to your connected Solana wallet."
                : "This product is mapped for comparison only. Hedgents will not build an order until a live route and its execution adapter are registered."}
            </p>
          </div>

          <dl className={styles.costBreakdown}>
            <div>
              <dt>{quote?.kind === "underlying-security" ? "Underlying reference" : "Metal reference"}</dt>
              <dd>
                {quote?.priceUsd != null
                  ? currency(quote.priceUsd, quote.priceUsd < 10 ? 4 : 2)
                  : "Unavailable"}
              </dd>
            </div>
            <div><dt>Hedgents execution fee</dt><dd>{currency(routeFee)}</dd></div>
            <div><dt>Network fee</dt><dd>Confirmed in wallet</dd></div>
            {crossChainFundingSelected ? (
              <div><dt>CCTP funding fee</dt><dd>Live Circle quote before signing</dd></div>
            ) : null}
            <div><dt>Router fee</dt><dd>Shown on exact quote</dd></div>
          </dl>
        </div>
      </details>

      {tradeSide === "buy" && product.hedgeMarket ? (
        <details className={styles.ticketDetails}>
          <summary>
            <span><Layers3 size={14} aria-hidden="true" /> Optional hedge</span>
            <small>{hedgeEnabled ? "Enabled" : "Advanced"} <ChevronDown size={13} aria-hidden="true" /></small>
          </summary>
          <div className={styles.ticketDetailsBody}>
            <div className={classNames(styles.hedgeOption, hedgeEnabled && styles.hedgeOptionActive)}>
              <div className={styles.hedgeOptionTop}>
                <span className={styles.hedgeIcon}>
                  <Layers3 size={15} aria-hidden="true" />
                </span>
                <div>
                  <strong>Reduce price exposure</strong>
                  <small>Optional paired short on Hyperliquid</small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={hedgeEnabled}
                  onClick={() => onHedgeChange(!hedgeEnabled)}
                  className={styles.switch}
                >
                  <span />
                </button>
              </div>
              {hedgeEnabled ? (
                <div className={styles.hedgeDetails}>
                  <span><small>Proposed short</small><strong>{currency(hedgeNotional)}</strong></span>
                  <span><small>Target hedge</small><strong>80%</strong></span>
                  <p>Separate margin, funding, basis, and liquidation risk. You approve both legs.</p>
                </div>
              ) : null}
            </div>
          </div>
        </details>
      ) : null}

      <details className={styles.ticketDetails} open>
        <summary>
          <span><ShieldCheck size={14} aria-hidden="true" /> Eligibility</span>
          <small>{eligibilityAccepted && /^[A-Z]{2}$/.test(eligibilityCountryCode) ? "Confirmed" : "Required"} <ChevronDown size={13} aria-hidden="true" /></small>
        </summary>
        <div className={styles.ticketDetailsBody}>
          <div className={styles.eligibilityGate}>
            <label>
              <span>Country of residence</span>
              <input
                value={eligibilityCountryCode}
                onChange={(event) => onEligibilityCountryChange(event.target.value)}
                inputMode="text"
                autoComplete="country"
                maxLength={2}
                placeholder="PL"
                aria-label="Two-letter country of residence"
              />
            </label>
            <label className={styles.eligibilityCheck}>
              <input
                type="checkbox"
                checked={eligibilityAccepted}
                onChange={(event) => onEligibilityChange(event.target.checked)}
              />
              <span>I am of legal age, accept the issuer terms, and am not a restricted person.</span>
            </label>
            <small>Closed beta uses this evidence to fail closed on issuer and jurisdiction restrictions.</small>
          </div>
        </div>
      </details>

      <button
        type="button"
        className={styles.reviewButton}
        onClick={shouldConnectWallet ? onConnectWallet : onReview}
        disabled={!shouldConnectWallet && !canStartSelectedRoute}
      >
        {!executionControl.enabled
          ? "Execution paused by operator"
          : !executionAdapterReady
          ? "Execution adapter not registered"
            : executionServiceLoading || routeComparisonLoading
            ? "Checking execution service…"
            : !executionServiceReady || exactRoute?.available !== true
              ? executionServiceStatus === "configuration-required"
                ? "Jupiter execution not configured"
                : "Live route currently unavailable"
          : insufficientMetal
            ? `Insufficient ${product.ticker} balance`
          : !/^[A-Z]{2}$/.test(eligibilityCountryCode)
            ? "Enter two-letter residence code"
          : !eligibilityAccepted
            ? "Confirm product eligibility"
          : !canStartSelectedRoute
            ? crossChainFundingSelected
              ? "Connect EVM + Solana wallets"
              : "Connect Solana wallet"
            : tradeSide === "sell"
              ? `Build ${product.ticker} → ${settlementAsset.symbol} quote`
            : crossChainFundingSelected
              ? `Review ${selectedFundingSource.label} funding`
              : "Build executable quote"}
        <ArrowRight size={15} aria-hidden="true" />
      </button>
      <p className={styles.ticketDisclosure}>
        <Info size={12} aria-hidden="true" /> {executionAdapterReady
          ? tradeSide === "sell"
            ? `This is a mainnet ${product.ticker} sale into canonical Solana ${settlementAsset.symbol}. The exact output, price impact, token programs, and wallet settlement are revalidated before and after signing.`
          : crossChainFundingSelected
            ? `${selectedFundingSource.disclosure} CCTP funding and the Solana metal swap are two non-atomic transactions; the swap is built only after verified delivery.`
            : "All registered products are re-quoted at the entered size every fifteen seconds. The selected route is rebuilt and simulated again before signing. Equivalent products are ranked by protected output; different exposures are never collapsed into a false best price."
          : "Independent reference only. No swap, simulation, or signature request is available for this product."}
      </p>
    </aside>
  );
}

interface PortfolioViewProps {
  owner: string | null;
  snapshot: PortfolioSnapshot | undefined;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  quotes: MetalQuoteResponse | null;
  records: ExecutionRecord[];
  scarcityMarkets: ScarcityMarket[];
  onConnectWallet: () => void;
  onRefresh: () => void;
  onNavigateToMarkets: () => void;
  onNavigateToScarcity: () => void;
  onSell: (productId: string, balance: string) => void;
}

function PortfolioView({
  owner,
  snapshot,
  loading,
  refreshing,
  error,
  quotes,
  records,
  scarcityMarkets,
  onConnectWallet,
  onRefresh,
  onNavigateToMarkets,
  onNavigateToScarcity,
  onSell,
}: PortfolioViewProps) {
  const metalBalances = (snapshot?.balances ?? []).filter(
    (balance) => balance.kind === "metal" && BigInt(balance.rawAmount) > 0n,
  );
  const stableBalances = (snapshot?.balances ?? []).filter((balance) => balance.kind === "stablecoin");
  const metalValue = metalBalances.reduce((total, balance) => {
    const price = balance.productId ? quotes?.products[balance.productId]?.priceUsd : null;
    return total + (price != null ? Number(balance.amount) * price : 0);
  }, 0);
  const stableValue = stableBalances.reduce((total, balance) => total + Number(balance.amount), 0);
  const pricedPositions = metalBalances.filter(
    (balance) => balance.productId && quotes?.products[balance.productId]?.priceUsd != null,
  ).length;
  const accounting = calculatePortfolioAccounting(
    records,
    snapshot?.balances ?? [],
    Object.fromEntries(
      Object.entries(quotes?.products ?? {}).map(([productId, quote]) => [productId, quote.priceUsd]),
    ),
  );
  const accountingByProduct = new Map(accounting.map((position) => [position.productId, position]));
  const trackedCostBasis = accounting.reduce((total, position) => total + position.costBasisUsd, 0);
  const realizedPnl = accounting.reduce((total, position) => total + position.realizedPnlUsd, 0);
  const unrealizedPnl = accounting.reduce(
    (total, position) => total + (position.unrealizedPnlUsd ?? 0),
    0,
  );
  const fullyTrackedPositions = metalBalances.filter(
    (balance) => balance.productId && accountingByProduct.get(balance.productId)?.coverage === "complete",
  ).length;

  return (
    <section className={styles.secondaryView}>
      <div className={styles.secondaryMasthead}>
        <div>
          <p className={styles.overline}>Portfolio / one wallet, two metal books</p>
          <h1>Inventory and conviction, together.</h1>
          <p>One portfolio separates token holdings from scarcity-market positions without splitting your wallet state across products.</p>
        </div>
        <div className={styles.portfolioActions}>
          {owner ? (
            <button type="button" className={styles.secondaryAction} onClick={onRefresh} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? styles.spin : undefined} aria-hidden="true" />
              {refreshing ? "Indexing" : "Refresh"}
            </button>
          ) : null}
          <button type="button" className={styles.secondaryAction} onClick={owner ? onNavigateToMarkets : onConnectWallet}>
            {owner ? "Trade a metal" : "Connect Solana wallet"} <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      {!owner ? (
        <div className={styles.portfolioEmpty}>
          <span><WalletCards size={24} aria-hidden="true" /></span>
          <div>
            <p className={styles.overline}>Wallet required</p>
            <h2>Connect the Solana wallet that holds your metals.</h2>
            <p>Hedgents reads public token accounts only. It never infers balances from browser order history.</p>
          </div>
        </div>
      ) : loading && !snapshot ? (
        <div className={styles.portfolioEmpty}>
          <span><RefreshCw size={24} className={styles.spin} aria-hidden="true" /></span>
          <div><p className={styles.overline}>Mainnet index</p><h2>Reading SPL Token and Token-2022 accounts.</h2></div>
        </div>
      ) : error && !snapshot ? (
        <div className={styles.portfolioEmpty}>
          <span><CircleAlert size={24} aria-hidden="true" /></span>
          <div><p className={styles.overline}>Index unavailable</p><h2>{error}</h2></div>
          <button type="button" className={styles.reviewButton} onClick={onRefresh}>Retry index</button>
        </div>
      ) : (
        <>
          <div className={styles.portfolioLedger}>
            <div className={styles.portfolioNav}>
              <span>Indicative net value</span>
              <strong>{currency(metalValue + stableValue)}</strong>
              <small>{shortAddress(owner)} · indexed {snapshot ? new Date(snapshot.checkedAt).toLocaleTimeString() : "—"}</small>
            </div>
            <div><span>Metal value</span><strong>{currency(metalValue)}</strong><small>{pricedPositions}/{metalBalances.length} positions priced</small></div>
            <div><span>Settlement cash</span><strong>{currency(stableValue)}</strong><small>Nominal $1 marks</small></div>
            <div>
              <span>Tracked basis / P&amp;L</span>
              <strong>{trackedCostBasis > 0 ? `${currency(trackedCostBasis)} / ${unrealizedPnl >= 0 ? "+" : ""}${currency(unrealizedPnl)}` : "No verified fills"}</strong>
              <small>{fullyTrackedPositions}/{metalBalances.length} held positions fully covered · realized {realizedPnl >= 0 ? "+" : ""}{currency(realizedPnl)}</small>
            </div>
          </div>

          <div className={styles.portfolioGrid}>
            <section className={styles.positionsPanel}>
              <div className={styles.sectionBar}>
                <div><span>01 / Metal token positions</span><small>Wallet-derived inventory · live-gated exit</small></div>
                <span className={styles.historyScope}>{metalBalances.length} held</span>
              </div>
              <div className={styles.positionHeader}>
                <span>Product</span><span>Balance</span><span>Mark</span><span>Value</span><span />
              </div>
              {metalBalances.map((balance) => {
                const price = balance.productId ? quotes?.products[balance.productId]?.priceUsd : null;
                const value = price != null ? Number(balance.amount) * price : null;
                const position = balance.productId ? accountingByProduct.get(balance.productId) : null;
                return (
                  <article className={styles.positionRow} key={balance.mint}>
                    <span><strong>{balance.symbol}</strong><small>{balance.name}</small></span>
                    <span><strong>{balance.amount}</strong><small>{balance.tokenProgram}</small></span>
                    <span><strong>{price != null ? currency(price, price < 10 ? 4 : 2) : "Unavailable"}</strong><small>Jupiter buy-side probe</small></span>
                    <span>
                      <strong>{value != null ? currency(value) : "—"}</strong>
                      <small>
                        {position?.coverage === "none"
                          ? "Basis unavailable · external/unrecorded inventory"
                          : `${position?.coverage === "partial" ? "Partial" : "Tracked"} basis ${currency(position?.costBasisUsd ?? 0)} · P&L ${position?.unrealizedPnlUsd != null && position.unrealizedPnlUsd >= 0 ? "+" : ""}${position?.unrealizedPnlUsd != null ? currency(position.unrealizedPnlUsd) : "—"}`}
                      </small>
                    </span>
                    <button type="button" onClick={() => balance.productId && onSell(balance.productId, balance.amount)}>
                      Sell <ArrowRight size={12} aria-hidden="true" />
                    </button>
                  </article>
                );
              })}
              {metalBalances.length === 0 ? (
                <div className={styles.orderEmpty}>
                  <WalletCards size={19} aria-hidden="true" />
                  <strong>No supported metal balances found.</strong>
                  <span>The index checked all 15 canonical mints across both Solana token programs.</span>
                </div>
              ) : null}
              {metalBalances.length > 0 ? (
                <p className={styles.accountingDisclosure}>
                  <Info size={12} aria-hidden="true" /> FIFO accounting uses independently verified Hedgents fills stored in this browser. Imported receipts extend coverage; external transfers and outside trades remain unpriced.
                </p>
              ) : null}
            </section>

            <aside className={styles.stableInventory}>
              <div className={styles.sectionBar}>
                <div><span>Settlement inventory</span><small>Canonical Solana assets</small></div>
              </div>
              {stableBalances.map((balance) => (
                <div className={styles.stableBalance} key={balance.mint}>
                  <span><i /><strong>{balance.symbol}</strong><small>{balance.name}</small></span>
                  <strong>{Number(balance.amount).toLocaleString("en-US", { maximumFractionDigits: 6 })}</strong>
                  <a href={getSolanaSettlementAsset(balance.symbol.toLowerCase())?.sourceUrl} target="_blank" rel="noreferrer">
                    {balance.tokenProgram} <ExternalLink size={10} aria-hidden="true" />
                  </a>
                </div>
              ))}
              <p><Info size={12} aria-hidden="true" /> Stablecoins are shown at nominal value. The sell ticket uses a live protected Jupiter output, not this portfolio mark.</p>
            </aside>
          </div>
        </>
      )}

      <ScarcityPortfolioPanel
        markets={scarcityMarkets}
        owner={owner}
        onOpenScarcity={onNavigateToScarcity}
      />
    </section>
  );
}

function OrdersView({
  records,
  onRecover,
  onImport,
}: {
  records: ExecutionRecord[];
  onRecover: (record: ExecutionRecord) => void;
  onImport: (record: ExecutionRecord) => void;
}) {
  const latest = records[0] ?? null;
  const latestSubmissionState = latest ? executionSubmissionState(latest) : null;
  const latestVerified = latest?.settlement?.status === "verified";
  const timeline: Array<{
    label: string;
    detail: string;
    state: "done" | "active" | "failed" | "idle";
  }> = latest ? [
    { label: "Exact route assembled", detail: latest.router ?? "Jupiter Swap V2", state: "done" },
    { label: "Transaction simulated", detail: "Solana RPC · before signature", state: "done" },
    latest.walletSigned || latest.signature
      ? {
          label: latest.signature ? "Wallet signature captured" : "Wallet signature approved",
          detail: latest.signature
            ? "Wallet Standard · local signature"
            : "Signed locally · signature discarded after the server blocked submission",
          state: "done",
        }
      : { label: "Wallet signature not completed", detail: latest.error ?? "No wallet signature returned", state: "failed" },
    latestSubmissionState === "submitted"
      ? { label: "Signed route submitted", detail: "Jupiter managed landing", state: "done" }
      : latestSubmissionState === "unknown"
        ? { label: "Submission not yet proven", detail: "Verify the signature before retrying", state: "active" }
        : { label: "No chain submission", detail: "The signed route was not sent", state: "failed" },
    latestVerified
      ? { label: "Settlement verified", detail: latest.settlement?.verifiedAt ? new Date(latest.settlement.verifiedAt).toLocaleString() : new Date(latest.timestamp).toLocaleString(), state: "done" }
      : latest.status === "Failed"
        ? { label: "No verified settlement", detail: latest.error ?? "Execution failed", state: "failed" }
        : { label: "Finalized verification pending", detail: latest.settlement?.error ?? "Waiting for independent RPC evidence", state: "active" },
  ] : [
    { label: "Exact route assembled", detail: "Waiting for an order", state: "idle" },
    { label: "Transaction simulated", detail: "Waiting for an order", state: "idle" },
    { label: "Wallet signature requested", detail: "Waiting for an order", state: "idle" },
    { label: "Signed route submitted", detail: "Waiting for an order", state: "idle" },
    { label: "Settlement verified", detail: "No order submitted", state: "idle" },
  ];
  const [importError, setImportError] = useState<string | null>(null);
  return (
    <section className={styles.secondaryView}>
      <div className={styles.secondaryMasthead}>
        <div>
          <p className={styles.overline}>Orders / verified execution</p>
          <h1>Every leg, accounted for.</h1>
          <p>Track venue execution, wallet settlement, and any compensating action.</p>
        </div>
        <div className={styles.orderHealth}>
          <span><i /> Registered inventory</span>
          <strong>{registeredAdapterCount} mapped Solana products</strong>
        </div>
      </div>

      <div className={styles.ordersLayout}>
        <section className={styles.ordersPanel}>
          <div className={styles.sectionBar}>
            <div>
              <span>Order history</span>
              <small>Signed, pending, confirmed, and failed wallet submissions</small>
            </div>
            <label className={styles.receiptButton}>
              <Upload size={13} aria-hidden="true" /> Import receipt
              <input
                className={styles.srOnly}
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void file.text().then((value) => {
                    try {
                      onImport(parseExecutionReceipt(value));
                      setImportError(null);
                    } catch (error) {
                      setImportError(error instanceof Error ? error.message : "Receipt import failed.");
                    }
                  });
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {importError ? <div className={styles.executionError}><CircleAlert size={14} /><span>{importError}</span></div> : null}
          <div className={styles.orderHeader}>
            <span>Order</span><span>Intent</span><span>Route</span><span>Result</span><span>Status</span>
          </div>
          {records.map((order) => {
            const submissionState = executionSubmissionState(order);
            const verified = order.settlement?.status === "verified";
            return (
            <article className={styles.orderRow} key={`${order.id}-${order.timestamp}`}>
              <span><strong>{order.id}</strong><small>{new Date(order.timestamp).toLocaleString()}</small></span>
              <span>
                <strong>{order.side === "sell" ? "Sell" : "Buy"} {order.metal}</strong>
                <small>
                  {order.side === "sell" && order.inputAmount
                    ? `${baseUnits(order.inputAmount, order.inputDecimals ?? 6)} ${order.inputSymbol ?? order.ticker}`
                    : `${currency(order.inputUsd ?? 0)} ${order.inputSymbol ?? "USDC"}`}
                </small>
              </span>
              <span>
                <strong>{order.source} → {order.destination}</strong>
                <small>
                  {submissionState === "submitted"
                    ? "Self-custodial chain submission"
                    : submissionState === "unknown"
                      ? "Submission unconfirmed · verify before retrying"
                      : "No chain submission"}
                </small>
              </span>
              <span>
                <strong>
                  {submissionState === "not-submitted"
                    ? "No funds moved"
                    : verified && order.settlement?.receivedAmount
                      ? `${baseUnits(order.settlement.receivedAmount, order.outputDecimals ?? 6)} ${order.outputSymbol ?? order.ticker}`
                      : order.outputAmount
                        ? `Quoted ${baseUnits(order.outputAmount, order.outputDecimals ?? 6)} ${order.outputSymbol ?? order.ticker}`
                        : "No verified fill"}
                </strong>
                <small>
                  {submissionState === "not-submitted"
                    ? order.error ?? "The transaction was not sent"
                    : verified
                    ? "Wallet increase independently verified"
                    : order.status === "Success"
                      ? "Venue success · RPC verification pending"
                      : order.status === "Pending"
                        ? order.error ?? "Signed locally · finalized verification pending"
                        : order.error ?? "Execution failed"}
                </small>
              </span>
              <span
                className={styles.orderStatus}
                data-state={verified ? "verified" : submissionState === "not-submitted" ? "not-submitted" : order.status.toLowerCase()}
              >
                <i /> {verified ? "Verified" : submissionState === "not-submitted" ? "Not sent" : order.status === "Failed" ? "Failed" : submissionState === "unknown" ? "Verify" : order.status}
              </span>
            </article>
            );
          })}
          {records.length === 0 ? (
            <div className={styles.orderEmpty}>
              <Route size={19} aria-hidden="true" />
              <strong>No submitted orders yet.</strong>
              <span>Open a mapped Solana product with a live exact-size route; signed results will appear here.</span>
            </div>
          ) : null}
        </section>

        <aside className={styles.executionPanel}>
          <div className={styles.sectionBar}>
            <div>
              <span>{latest?.id ?? "Route audit"}</span>
              <small>
                {latestSubmissionState === "submitted"
                  ? "Latest chain submission"
                  : latestSubmissionState === "unknown"
                    ? "Latest signed attempt · verify"
                    : latest ? "Latest wallet attempt · not sent" : "Waiting for first order"}
              </small>
            </div>
            {latest?.signature && latestSubmissionState !== "not-submitted" ? (
              <a href={`https://solscan.io/tx/${latest.signature}`} target="_blank" rel="noreferrer" aria-label="Open transaction on Solscan">
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : <ExternalLink size={14} aria-hidden="true" />}
          </div>
          <ol className={styles.executionTimeline}>
            {timeline.map(({ label, detail, state }, index) => (
              <li key={`${index}-${label}`} data-state={state}>
                <span>
                  {state === "done"
                    ? <Check size={12} aria-hidden="true" />
                    : state === "failed"
                      ? <CircleAlert size={12} aria-hidden="true" />
                      : <Clock3 size={12} aria-hidden="true" />}
                </span>
                <div><strong>{label}</strong><small>{detail}</small></div>
                <b>{String(index + 1).padStart(2, "0")}</b>
              </li>
            ))}
          </ol>
          {latest ? (
            <div
              className={styles.executionResult}
              data-state={latestVerified ? "verified" : latest.status === "Failed" ? "failed" : latestSubmissionState === "unknown" ? "pending" : "failed"}
            >
              {latestVerified ? <CheckCircle2 size={18} aria-hidden="true" /> : latest.status !== "Failed" && latestSubmissionState === "unknown" ? <Clock3 size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
              <div>
                <strong>
                  {latestVerified
                    ? "Settlement independently verified"
                    : latestSubmissionState === "not-submitted"
                      ? "Not submitted · no funds moved"
                    : latest.status === "Pending"
                      ? "Signed locally · verify before retrying"
                      : latest.status === "Success" ? "Venue success · verification pending" : "Not settled"}
                </strong>
                <small>
                  {latest.error ?? latest.settlement?.error ?? (latest.signature ? shortAddress(latest.signature) : "No transaction signature returned")}
                </small>
              </div>
              <button
                type="button"
                className={styles.receiptButton}
                onClick={() => downloadExecutionReceipt(latest)}
              >
                <Download size={13} aria-hidden="true" /> Receipt
              </button>
              {isExecutionRecoveryPending(latest) ? (
                <button
                  type="button"
                  className={styles.receiptButton}
                  onClick={() => onRecover(latest)}
                >
                  <RefreshCw size={13} aria-hidden="true" /> Verify
                </button>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function WalletPanel({
  railFundingEnabled,
  onClose,
}: {
  railFundingEnabled: boolean;
  onClose: () => void;
}) {
  const solanaClient = useClient<AppSolanaClient>();
  const solanaWallets = useWallets(solanaClient);
  const solanaStatus = useWalletStatus(solanaClient);
  const solanaConnected = useConnectedWallet(solanaClient);
  const solanaConnect = useSolanaConnect(solanaClient);
  const solanaDisconnect = useSolanaDisconnect(solanaClient);
  const evmConnection = useConnection();
  const evmConnectors = useConnectors();
  const evmConnect = useEvmConnect();
  const evmDisconnect = useEvmDisconnect();
  const evmSwitchChain = useSwitchChain();
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  useEffect(() => setDiagnosticsEnabled(diagnosticsConsentEnabled()), []);
  return (
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.walletPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-panel-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.overline}>Self-custody / wallet standard</p>
            <h2 id="wallet-panel-title">Connect wallets</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close wallet panel">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <p className={styles.modalIntro}>
          Hedgents owns both wallet connections: use an EVM wallet as the funding source and a
          Solana wallet for metal execution and settlement. Each transaction requires approval.
        </p>
        <div className={styles.walletConnectGrid}>
          <section className={classNames(styles.walletConnector, styles.walletActive)}>
            <header>
              <i style={{ background: "#9b7aff" }} />
              <div><strong>Solana execution wallet</strong><small>Wallet Standard · Mainnet</small></div>
              <span>{solanaConnected ? "Connected" : "Not connected"}</span>
            </header>
            {solanaConnected ? (
              <div className={styles.connectedAccount}>
                <span>
                  <strong>{solanaConnected.wallet.name}</strong>
                  <small>{shortAddress(solanaConnected.account.address)}</small>
                </span>
                <button
                  type="button"
                  onClick={() => solanaDisconnect.dispatch()}
                  disabled={solanaDisconnect.isRunning}
                >
                  <Unplug size={13} aria-hidden="true" /> Disconnect
                </button>
              </div>
            ) : (
              <div className={styles.connectorOptions}>
                {solanaWallets.length > 0 ? solanaWallets.map((wallet) => (
                  <button
                    type="button"
                    key={wallet.name}
                    onClick={() => solanaConnect.dispatch(wallet)}
                    disabled={solanaConnect.isRunning || solanaStatus === "pending"}
                  >
                    {wallet.icon ? <img src={wallet.icon} alt="" /> : <WalletCards size={16} aria-hidden="true" />}
                    <span>Connect {wallet.name}</span>
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                )) : (
                  <p>No Solana Wallet Standard wallet was found in this browser.</p>
                )}
              </div>
            )}
            {solanaConnect.error ? <p className={styles.walletError}>{walletErrorMessage(solanaConnect.error)}</p> : null}
          </section>

          <section className={styles.walletConnector}>
            <header>
              <i style={{ background: "#d7a64b" }} />
              <div><strong>EVM source wallet</strong><small>Hedgents wallet connector</small></div>
              <span>{evmConnection.isConnected ? "Connected" : "Not connected"}</span>
            </header>
            {evmConnection.isConnected && evmConnection.address ? (
              <div className={styles.connectedAccount}>
                <span>
                  <strong>{evmConnection.chain?.name ?? "EVM wallet"}</strong>
                  <small>{shortAddress(evmConnection.address)}</small>
                </span>
                <button
                  type="button"
                  onClick={() => evmDisconnect.mutate()}
                  disabled={evmDisconnect.isPending}
                >
                  <Unplug size={13} aria-hidden="true" /> Disconnect
                </button>
              </div>
            ) : (
              <div className={styles.connectorOptions}>
                {evmConnectors.map((connector) => (
                  <button
                    type="button"
                    key={connector.uid}
                    onClick={() => evmConnect.mutate({ connector })}
                    disabled={evmConnect.isPending}
                  >
                    {connector.icon ? <img src={connector.icon} alt="" /> : <WalletCards size={16} aria-hidden="true" />}
                    <span>Connect {connector.name === "Injected" ? "browser wallet" : connector.name}</span>
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
            <div className={styles.sourceWalletShell}>
              <div className={styles.sourceNetworkList} aria-label="EVM source networks">
                {evmSourceNetworks.map((network) => (
                  <button
                    type="button"
                    key={network.id}
                    aria-pressed={evmConnection.chainId === network.chainId}
                    onClick={() => evmSwitchChain.mutate({ chainId: network.chainId })}
                    disabled={!evmConnection.isConnected || evmSwitchChain.isPending}
                  >
                    <i style={{ background: network.tone }} />
                    {network.label} · {!railFundingEnabled && network.id !== "bnb"
                      ? "Funding paused"
                      : network.funding}
                  </button>
                ))}
              </div>
              <p>
                {railFundingEnabled
                  ? "Hedgents supplies the connected wallet and selected source chain. The external Rail SDK enables native USDC funding from Ethereum and Base; BNB remains wallet-only."
                  : "EVM wallet connection remains available, but the terminal currently pauses new Rail funding. A previously broadcast CCTP delivery can still be resumed and verified."}
              </p>
              {evmConnect.error ? <small className={styles.walletError}>{evmConnect.error.message}</small> : null}
              {evmSwitchChain.error ? <small className={styles.walletError}>{evmSwitchChain.error.message}</small> : null}
            </div>
          </section>
        </div>
        <div className={styles.custodyNote}>
          <ShieldCheck size={16} aria-hidden="true" />
          <div><strong>You keep custody.</strong><span>Hedgents prepares transactions; it does not hold these balances.</span></div>
        </div>
        <label className={styles.diagnosticsConsent}>
          <input
            type="checkbox"
            checked={diagnosticsEnabled}
            onChange={(event) => {
              setDiagnosticsEnabled(event.target.checked);
              setDiagnosticsConsent(event.target.checked);
            }}
          />
          <span>
            <strong>Share anonymous beta diagnostics</strong>
            <small>Optional. Sends product, route state, amount range, and error code—never wallet addresses, signatures, or exact amounts.</small>
          </span>
        </label>
      </section>
    </div>
  );
}

interface ReviewPanelProps {
  selectedMarket: MetalMarket;
  side: TradeSide;
  settlementSymbol: string;
  productName: string;
  ticker: string;
  settlementChain: string;
  venue: string;
  amount: number;
  estimatedUnits: number;
  routeFee: number;
  routeNodes: string[];
  hedgeNotional: number;
  hedgeMarket?: string;
  quote: LiveQuote | undefined;
  eligibility: string;
  eligibilityCountryCode: string;
  issuerTermsUrl?: string;
  eligibilityAccepted: boolean;
  executionRisk: string;
  order: JupiterOrderQuote | null;
  result: JupiterExecutionResult | null;
  phase: ExecutionPhase;
  error: string | null;
  errorCode: string | null;
  rejectionOnly: boolean;
  onEligibilityChange: (value: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
}

function ReviewPanel({
  selectedMarket,
  side,
  settlementSymbol,
  productName,
  ticker,
  settlementChain,
  venue,
  amount,
  estimatedUnits,
  routeFee,
  routeNodes,
  hedgeNotional,
  hedgeMarket,
  quote,
  eligibility,
  eligibilityCountryCode,
  issuerTermsUrl,
  eligibilityAccepted,
  executionRisk,
  order,
  result,
  phase,
  error,
  errorCode,
  rejectionOnly,
  onEligibilityChange,
  onConfirm,
  onClose,
}: ReviewPanelProps) {
  const exactOutput = order ? baseUnits(order.outputAmount, order.outputDecimals) : null;
  const minimumOutput = order ? baseUnits(order.minimumOutputAmount, order.outputDecimals) : null;
  const isBusy = phase === "signing" || phase === "submitting";
  const outputSymbol = side === "buy" ? ticker : settlementSymbol;

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.reviewPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-panel-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {phase === "success" && result ? (
          <div className={styles.confirmedState}>
            <span>{result.settlement?.status === "verified" ? <CheckCircle2 size={25} aria-hidden="true" /> : <Clock3 size={25} aria-hidden="true" />}</span>
            <p className={styles.overline}>Jupiter execution / {result.settlement?.status ?? "verification pending"}</p>
            <h2>
              {result.settlement?.status === "verified"
                ? `${outputSymbol} settlement verified.`
                : result.submissionState === "submitted"
                  ? `${side === "buy" ? ticker : `${ticker} sale`} submitted; verification pending.`
                  : "Signed result requires verification."}
            </h2>
            <p>
              {result.settlement?.status === "verified"
                ? "Solana RPC independently confirmed that the wallet received at least the authenticated minimum output."
                : result.submissionState === "submitted"
                  ? "The chain submission is known, but independent wallet-balance verification has not completed yet. Check the explorer before retrying."
                  : `${result.error ?? "The signed transaction was handed upstream, but chain submission is not yet independently proven."} Do not retry until Verify or Solana shows a final outcome.`}
            </p>
            <div>
              <small>{result.settlement?.status === "verified" ? "RPC-verified wallet increase" : "Quoted / venue-reported · not verified"}</small>
              <strong>{baseUnits(result.settlement?.receivedAmount ?? result.outputAmount ?? order?.outputAmount ?? "0", order?.outputDecimals ?? 6)} {outputSymbol}</strong>
              <span>{result.settlement?.status === "verified" ? `received by your ${settlementChain} wallet` : "not yet proven in your wallet"}</span>
            </div>
            {result.signature ? (
              <a className={styles.explorerLink} href={`https://solscan.io/tx/${result.signature}`} target="_blank" rel="noreferrer">
                Verify transaction on Solscan <ExternalLink size={13} aria-hidden="true" />
              </a>
            ) : null}
            {hedgeNotional > 0 ? (
              <p className={styles.executionFootnote}>The optional Hyperliquid hedge was not submitted; it remains a separate future approval.</p>
            ) : null}
            <button type="button" className={styles.reviewButton} onClick={onClose}>
              Return to terminal <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        ) : phase === "ordering" ? (
          <div className={styles.executionLoading}>
            <RefreshCw size={25} className={styles.spin} aria-hidden="true" />
            <p className={styles.overline}>Jupiter Swap V2 / exact size</p>
            <h2>Building a signable route.</h2>
            <p>Checking wallet balances, venue depth, minimum output, expiry, and Solana simulation.</p>
          </div>
        ) : phase === "failed" && !order ? (
          <div className={styles.executionLoading}>
            <CircleAlert size={26} aria-hidden="true" />
            <p className={styles.overline}>Route not submitted</p>
            <h2>Execution stopped safely.</h2>
            <p>{error ?? "The executable route could not be prepared."}</p>
            <button type="button" className={styles.reviewButton} onClick={onClose}>
              Return and try a fresh quote <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.overline}>Executable route / simulated</p>
                <h2 id="review-panel-title">Review {selectedMarket.name} {side === "buy" ? "purchase" : "sale"}</h2>
              </div>
              <button type="button" onClick={onClose} aria-label="Close route review">
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <div className={styles.reviewHero}>
              <ElementMark market={selectedMarket} />
              <div>
                <span>You {side === "buy" ? "spend" : "sell"}</span>
                <strong>{side === "buy" ? currency(amount) : `${amount.toLocaleString("en-US", { maximumFractionDigits: 9 })} ${ticker}`}</strong>
                <small>Solana · {side === "buy" ? "native USDC" : productName}</small>
              </div>
              <ArrowRight size={20} aria-hidden="true" />
              <div><span>Quoted output</span><strong>{exactOutput ?? estimatedUnits.toFixed(6)} {outputSymbol}</strong><small>{side === "buy" ? productName : `${settlementSymbol} settlement`} · {settlementChain}</small></div>
            </div>

            <div className={styles.reviewRoute}>
              {routeNodes.map((node, index) => (
                <span key={`${node}-${index}`}><i>{index + 1}</i><small>{node}</small></span>
              ))}
            </div>

            <dl className={styles.reviewCosts}>
              <div><dt>Price reference</dt><dd>{quote?.sourceSymbol ?? "Unavailable"} · {quoteLabel(quote)}</dd></div>
              <div><dt>Executable router</dt><dd>{order?.router ?? venue}</dd></div>
              <div><dt>Minimum received</dt><dd>{minimumOutput ?? "—"} {outputSymbol}</dd></div>
              <div><dt>Price impact</dt><dd>{order?.priceImpactPct != null ? `${order.priceImpactPct.toFixed(4)}%` : "Not reported"}</dd></div>
              <div><dt>Router fee</dt><dd>{order?.feeBps != null ? `${order.feeBps} bps` : "No router fee reported"}</dd></div>
              <div><dt>Quote expiry</dt><dd>{order?.expiresAt ? new Date(order.expiresAt).toLocaleTimeString() : "Block-height protected"}</dd></div>
              <div><dt>Simulation</dt><dd>Passed{order?.simulationUnitsConsumed ? ` · ${order.simulationUnitsConsumed.toLocaleString()} CU` : ""}</dd></div>
              <div><dt>Solana network fee</dt><dd>Calculated in wallet</dd></div>
            </dl>

            {hedgeNotional > 0 ? (
              <div className={styles.reviewHedge}>
                <Layers3 size={16} aria-hidden="true" />
                <div><strong>Hedge is not part of this transaction</strong><span>{currency(hedgeNotional)} short · {hedgeMarket}</span></div>
                <small>Future separate approval</small>
              </div>
            ) : null}

            <div className={styles.reviewWarnings}>
              <CircleAlert size={16} aria-hidden="true" />
              <div>
                <p>You are signing a mainnet {side === "buy" ? `USDC → ${ticker}` : `${ticker} → ${settlementSymbol}`} swap as a resident of {eligibilityCountryCode}. {eligibility}. {executionRisk}</p>
                <label className={styles.eligibilityCheck}>
                  <input
                    type="checkbox"
                    checked={eligibilityAccepted}
                    onChange={(event) => onEligibilityChange(event.target.checked)}
                  />
                  <span>
                    I confirm that I am eligible to {side === "buy" ? "acquire" : "transact in"} this product and understand its issuer and transfer restrictions.
                    {issuerTermsUrl ? <a href={issuerTermsUrl} target="_blank" rel="noreferrer"> Review issuer terms <ExternalLink size={10} aria-hidden="true" /></a> : null}
                  </span>
                </label>
              </div>
            </div>

            {error ? (
              <div className={styles.executionError} role="alert">
                <CircleAlert size={15} aria-hidden="true" />
                <span><strong>{errorCode ? errorCode.replaceAll("_", " ") : "Execution stopped"}</strong>{error}</span>
              </div>
            ) : null}

            <button
              type="button"
              className={styles.reviewButton}
              onClick={phase === "failed" ? onClose : onConfirm}
              disabled={isBusy || !order || (phase !== "failed" && !eligibilityAccepted)}
            >
              {phase === "signing"
                ? rejectionOnly ? "Approve QA signature in wallet…" : "Approve in wallet…"
                : phase === "submitting"
                  ? "Submitting and confirming…"
                  : phase === "failed"
                    ? "Close and build a fresh route"
                    : !eligibilityAccepted
                      ? "Confirm eligibility to continue"
                      : rejectionOnly ? "Test wallet approval · will not submit" : "Sign and submit swap"}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </>
        )}
      </section>
    </div>
  );
}
