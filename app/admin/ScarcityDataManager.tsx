"use client";

import { useEffect, useMemo, useState } from "react";
import { SCARCITY_METRICS } from "@/lib/scarcity/methodology";
import { SCARCITY_METALS } from "@/lib/scarcity/registry";
import type { ScarcityObservationBatch, SourceKind } from "@/lib/scarcity/types";
import styles from "./admin.module.css";

type PublicationResult = {
  published: true;
  batchId: string;
  batchHash: string;
  datasetHash: string;
  artifactHash: string;
  artifactPath: string;
  observationCount: number;
  datasetObservationCount: number;
  materializedStateCount: number;
};

type GuidedForm = {
  sourceId: string;
  sourceName: string;
  sourceKind: SourceKind;
  sourceOperator: string;
  sourceUrl: string;
  updateCadenceDays: string;
  nextExpectedAt: string;
  redistribution: "unknown" | "permitted" | "restricted";
  settlementUse: "unknown" | "permitted" | "prohibited";
  rightsReviewedAt: string;
  metalId: string;
  metricId: string;
  value: string;
  observedAt: string;
  publishedAt: string;
  retrievedAt: string;
  status: "final" | "provisional" | "estimated";
  coverageRatio: string;
  independentSourceCount: string;
  observationNotes: string;
  contentType: string;
  artifactContent: string;
  reviewer: string;
  reviewedAt: string;
  reviewNotes: string;
};

function localInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function emptyForm(): GuidedForm {
  return {
    sourceId: "",
    sourceName: "",
    sourceKind: "official-statistics",
    sourceOperator: "",
    sourceUrl: "",
    updateCadenceDays: "30",
    nextExpectedAt: "",
    redistribution: "unknown",
    settlementUse: "unknown",
    rightsReviewedAt: "",
    metalId: "copper",
    metricId: "inventory-days",
    value: "",
    observedAt: "",
    publishedAt: "",
    retrievedAt: "",
    status: "final",
    coverageRatio: "1",
    independentSourceCount: "1",
    observationNotes: "",
    contentType: "application/json",
    artifactContent: "",
    reviewer: "",
    reviewedAt: "",
    reviewNotes: "",
  };
}

function initialForm(): GuidedForm {
  const now = Date.now();
  return {
    ...emptyForm(),
    observedAt: localInput(new Date(now - 72 * 60 * 60_000)),
    publishedAt: localInput(new Date(now - 48 * 60 * 60_000)),
    retrievedAt: localInput(new Date(now - 24 * 60 * 60_000)),
    reviewedAt: localInput(new Date(now)),
  };
}

function exampleBatch() {
  const now = Date.now();
  return JSON.stringify({
    schemaVersion: "1.0.0",
    batchId: `source:metal:metric:${new Date(now).toISOString().slice(0, 10)}`,
    datasetId: "production-v1",
    source: {
      id: "replace-with-stable-source-id",
      name: "Replace with publisher and dataset name",
      kind: "official-statistics",
      operator: "Replace with source operator",
      url: "https://example.com/source",
      updateCadenceDays: 30,
      redistribution: "unknown",
      settlementUse: "unknown",
    },
    observations: [{
      id: `source:metal:metric:${new Date(now).toISOString().slice(0, 10)}`,
      datasetId: "production-v1", metalId: "copper", metricId: "inventory-days", value: 0, unit: "days",
      observedAt: new Date(now - 86_400_000).toISOString(), publishedAt: new Date(now - 43_200_000).toISOString(),
      sourceId: "replace-with-stable-source-id", status: "final", coverageRatio: 1, independentSourceCount: 1,
      notes: "Explain normalization and any exclusions.",
    }],
    artifact: { contentType: "application/json", content: "Paste the exact retrieved source payload here.", retrievedAt: new Date(now - 21_600_000).toISOString(), sourceUrl: "https://example.com/source" },
    review: { reviewer: "operator-id", reviewedAt: new Date(now).toISOString(), notes: "Describe the verification performed before publication." },
  }, null, 2);
}

