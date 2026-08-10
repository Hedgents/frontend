"use client";

import { useQuery } from "@tanstack/react-query";

export interface OnlineDetectorPayload {
  asOf: string;
  summary: {
    configured: boolean;
    schedule: "daily";
    scheduledMetalCount: number;
    sourceCount: number;
    sourcesHealthy: number;
    sourcesFailing: number;
    lastRunAt: string | null;
    lastSuccessfulRunAt: string | null;
    latestRunStatus: "pending" | "healthy" | "degraded" | "failed";
    evidenceCount: number;
    approvedEvidence: number;
    quarantinedEvidence: number;
    signalCount: number;
    reviewedSignals: number;
    candidateCount: number;
    reviewReadyCandidates: number;
    activeAlerts: number;
  };
  latestRun: null | {
    id: string;
    status: "healthy" | "degraded" | "failed";
    sourcesAttempted: number;
    sourcesSucceeded: number;
    sourcesChanged: number;
    evidenceDetected: number;
    evidenceDeduplicated: number;
    numericalSignalsComputed: number;
    errors: string[];
  };
  sources: Array<{
    sourceId: string;
    name: string;
    url: string;
    kind: string;
    metalIds: string[];
    lastCheckedAt: string | null;
    lastSuccessAt: string | null;
    status: "pending" | "healthy" | "failing";
    consecutiveFailures: number;
    lastError: string | null;
  }>;
  alerts: Array<{ id: string; severity: "warning" | "critical"; message: string; detectedAt: string }>;
  evidence: Array<{
    id: string;
    publisher: string;
    title: string;
    summary: string;
    url: string;
    category: "price-data" | "supply-projects" | "policy" | "science";
    metalIds: string[];
    publishedAt: string;
    retrievedAt: string;
    artifactPath: string;
    authority: "primary" | "official-index" | "registry";
    direction: "tightening" | "loosening" | "neutral";
    status: "quarantined" | "approved" | "rejected";
  }>;
  signals: Array<{
    id: string;
    evidenceId: string;
    metalId: string;
    metalSymbol: string;
    metalName: string;
    category: "price-data" | "supply-projects" | "policy" | "science";
    label: string;
    description: string;
    direction: "tightening" | "loosening" | "neutral";
    severity: "info" | "watch" | "material";
    detectedAt: string;
    source: { publisher: string; url: string; authority: "primary" | "official-index" | "registry" };
    publication: "quarantined" | "reviewed";
  }>;
  candidates: Array<{
    id: string;
    evidenceId: string;
    metalId: string;
    metalSymbol: string;
    category: string;
    question: string;
    resolverUrl: string;
    observationDeadline: string;
    specificationHash: string;
    readiness: "quarantined" | "review-ready" | "rejected";
    blockers: string[];
  }>;
  publishedCandidateIds: string[];
}

async function fetchOnlineDetector(metal?: string) {
  const query = metal ? `?metal=${encodeURIComponent(metal)}` : "";
  const response = await fetch(`/api/scarcity/detector${query}`, { cache: "no-store" });
  const payload = await response.json() as OnlineDetectorPayload & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Online metal detector is unavailable.");
  return payload;
}

export function useOnlineMetalDetector(metal?: string) {
  return useQuery({
    queryKey: ["online-metal-detector", metal ?? "all"],
    queryFn: () => fetchOnlineDetector(metal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}
