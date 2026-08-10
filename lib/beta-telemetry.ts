"use client";

export type BetaEventName =
  | "route_comparison_loaded"
  | "route_comparison_failed"
  | "order_quote_requested"
  | "order_quote_ready"
  | "order_quote_failed"
  | "order_signature_requested"
  | "wallet_qa_approved"
  | "order_submitted"
  | "order_execution_failed"
  | "order_confirmed"
  | "settlement_verified"
  | "settlement_pending";

interface BetaEventProperties {
  productId?: string;
  metal?: string;
  phase?: string;
  errorCode?: string;
  amountBucket?: string;
  liveRouteCount?: number;
  adapterCount?: number;
  requestId?: string;
}

const CONSENT_KEY = "hedgents:beta-diagnostics-consent";
const SESSION_KEY = "hedgents:beta-session";
const DEDUPE_KEY = "hedgents:beta-event-dedupe";

export function diagnosticsConsentEnabled() {
  return typeof window !== "undefined" && window.localStorage.getItem(CONSENT_KEY) === "true";
}

export function setDiagnosticsConsent(enabled: boolean) {
  window.localStorage.setItem(CONSENT_KEY, String(enabled));
}

function sessionId() {
  const existing = window.sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = window.crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_KEY, created);
  return created;
}

export function trackBetaEvent(name: BetaEventName, properties: BetaEventProperties = {}) {
  if (!diagnosticsConsentEnabled()) return;
  if (name === "route_comparison_loaded") {
    const key = `${name}:${properties.metal ?? "unknown"}:${properties.amountBucket ?? "unknown"}`;
    const sent = new Set((window.sessionStorage.getItem(DEDUPE_KEY) ?? "").split(",").filter(Boolean));
    if (sent.has(key)) return;
    sent.add(key);
    window.sessionStorage.setItem(DEDUPE_KEY, [...sent].slice(-40).join(","));
  }
  void fetch("/api/telemetry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      name,
      sessionId: sessionId(),
      properties,
      occurredAt: new Date().toISOString(),
    }),
  }).catch(() => undefined);
}
