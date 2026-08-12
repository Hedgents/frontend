"use client";

import { useQuery } from "@tanstack/react-query";
import type { MetalPulseRound, MetalPulseSnapshot } from "@/lib/metal-pulse";

export interface ScarcityBookOrder {
  address: string;
  maker: string;
  side: "bid" | "ask";
  outcome: "yes" | "no";
  orderId: string;
  priceMicroUsdc: string;
  originalQuantity: string;
  remainingQuantity: string;
  quoteFilled: string;
  feePaid: string;
  feeBps: number;
  expiresAt: string;
  state?: "open" | "expired" | "filled";
}

export interface ScarcityChainState {
  deployment: {
    cluster: "devnet" | "mainnet-beta";
    programAddress: string;
    collateralMint: string;
    feeRecipient: string;
    resolver: string;
    currentResolver: string;
    paused: boolean;
    tradingFeeBps: number;
    market: string;
    yesMint: string;
    noMint: string;
    vault: string;
    creationSignature: string;
  };
  market: {
    status: "unresolved" | "resolved-yes" | "resolved-no" | "invalid";
    opensAt: string;
    closesAt: string;
    resolveAfter: string;
    resolvedAt: string;
    openInterest: string;
    totalRedeemed: string;
    resolutionReportHash: string;
  };
  orders: ScarcityBookOrder[];
  asOf: string;
}

export interface ScarcityCurveChainState {
  deployment: {
    cluster: "devnet" | "mainnet-beta";
    programAddress: string;
    collateralMint: string;
    feeRecipient: string;
    resolver: string;
    currentResolver: string;
    paused: boolean;
    tradingFeeBps: number;
    market: string;
    vault: string;
    creationSignature: string;
  };
  market: {
    status: "unresolved" | "resolved" | "invalid";
    opensAt: string;
    closesAt: string;
    resolveAfter: string;
    resolvedAt: string;
    normalizedOutcome: number;
    bucketCount: number;
    winningBucket: number;
    jackpotBps: number;
    jackpotLeverageCap: number;
    feeBps: number;
    totalStaked: string;
    protocolFee: string;
    payoutPool: string;
    jackpotPool: string;
    curvePool: string;
    exactStake: string;
    weightedStake: string;
    totalClaimed: string;
    bucketStakes: string[];
    resolutionReportHash: string;
  };
  asOf: string;
}

export interface ScarcityCurvePortfolio {
  deployment: null | {
    cluster: "devnet" | "mainnet-beta";
    programAddress: string;
    collateralMint: string;
    paused: boolean;
  };
  positions: Array<{
    slug: string;
    market: string;
    bucket: number;
    stake: string;
    payout: string;
    claimable: string;
    claimed: boolean;
    status: "unresolved" | "resolved" | "invalid";
    winningBucket: number;
    normalizedOutcome: number;
    bucketCount: number;
  }>;
  totals: { totalStaked: string; claimable: string };
  asOf: string;
}

export interface ScarcityPortfolio {
  deployment: null | { cluster: string; programAddress: string; collateralMint: string; paused: boolean };
  positions: Array<{ slug: string; yes: string; no: string; claimable: string; status: string }>;
  orders: Array<ScarcityBookOrder & { slug: string }>;
  totals: { openOrders: number; collateralBalance: string; usdcEscrow: string; claimable: string };
  asOf: string;
}

export interface ScarcityDataMetric {
  metricId: string;
  label: string;
  unit: string;
  value: number | null;
  normalizedScore: number | null;
  dataStatus: string;
  observedAt: string | null;
  observationIds: string[];
  sources: Array<{ id: string; name: string; kind: string; url?: string; operator?: string; updateCadenceDays?: number }>;
}

export interface ScarcityMetalReference {
  metalId: string;
  referenceName: string;
  relationship: "commercial-form" | "compound" | "group" | "application" | "isotope" | "scientific";
  coverageStage: "observed" | "mapped" | "scientific";
  cadence: "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "event-driven";
  referenceUnit: string;
  signalMetric: string;
  binaryQuestion: string;
  source: { id: string; name: string; operator: string; url: string };
  caveat: string;
  marketUse: "physical-signal" | "application-signal" | "scientific-event-only";
  settlementReadiness: "research-only";
}

export type CatalystCategory = "price-data" | "supply-projects" | "policy" | "science";

export interface MetalMarketNamespace {
  id: string;
  metalId: string;
  primaryPath: "data" | "event";
  primaryCategory: CatalystCategory;
  primaryQuestion: string;
  eligibleCategories: CatalystCategory[];
  paths: Array<{
    kind: "data" | "event";
    eligible: boolean;
    state: "reference-mapped" | "event-eligible" | "requires-catalyst";
    description: string;
  }>;
  resolver: {
    primarySourceId: string;
    primarySourceName: string;
    primarySourceUrl: string;
    evidenceHierarchy: readonly string[];
    invalidWhen: string;
  };
}

