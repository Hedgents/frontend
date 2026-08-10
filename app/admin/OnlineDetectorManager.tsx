"use client";

import { useCallback, useEffect, useState } from "react";
import type { OnlineDetectorPayload } from "@/hooks/use-online-metal-detector";
import styles from "./admin.module.css";

export function OnlineDetectorManager({ durableStorage }: { durableStorage: boolean }) {
  const [detector, setDetector] = useState<OnlineDetectorPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState("operator");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/scarcity/detector", { cache: "no-store" });
      const payload = await response.json() as OnlineDetectorPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Detector status is unavailable.");
      setDetector(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Detector status is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function runDetector() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/scarcity/detector/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Detector run failed.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Detector run failed.");
    } finally {
      setRunning(false);
    }
  }

  async function review(evidenceId: string, decision: "approved" | "rejected") {
    if (!reviewer.trim()) {
      setError("Enter a reviewer identifier first.");
      return;
    }
    setReviewing(evidenceId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/scarcity/detector/evidence/${encodeURIComponent(evidenceId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reviewer: reviewer.trim() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Evidence review failed.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Evidence review failed.");
    } finally {
      setReviewing(null);
    }
  }

  async function publish(candidateId: string) {
    if (!reviewer.trim()) {
      setError("Enter a reviewer identifier first.");
      return;
    }
    setPublishing(candidateId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/scarcity/markets/candidates/${encodeURIComponent(candidateId)}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewer: reviewer.trim() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Candidate publication failed.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Candidate publication failed.");
    } finally {
      setPublishing(null);
    }
  }

  const queue = detector?.evidence.filter((evidence) => evidence.status === "quarantined") ?? [];
  const failingSources = detector?.sources.filter((source) => source.status === "failing") ?? [];
  const readyCandidates = detector?.candidates.filter((candidate) => candidate.readiness === "review-ready") ?? [];
  const publishedCandidates = new Set(detector?.publishedCandidateIds ?? []);

  return <section className={styles.detectorPanel} id="online-detector" aria-labelledby="online-detector-title">
    <div className={styles.detectorHeader}>
      <div>
        <p className={styles.kicker}>SCX / online intelligence</p>
        <h2 id="online-detector-title">Metal signal detector</h2>
        <p>One daily job checks the complete reference registry, official policy records, rotating scientific publications, and USGS structured releases. New evidence is quarantined here before market use.</p>
      </div>
      <span className={durableStorage ? styles.storageReady : styles.storageLocal}>{durableStorage ? "Durable private storage" : "Storage not ready"}</span>
    </div>
    <div className={styles.detectorActions}>
      <button type="button" onClick={() => void runDetector()} disabled={running || !durableStorage}>{running ? "Scanning official sources…" : "Run detector now"}</button>
      <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh status"}</button>
      <label><span>Reviewer</span><input value={reviewer} onChange={(event) => setReviewer(event.target.value)} maxLength={80} /></label>
    </div>
    {error ? <p className={styles.detectorError}>{error}</p> : null}
    <div className={styles.detectorMetrics}>
      <div><span>Scheduled coverage</span><strong>{detector?.summary.scheduledMetalCount ?? "—"}/99</strong></div>
      <div><span>Healthy sources</span><strong>{detector ? `${detector.summary.sourcesHealthy}/${detector.summary.sourceCount}` : "—"}</strong></div>
      <div><span>Review queue</span><strong>{detector?.summary.quarantinedEvidence ?? "—"}</strong></div>
      <div><span>Reviewed signals</span><strong>{detector?.summary.reviewedSignals ?? "—"}</strong></div>
      <div><span>Market candidates</span><strong>{detector?.summary.candidateCount ?? "—"}</strong></div>
      <div><span>Run state</span><strong>{detector?.summary.latestRunStatus ?? "pending"}</strong></div>
    </div>
    <div className={styles.detectorHealth}>
      <header><span>Source health</span><strong>{failingSources.length ? `${failingSources.length} attention` : detector?.summary.lastRunAt ? "All healthy" : "Awaiting first run"}</strong></header>
      {failingSources.length ? failingSources.map((source) => <article key={source.sourceId}>
        <div><strong>{source.name}</strong><small>{source.kind.replaceAll("-", " ")} · {source.metalIds.length} namespace{source.metalIds.length === 1 ? "" : "s"}</small></div>
        <p>{source.lastError ?? "Upstream source check failed without an error detail."}</p>
        <a href={source.url} target="_blank" rel="noreferrer">Inspect source</a>
      </article>) : <p className={styles.detectorHealthOk}>{detector?.summary.lastRunAt ? `All ${detector.summary.sourceCount} configured sources passed the latest run.` : "The first run will establish source fingerprints and health baselines."}</p>}
      {detector?.alerts.length ? <div className={styles.detectorAlerts}>{detector.alerts.map((alert) => <p key={alert.id}><strong>{alert.severity}</strong>{alert.message}</p>)}</div> : null}
    </div>
    <div className={styles.detectorQueue}>
      <header><span>Quarantined evidence</span><strong>{queue.length.toString().padStart(2, "0")}</strong></header>
      {queue.length ? queue.slice(0, 25).map((evidence) => <article key={evidence.id}>
        <div>
          <span>{evidence.category.replaceAll("-", " ")} · {evidence.authority}</span>
          <strong>{evidence.title}</strong>
          <small>{evidence.publisher} · {new Date(evidence.publishedAt).toLocaleDateString("en-GB", { timeZone: "UTC" })} UTC</small>
        </div>
        <div className={styles.detectorLinks}><a href={evidence.url} target="_blank" rel="noreferrer">Source</a><a href={evidence.artifactPath} target="_blank" rel="noreferrer">Artifact</a></div>
        <div className={styles.detectorReviewActions}>
          <button type="button" disabled={reviewing === evidence.id} onClick={() => void review(evidence.id, "approved")}>Approve</button>
          <button type="button" disabled={reviewing === evidence.id} onClick={() => void review(evidence.id, "rejected")}>Reject</button>
        </div>
      </article>) : <p className={styles.detectorEmpty}>{loading ? "Loading detector state…" : detector?.summary.lastRunAt ? "No evidence is waiting for review." : "Run the detector once to establish source fingerprints."}</p>}
    </div>
    <div className={styles.detectorQueue}>
      <header><span>Reviewed market candidates</span><strong>{readyCandidates.length.toString().padStart(2, "0")}</strong></header>
      {readyCandidates.length ? readyCandidates.slice(0, 25).map((candidate) => {
        const isPublished = publishedCandidates.has(candidate.id);
        return <article key={candidate.id}>
          <div>
            <span>{candidate.category.replaceAll("-", " ")} · {candidate.metalSymbol}</span>
            <strong>{candidate.question}</strong>
            <small>Deadline {new Date(candidate.observationDeadline).toLocaleDateString("en-GB", { timeZone: "UTC" })} UTC · spec {candidate.specificationHash.slice(0, 12)}…</small>
          </div>
          <div className={styles.detectorLinks}><a href={candidate.resolverUrl} target="_blank" rel="noreferrer">Resolver</a></div>
          <div className={styles.detectorReviewActions}>
            <button type="button" disabled={isPublished || publishing === candidate.id || !durableStorage} onClick={() => void publish(candidate.id)}>
              {isPublished ? "Published" : publishing === candidate.id ? "Freezing specification…" : "Publish specification"}
            </button>
          </div>
        </article>;
      }) : <p className={styles.detectorEmpty}>Approve eligible policy evidence to create a review-ready binary market candidate.</p>}
    </div>
  </section>;
}