function requiredIso(value: string, label: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} is required.`);
  return new Date(timestamp).toISOString();
}

export function ScarcityDataManager({ durableStorage }: { durableStorage: boolean }) {
  const [mode, setMode] = useState<"guided" | "expert">("guided");
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<GuidedForm>(emptyForm);
  const [text, setText] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicationResult | null>(null);
  const metric = SCARCITY_METRICS.find((candidate) => candidate.id === form.metricId) ?? SCARCITY_METRICS[0];
  const steps = ["Source", "Observation", "Artifact", "Review"];

  useEffect(() => {
    const dated = initialForm();
    setForm((current) => ({
      ...current,
      observedAt: current.observedAt || dated.observedAt,
      publishedAt: current.publishedAt || dated.publishedAt,
      retrievedAt: current.retrievedAt || dated.retrievedAt,
      reviewedAt: current.reviewedAt || dated.reviewedAt,
    }));
  }, []);

  function update<K extends keyof GuidedForm>(key: K, value: GuidedForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setResult(null);
    setError(null);
  }

  const guidedBatch = useMemo(() => {
    try {
      if (!metric) return null;
      const date = requiredIso(form.observedAt, "Observation time").slice(0, 10);
      const stableSource = form.sourceId.trim();
      const observationId = `${stableSource}:${form.metalId}:${form.metricId}:${date}`;
      const source = {
        id: stableSource,
        name: form.sourceName.trim(),
        kind: form.sourceKind,
        ...(form.sourceOperator.trim() ? { operator: form.sourceOperator.trim() } : {}),
        url: form.sourceUrl.trim(),
        updateCadenceDays: Number(form.updateCadenceDays),
        ...(form.nextExpectedAt ? { nextExpectedAt: requiredIso(form.nextExpectedAt, "Next expected publication") } : {}),
        redistribution: form.redistribution,
        settlementUse: form.settlementUse,
        ...(form.rightsReviewedAt ? { rightsReviewedAt: requiredIso(form.rightsReviewedAt, "Rights review time") } : {}),
      };
      return {
        schemaVersion: "1.0.0",
        batchId: observationId,
        datasetId: "production-v1",
        source,
        observations: [{
          id: observationId,
          datasetId: "production-v1",
          metalId: form.metalId,
          metricId: metric.id,
          value: Number(form.value),
          unit: metric.unit,
          observedAt: requiredIso(form.observedAt, "Observation time"),
          publishedAt: requiredIso(form.publishedAt, "Publication time"),
          sourceId: stableSource,
          status: form.status,
          coverageRatio: Number(form.coverageRatio),
          independentSourceCount: Number(form.independentSourceCount),
          ...(form.observationNotes.trim() ? { notes: form.observationNotes.trim() } : {}),
        }],
        artifact: {
          contentType: form.contentType,
          content: form.artifactContent,
          retrievedAt: requiredIso(form.retrievedAt, "Retrieval time"),
          sourceUrl: form.sourceUrl.trim(),
        },
        review: {
          reviewer: form.reviewer.trim(),
          reviewedAt: requiredIso(form.reviewedAt, "Review time"),
          ...(form.reviewNotes.trim() ? { notes: form.reviewNotes.trim() } : {}),
        },
      } satisfies ScarcityObservationBatch;
    } catch {
      return null;
    }
  }, [form, metric]);

  async function publish(batch: unknown) {
    setPublishing(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/admin/scarcity/observations/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batch }),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) throw new Error(`Observation publication returned HTTP ${response.status}.`);
      const payload = await response.json() as PublicationResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Observation batch could not be published.");
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Observation batch could not be published.");
    } finally {
      setPublishing(false);
    }
  }

  async function publishGuided() {
    if (!guidedBatch) {
      setError("Complete every required field before publication.");
      return;
    }
    await publish(guidedBatch);
  }

  async function publishExpert() {
    try {
      await publish(JSON.parse(text) as unknown);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "JSON document is invalid.");
    }
  }

  return <section className={styles.dataPanel} aria-labelledby="scarcity-data-title" id="scarcity-data-publication">
    <div className={styles.dataHeader}>
      <div>
        <p className={styles.kicker}>SCX / evidence ingestion</p>
        <h2 id="scarcity-data-title">Scarcity data publication</h2>
        <p>Move one reviewed source artifact through a deliberate publication sequence. Immutable records are created only at the final step.</p>
      </div>
      <span className={durableStorage ? styles.storageReady : styles.storageLocal}>{durableStorage ? "Durable private storage" : "Storage not ready"}</span>
    </div>
    {!durableStorage ? <p className={styles.dataWarning}>Publication is locked until private Blob storage is configured. You can prepare and review a batch without writing production data.</p> : null}
    <div className={styles.dataModeSwitch} role="group" aria-label="Evidence publication mode">
      <button type="button" className={mode === "guided" ? styles.dataModeActive : undefined} onClick={() => setMode("guided")}>Guided publication</button>
      <button type="button" className={mode === "expert" ? styles.dataModeActive : undefined} onClick={() => setMode("expert")}>Expert JSON</button>
      <a href="/api/scarcity/methodology" target="_blank" rel="noreferrer">Open methodology</a>
    </div>

    {mode === "guided" ? <>
      <nav className={styles.publicationSteps} aria-label="Publication steps">
        {steps.map((label, index) => <button type="button" key={label} className={step === index ? styles.publicationStepActive : index < step ? styles.publicationStepDone : undefined} onClick={() => setStep(index)}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}
      </nav>
      <div className={styles.guidedForm}>
        {step === 0 ? <fieldset>
          <legend>Source identity</legend>
          <p>The source definition becomes immutable. Use an ID that remains stable across later observations.</p>
          <div className={styles.formGrid}>
            <label><span>Stable source ID</span><input value={form.sourceId} onChange={(event) => update("sourceId", event.target.value)} placeholder="usgs-mineral-commodity-summaries" /></label>
            <label><span>Publisher / dataset</span><input value={form.sourceName} onChange={(event) => update("sourceName", event.target.value)} placeholder="USGS Mineral Commodity Summaries" /></label>
            <label><span>Source kind</span><select value={form.sourceKind} onChange={(event) => update("sourceKind", event.target.value as SourceKind)}><option value="official-statistics">Official statistics</option><option value="regulated-benchmark">Regulated benchmark</option><option value="exchange">Exchange</option><option value="industry-assessment">Industry assessment</option><option value="dealer-quote">Dealer quote</option><option value="issuer">Issuer</option><option value="derived">Derived</option></select></label>
            <label><span>Operator</span><input value={form.sourceOperator} onChange={(event) => update("sourceOperator", event.target.value)} placeholder="Publishing organization" /></label>
            <label className={styles.formWide}><span>Canonical HTTPS source URL</span><input type="url" value={form.sourceUrl} onChange={(event) => update("sourceUrl", event.target.value)} placeholder="https://…" /></label>
            <label><span>Update cadence · days</span><input type="number" min="1" step="1" value={form.updateCadenceDays} onChange={(event) => update("updateCadenceDays", event.target.value)} /></label>
            <label><span>Next expected publication · optional</span><input type="datetime-local" value={form.nextExpectedAt} onChange={(event) => update("nextExpectedAt", event.target.value)} /></label>
            <label><span>Redistribution rights</span><select value={form.redistribution} onChange={(event) => update("redistribution", event.target.value as GuidedForm["redistribution"])}><option value="unknown">Unknown / unreviewed</option><option value="permitted">Permitted</option><option value="restricted">Restricted</option></select></label>
            <label><span>Settlement use</span><select value={form.settlementUse} onChange={(event) => update("settlementUse", event.target.value as GuidedForm["settlementUse"])}><option value="unknown">Unknown / unreviewed</option><option value="permitted">Permitted</option><option value="prohibited">Prohibited</option></select></label>
            <label><span>Rights reviewed at · optional</span><input type="datetime-local" value={form.rightsReviewedAt} onChange={(event) => update("rightsReviewedAt", event.target.value)} /></label>
          </div>
        </fieldset> : null}
        {step === 1 ? <fieldset>
          <legend>Normalized observation</legend>
          <p>Choose a frozen metric. Its required unit and methodology are derived automatically.</p>
          <div className={styles.formGrid}>
            <label><span>Metal</span><select value={form.metalId} onChange={(event) => update("metalId", event.target.value)}>{SCARCITY_METALS.map((metal) => <option value={metal.id} key={metal.id}>{metal.symbol} · {metal.name}</option>)}</select></label>
            <label><span>Metric</span><select value={form.metricId} onChange={(event) => update("metricId", event.target.value)}>{SCARCITY_METRICS.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.label}</option>)}</select></label>
            <label><span>Observed value · {metric?.unit}</span><input type="number" step="any" value={form.value} onChange={(event) => update("value", event.target.value)} /></label>
            <label><span>Status</span><select value={form.status} onChange={(event) => update("status", event.target.value as GuidedForm["status"])}><option value="final">Final</option><option value="provisional">Provisional</option><option value="estimated">Estimated</option></select></label>
            <label><span>Observed at</span><input type="datetime-local" value={form.observedAt} onChange={(event) => update("observedAt", event.target.value)} /></label>
            <label><span>Published at</span><input type="datetime-local" value={form.publishedAt} onChange={(event) => update("publishedAt", event.target.value)} /></label>
            <label><span>Coverage ratio · 0 to 1</span><input type="number" min="0" max="1" step="0.01" value={form.coverageRatio} onChange={(event) => update("coverageRatio", event.target.value)} /></label>
            <label><span>Independent source count</span><input type="number" min="1" step="1" value={form.independentSourceCount} onChange={(event) => update("independentSourceCount", event.target.value)} /></label>
            <label className={styles.formWide}><span>Normalization / exclusions</span><textarea value={form.observationNotes} onChange={(event) => update("observationNotes", event.target.value)} placeholder="Explain transformations and exclusions." /></label>
          </div>
          <aside className={styles.metricExplanation}><strong>{metric?.label}</strong><span>{metric?.description}</span><small>{metric?.dimension} · maximum age {metric?.maximumAgeDays} days · unit {metric?.unit}</small></aside>
        </fieldset> : null}
        {step === 2 ? <fieldset>
          <legend>Exact source artifact</legend>
          <p>Store the exact payload retrieved from the URL. The content hash becomes the permanent audit reference.</p>
          <div className={styles.formGrid}>
            <label><span>Content type</span><select value={form.contentType} onChange={(event) => update("contentType", event.target.value)}><option value="application/json">application/json</option><option value="text/csv">text/csv</option><option value="text/plain">text/plain</option><option value="application/xml">application/xml</option><option value="text/xml">text/xml</option></select></label>
            <label><span>Retrieved at</span><input type="datetime-local" value={form.retrievedAt} onChange={(event) => update("retrievedAt", event.target.value)} /></label>
            <label className={styles.formWide}><span>Exact retrieved payload</span><textarea className={styles.artifactEditor} value={form.artifactContent} onChange={(event) => update("artifactContent", event.target.value)} spellCheck={false} placeholder="Paste the unmodified source response." /></label>
          </div>
        </fieldset> : null}
        {step === 3 ? <fieldset>
          <legend>Human review and publication</legend>
          <p>Confirm source chronology, normalized units, and the exact artifact before a wallet or production write is considered.</p>
          <div className={styles.formGrid}>
            <label><span>Reviewer identifier</span><input value={form.reviewer} onChange={(event) => update("reviewer", event.target.value)} placeholder="operator-id" /></label>
            <label><span>Reviewed at</span><input type="datetime-local" value={form.reviewedAt} onChange={(event) => update("reviewedAt", event.target.value)} /></label>
            <label className={styles.formWide}><span>Verification performed</span><textarea value={form.reviewNotes} onChange={(event) => update("reviewNotes", event.target.value)} placeholder="Describe cross-checks and reviewer judgment." /></label>
          </div>
          <div className={styles.publicationReview}>
            <div><span>Source</span><strong>{form.sourceName || "Missing"}</strong><small>{form.sourceId || "Stable ID required"}</small></div>
            <div><span>Observation</span><strong>{form.value || "—"} {metric?.unit}</strong><small>{form.metalId} · {metric?.label}</small></div>
            <div><span>Artifact</span><strong>{form.artifactContent.length.toLocaleString()} chars</strong><small>{form.contentType}</small></div>
            <div><span>Record ID</span><strong>{guidedBatch?.observations[0]?.id ?? "Incomplete"}</strong><small>Immutable after publication</small></div>
          </div>
          <button className={styles.publishDataButton} type="button" disabled={!durableStorage || publishing || !guidedBatch} onClick={() => void publishGuided()}>{publishing ? "Publishing…" : durableStorage ? "Validate + publish evidence" : "Storage required before publication"}</button>
        </fieldset> : null}
        <div className={styles.stepActions}>
          <button type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>Back</button>
          <button type="button" onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))} disabled={step === steps.length - 1}>Continue</button>
        </div>
      </div>
    </> : <div className={styles.expertEditor}>
      <div className={styles.dataToolbar}><button type="button" onClick={() => setText(exampleBatch())}>Load schema template</button><span>Advanced mode supports multi-observation batches.</span></div>
      <textarea aria-label="Scarcity observation batch JSON" value={text} onChange={(event) => { setText(event.target.value); setResult(null); setError(null); }} placeholder="Paste a reviewed ScarcityObservationBatch JSON document." spellCheck={false} />
      <button className={styles.publishDataButton} type="button" disabled={!durableStorage || publishing || text.trim().length === 0} onClick={() => void publishExpert()}>{publishing ? "Publishing…" : durableStorage ? "Validate + publish JSON batch" : "Storage required before publication"}</button>
    </div>}
    {error ? <p className={styles.inviteError} role="alert">{error}</p> : null}
    {result ? <div className={styles.dataResult} role="status"><strong>Production dataset updated</strong><span>{result.observationCount} observation(s) · {result.datasetObservationCount} total</span><code>Dataset {result.datasetHash}</code><code>Batch {result.batchHash}</code><a href={result.artifactPath} target="_blank" rel="noreferrer">Open source artifact</a></div> : null}
  </section>;
}