export interface ScarcityDataSnapshot {
  dataset: { id: string; label: string; kind: "production" | "sample" | "empty"; description: string };
  methodologyVersion: string;
  calculationId: string;
  marketTightness: { score: number | null; confidenceScore: number; coverageRatio: number; dataStatus: string; metrics: ScarcityDataMetric[] };
  structuralScarcity: { score: number | null; confidenceScore: number; coverageRatio: number; dataStatus: string; metrics: ScarcityDataMetric[] };
  dataConfidence: { score: number; grade: string; status: string; coverageRatio: number; sourceCount: number; latestObservationAt: string | null };
  reference: ScarcityMetalReference;
  state: ScarcityMetalState;
  history: ScarcityMetalState[];
  signals: ScarcitySignal[];
  candidates: ScarcityMarketCandidate[];
}

export interface ScarcityMetalState {
  id: string;
  metalId: string;
  datasetId: string;
  asOf: string;
  createdAt: string;
  methodologyVersion: string;
  calculationId: string;
  evidenceRoot: string;
  marketTightness: number | null;
  structuralScarcity: number | null;
  confidence: number;
  coverageStatus: "verified" | "partial" | "uncovered";
  momentum: { direction: "tightening" | "loosening" | "stable" | "unknown"; change: number | null; windowStart: string | null };
  observationIds: string[];
}

export interface ScarcitySignal {
  id: string;
  metalId: string;
  metalSymbol: string;
  metalName: string;
  type: string;
  label: string;
  description: string;
  direction: "tightening" | "loosening" | "neutral";
  severity: "info" | "watch" | "material" | "critical";
  detectedAt: string;
  effectiveAt: string;
  expiresAt: string | null;
  snapshotId: string;
  evidenceIds: string[];
  methodologyVersion: string;
  publication: "reviewed" | "illustrative";
  trigger: { metricId: string; metric: string; comparator: string; threshold: number; observed: number; unit: string };
  status: "active" | "expired";
}

export interface ScarcityMarketCandidate {
  id: string;
  signalId: string;
  metalId: string;
  metalSymbol: string;
  question: string;
  observationAt: string;
  metricId: string;
  comparator: string;
  threshold: number;
  unit: string;
  primarySourceIds: string[];
  methodologyVersion: string;
  specificationHash: string;
  readiness: "blocked" | "paper-ready" | "review-ready";
  blockers: string[];
}

export interface ScarcityOracleIndex {
  asOf: string;
  methodologyVersion: string | null;
  dataset: { id: string; label: string; kind: "production" | "sample" | "empty"; description: string };
  count: number;
  sourceCoverage: {
    observationCount: number;
    observedMetalCount: number;
    sourceCount: number;
    direct: number;
    group: number;
    specialized: number;
    nonCommercial: number;
  };
  frequencyCoverage: {
    realtimeMetalCount: number;
    weeklyMetalCount: number;
    activeMetalCount: number;
    monitoredPhysicalMetalCount: number;
  };
  marketNamespaceCoverage: {
    mapped: number;
    dataEligible: number;
    eventEligible: number;
    categories: Record<CatalystCategory, number>;
  };
  pipelineCoverage: {
    periodicElementCount: number;
    trackedElementCount: number;
    outOfScopeCount: number;
    bundledAnnualCount: number;
    referenceOnlyCount: number;
    scientificOnlyCount: number;
    activeMarketPulseCount: number;
    scheduledRefreshCount: number;
    structuralFailureCount: number;
  };
  referenceCoverage: { mapped: number; unmapped: number; observed: number; proxy: number; scientific: number };
  coverage: { verified: number; partial: number; uncovered: number };
  activeSignalCount: number;
  metals: Array<{
    metal: {
      id: string;
      symbol: string;
      name: string;
      atomicNumber: number;
      families: string[];
      description: string;
      marketStatus: "commercial" | "specialized" | "non-commercial";
      dataMode: "direct" | "group" | "none";
      sourceCommodity: null | { sourceId: string; chapter: string; commodity: string; commercialForm: string };
    };
    reference: ScarcityMetalReference;
    marketNamespace: MetalMarketNamespace;
    frequency: {
      highestActiveCadence: "real-time" | "weekly" | "annual";
      realtimeReference: boolean;
      weeklyPositioning: boolean;
      monthlyPhysicalMonitor: boolean;
      monthlyPhysicalState: "source-paused" | "not-mapped";
    };
    pipeline: {
      pipelineReadiness: "bundled-annual" | "reference-only" | "scientific-only";
      observationCount: number;
      activeMarketPulse: boolean;
      scheduledRefresh: boolean;
      structuralStatus: "pass" | "fail";
      issues: string[];
      remainingWork: string[];
    };
    calculationId: string;
    state: ScarcityMetalState;
    activeSignalCount: number;
    marketCandidateCount: number;
    marketReady: boolean;
    marketTightness: { score: number | null; confidenceScore: number; confidenceGrade: string; coverageRatio: number; dataStatus: string };
    structuralScarcity: { score: number | null; confidenceScore: number; confidenceGrade: string; coverageRatio: number; dataStatus: string };
    dataConfidence: ScarcityDataSnapshot["dataConfidence"];
  }>;
}

