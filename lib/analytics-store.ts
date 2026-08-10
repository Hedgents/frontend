import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { list, put } from "@vercel/blob";
import { confirmedOrderCount } from "@/lib/analytics-metrics";

export const analyticsEventNames = [
  "invite_access_granted",
  "route_comparison_loaded",
  "route_comparison_failed",
  "order_quote_requested",
  "order_quote_ready",
  "order_quote_failed",
  "order_signature_requested",
  "wallet_qa_approved",
  "order_submitted",
  "order_execution_failed",
  "order_confirmed",
  "settlement_verified",
  "settlement_pending",
] as const;

export type AnalyticsEventName = typeof analyticsEventNames[number];
export type AnalyticsProperties = Record<string, string | number>;

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  occurredAt: string;
  session: string;
  properties: AnalyticsProperties;
}

export interface AnalyticsSnapshot {
  generatedAt: string;
  rangeDays: number;
  storageConfigured: boolean;
  truncated: boolean;
  totalEvents: number;
  uniqueSessions: number;
  metrics: {
    inviteRedemptions: number;
    quotesReady: number;
    ordersSubmitted: number;
    ordersConfirmed: number;
    failures: number;
    quoteToSubmitPct: number | null;
    submitToConfirmPct: number | null;
  };
  eventCounts: Record<string, number>;
  topProducts: Array<{ label: string; count: number }>;
  topMetals: Array<{ label: string; count: number }>;
  recentEvents: AnalyticsEvent[];
}

function storageConfigured() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

function compactSession(sessionId: string) {
  const salt = process.env.HEDGENTS_AUTH_SECRET ?? "hedgents-local-analytics";
  return createHash("sha256").update(`${salt}:${sessionId}`).digest("hex").slice(0, 16);
}

function compactRequestId(requestId: string) {
  const salt = process.env.HEDGENTS_AUTH_SECRET ?? "hedgents-local-analytics";
  return createHash("sha256").update(`${salt}:execution:${requestId}`).digest("hex").slice(0, 16);
}

function safeProperties(properties: AnalyticsProperties) {
  return Object.fromEntries(
    Object.entries(properties)
      .slice(0, 8)
      .filter(([, value]) => typeof value === "number" || (typeof value === "string" && value.length <= 80))
      .map(([key, value]) => [
        key,
        key === "requestId" && typeof value === "string" ? compactRequestId(value) : value,
      ]),
  );
}

function encodeProperties(properties: AnalyticsProperties) {
  return Buffer.from(JSON.stringify(properties)).toString("base64url");
}

function parseEventPath(pathname: string, uploadedAt: Date): AnalyticsEvent | null {
  const filename = pathname.split("/").at(-1)?.replace(/\.json$/, "");
  if (!filename) return null;
  const [timestamp, , name, session, encoded] = filename.split("~");
  if (!analyticsEventNames.includes(name as AnalyticsEventName)) return null;
  try {
    const properties = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AnalyticsProperties;
    return {
      name: name as AnalyticsEventName,
      occurredAt: /^\d{13}$/.test(timestamp) ? new Date(Number(timestamp)).toISOString() : uploadedAt.toISOString(),
      session,
      properties,
    };
  } catch {
    return null;
  }
}

export async function recordAnalyticsEvent(
  name: AnalyticsEventName,
  sessionId: string,
  properties: AnalyticsProperties = {},
  occurredAt = new Date(),
) {
  const event = { name, sessionId: compactSession(sessionId), properties: safeProperties(properties), occurredAt };
  if (!storageConfigured()) {
    console.info("hedgents_beta_event", JSON.stringify(event));
    return false;
  }
  const day = occurredAt.toISOString().slice(0, 10);
  const pathname = [
    `analytics/${day}/${occurredAt.getTime()}`,
    randomUUID(),
    name,
    event.sessionId,
    encodeProperties(event.properties),
  ].join("~") + ".json";
  await put(pathname, "{}", {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
  return true;
}

function ranked(events: AnalyticsEvent[], property: string) {
  const counts = new Map<string, number>();
  for (const event of events) {
    const label = event.properties[property];
    if (typeof label === "string" && label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([label, count]) => ({ label, count }));
}

export async function getAnalyticsSnapshot(rangeDays = 7): Promise<AnalyticsSnapshot> {
  const days = Math.min(30, Math.max(1, Math.round(rangeDays)));
  const configured = storageConfigured();
  let events: AnalyticsEvent[] = [];
  let truncated = false;
  if (configured) {
    const blobs: Awaited<ReturnType<typeof list>>["blobs"] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = await list({ prefix: "analytics/", limit: 1_000, ...(cursor ? { cursor } : {}) });
      blobs.push(...result.blobs);
      if (!result.hasMore) {
        cursor = undefined;
        break;
      }
      cursor = result.cursor;
      if (page === 19) truncated = true;
    }
    const cutoff = Date.now() - days * 86_400_000;
    events = blobs
      .map((blob) => parseEventPath(blob.pathname, blob.uploadedAt))
      .filter((event): event is AnalyticsEvent => Boolean(event && Date.parse(event.occurredAt) >= cutoff))
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  }
  const eventCounts = Object.fromEntries(analyticsEventNames.map((name) => [name, 0]));
  for (const event of events) eventCounts[event.name] = (eventCounts[event.name] ?? 0) + 1;
  const quotesReady = eventCounts.order_quote_ready ?? 0;
  const ordersSubmitted = eventCounts.order_submitted ?? 0;
  const ordersConfirmed = confirmedOrderCount(events);
  const failures = events.filter((event) => event.name.endsWith("failed")).length;
  return {
    generatedAt: new Date().toISOString(),
    rangeDays: days,
    storageConfigured: configured,
    truncated,
    totalEvents: events.length,
    uniqueSessions: new Set(
      events.filter((event) => event.name !== "invite_access_granted").map((event) => event.session),
    ).size,
    metrics: {
      inviteRedemptions: eventCounts.invite_access_granted ?? 0,
      quotesReady,
      ordersSubmitted,
      ordersConfirmed,
      failures,
      quoteToSubmitPct: quotesReady > 0 ? Math.round((ordersSubmitted / quotesReady) * 1000) / 10 : null,
      submitToConfirmPct: ordersSubmitted > 0 ? Math.round((ordersConfirmed / ordersSubmitted) * 1000) / 10 : null,
    },
    eventCounts,
    topProducts: ranked(events, "productId"),
    topMetals: ranked(events, "metal"),
    recentEvents: events.slice(0, 24),
  };
}