export interface ScarcityWeeklyPositionPoint {
  observedAt: string;
  openInterest: number;
  openInterestChangePct: number;
  producerMerchantNetPct: number;
  managedMoneyNetPct: number;
}

export interface ScarcityMarketPulse {
  asOf: string;
  metal: { id: string; symbol: string; name: string };
  frequency: ScarcityOracleIndex["metals"][number]["frequency"];
  weekly: {
    available: boolean;
    metalId: string;
    source: {
      id: string;
      name: string;
      url: string;
      cadence: "weekly";
      contractCode: string | null;
      market: string | null;
      settlementUse: "not-approved";
    };
    freshness: "fresh" | "delayed" | "stale" | "unavailable";
    observedAt: string | null;
    nextExpectedAt: string | null;
    latest: ScarcityWeeklyPositionPoint | null;
    history: ScarcityWeeklyPositionPoint[];
    flags: Array<{
      id: string;
      type: string;
      label: string;
      description: string;
      severity: "info" | "watch" | "material";
      observed: number;
      unit: string;
    }>;
    note: string;
  };
  separation: string;
}

async function fetchMarketState(slug: string) {
  const response = await fetch(`/api/scarcity/exchange/markets/${encodeURIComponent(slug)}`, { cache: "no-store" });
  const payload = (await response.json()) as { deployed?: boolean; state?: ScarcityChainState | null; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Scarcity market state is unavailable.");
  return { deployed: Boolean(payload.deployed), state: payload.state ?? null };
}

async function fetchPortfolio(owner: string) {
  const response = await fetch(`/api/scarcity/exchange/portfolio?owner=${encodeURIComponent(owner)}`, { cache: "no-store" });
  const payload = (await response.json()) as ScarcityPortfolio & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Scarcity portfolio is unavailable.");
  return payload;
}

async function fetchCurveMarketState(slug: string) {
  const response = await fetch(`/api/scarcity/exchange/curves/${encodeURIComponent(slug)}`, { cache: "no-store" });
  const payload = (await response.json()) as { deployed?: boolean; state?: ScarcityCurveChainState | null; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Scarcity curve state is unavailable.");
  return { deployed: Boolean(payload.deployed), state: payload.state ?? null };
}

async function fetchCurvePortfolio(owner: string) {
  const response = await fetch(`/api/scarcity/exchange/curves/portfolio?owner=${encodeURIComponent(owner)}`, { cache: "no-store" });
  const payload = (await response.json()) as ScarcityCurvePortfolio & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Scarcity curve portfolio is unavailable.");
  return payload;
}

function datasetQuery(dataset?: string) {
  return dataset ? `?dataset=${encodeURIComponent(dataset)}` : "";
}

async function fetchScarcityData(identifier: string, dataset?: string) {
  const response = await fetch(`/api/scarcity/metals/${encodeURIComponent(identifier)}${datasetQuery(dataset)}`, { cache: "no-store" });
  const payload = await response.json() as ScarcityDataSnapshot & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Scarcity evidence is unavailable.");
  return payload;
}

async function fetchScarcityIndex(dataset?: string) {
  const response = await fetch(`/api/scarcity/metals${datasetQuery(dataset)}`, { cache: "no-store" });
  const payload = await response.json() as ScarcityOracleIndex & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Metal State Oracle is unavailable.");
  return payload;
}

async function fetchScarcitySignals(dataset?: string) {
  const separator = dataset ? "&" : "?";
  const response = await fetch(`/api/scarcity/signals${datasetQuery(dataset)}${separator}status=active`, { cache: "no-store" });
  const payload = await response.json() as { signals?: ScarcitySignal[]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Metal signals are unavailable.");
  return payload.signals ?? [];
}

async function fetchScarcityPulse(identifier: string) {
  const response = await fetch(`/api/scarcity/metals/${encodeURIComponent(identifier)}/pulse`, { cache: "no-store" });
  const payload = await response.json() as ScarcityMarketPulse & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Metal market pulse is unavailable.");
  return payload;
}

async function fetchMetalPulseSnapshot() {
  const response = await fetch("/api/scarcity/pulse/gold", { cache: "no-store" });
  const payload = await response.json() as MetalPulseSnapshot & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Metal Pulse is unavailable.");
  return payload;
}

export async function fetchMetalPulseRound(roundId: string) {
  const response = await fetch(`/api/scarcity/pulse/gold?round=${encodeURIComponent(roundId)}`, { cache: "no-store" });
  const payload = await response.json() as { round?: MetalPulseRound; error?: string };
  if (!response.ok || !payload.round) throw new Error(payload.error ?? "Metal Pulse round is unavailable.");
  return payload.round;
}

export function useScarcityMarketState(slug: string) {
  return useQuery({
    queryKey: ["scarcity-market-chain", slug],
    queryFn: () => fetchMarketState(slug),
    staleTime: 3_000,
    refetchInterval: (query) => query.state.data?.deployed ? 5_000 : 30_000,
    retry: 1,
  });
}

export function useScarcityPortfolio(owner: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["scarcity-portfolio", owner],
    queryFn: () => fetchPortfolio(owner!),
    enabled: Boolean(owner) && enabled,
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: 1,
  });
}

export function useScarcityCurveMarketState(slug: string) {
  return useQuery({
    queryKey: ["scarcity-curve-market-chain", slug],
    queryFn: () => fetchCurveMarketState(slug),
    enabled: Boolean(slug),
    staleTime: 3_000,
    refetchInterval: (query) => query.state.data?.deployed ? 5_000 : 30_000,
    retry: 1,
  });
}

export function useScarcityCurvePortfolio(owner: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["scarcity-curve-portfolio", owner],
    queryFn: () => fetchCurvePortfolio(owner!),
    enabled: Boolean(owner) && enabled,
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: 1,
  });
}

export function useScarcityData(identifier: string, dataset?: string) {
  return useQuery({
    queryKey: ["scarcity-production-data", identifier, dataset ?? "production"],
    queryFn: () => fetchScarcityData(identifier, dataset),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

export function useScarcityPulse(identifier: string) {
  return useQuery({
    queryKey: ["scarcity-market-pulse", identifier],
    queryFn: () => fetchScarcityPulse(identifier),
    enabled: Boolean(identifier),
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: 1,
  });
}

export function useMetalPulse() {
  return useQuery({
    queryKey: ["metal-pulse", "gold", "paper"],
    queryFn: fetchMetalPulseSnapshot,
    staleTime: 4_000,
    refetchInterval: 5_000,
    retry: 1,
  });
}

export function useScarcityOracleIndex(dataset?: string) {
  return useQuery({
    queryKey: ["scarcity-oracle-index", dataset ?? "production"],
    queryFn: () => fetchScarcityIndex(dataset),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

export function useScarcitySignals(dataset?: string) {
  return useQuery({
    queryKey: ["scarcity-signals", dataset ?? "production"],
    queryFn: () => fetchScarcitySignals(dataset),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

export interface TesterXpProfile {
  rulesVersion: string;
  granteeId: string;
  byCluster: { devnet: number; "mainnet-beta": number };
  total: number;
  roundsCompleted: number;
  rounds: Array<{
    roundSlug: string;
    cluster: "devnet" | "mainnet-beta";
    participation: number;
    accuracy: number;
    settlementClaim: number;
    total: number;
    effectiveBucket: number | null;
    note: string | null;
  }>;
  breadth: { firstRound: number; returningRounds: number; total: number };
  awards: { count: number; total: number };
  wallets: Array<{ wallet: string; linkedAt: string }>;
  disclosure: string;
}

async function fetchXpProfile() {
  const response = await fetch("/api/xp/profile", { cache: "no-store" });
  const payload = (await response.json()) as TesterXpProfile & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "XP is unavailable.");
  return payload;
}

export function useTesterXp(enabled = true) {
  return useQuery({
    queryKey: ["tester-xp"],
    queryFn: fetchXpProfile,
    enabled,
    staleTime: 15_000,
    retry: 1,
  });
}

export interface WalletLinkChallengePayload {
  granteeId: string;
  wallet: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  proof: string;
  message: string;
}

export async function requestWalletLinkChallenge(wallet: string) {
  const response = await fetch(`/api/xp/link?wallet=${encodeURIComponent(wallet)}`, { cache: "no-store" });
  const payload = (await response.json()) as WalletLinkChallengePayload & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Could not start the wallet link.");
  return payload;
}

export async function submitWalletLink(input: {
  wallet: string;
  nonce: string;
  expiresAt: string;
  proof: string;
  signature: string;
}) {
  const response = await fetch("/api/xp/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The wallet link could not be completed.");
  return payload;
}
