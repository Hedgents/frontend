import { NextResponse } from "next/server";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";
import { requireInviteAccess } from "@/lib/access-auth";
import { analyticsEventNames, recordAnalyticsEvent } from "@/lib/analytics-store";

export const dynamic = "force-dynamic";

const eventNames = new Set<string>(analyticsEventNames);
const propertyKeys = new Set([
  "productId",
  "metal",
  "phase",
  "errorCode",
  "amountBucket",
  "liveRouteCount",
  "adapterCount",
]);

function cleanProperties(value: unknown): Record<string, string | number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const properties: Record<string, string | number> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!propertyKeys.has(key)) continue;
    if (typeof entry === "string") properties[key] = entry.slice(0, 80);
    if (typeof entry === "number" && Number.isFinite(entry)) properties[key] = entry;
  }
  return properties;
}

export async function POST(request: Request) {
  let responseHeaders: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    responseHeaders = secureMutation(
      request,
      { key: "telemetry", limit: 120, windowMs: 60_000 },
      4_096,
    ).headers;
    const body = await readJsonBody(request, 4_096);
    if (typeof body.name !== "string" || !eventNames.has(body.name)) {
      return NextResponse.json({ error: "Unsupported beta event." }, { status: 400, headers: responseHeaders });
    }
    if (typeof body.sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.sessionId)) {
      return NextResponse.json({ error: "Invalid anonymous session." }, { status: 400, headers: responseHeaders });
    }
    await recordAnalyticsEvent(
      body.name as (typeof analyticsEventNames)[number],
      body.sessionId,
      cleanProperties(body.properties),
      new Date(),
    );
    return new NextResponse(null, { status: 204, headers: responseHeaders });
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security ? security.message : "Malformed beta event." },
      { status: security?.status ?? 400, headers: { ...responseHeaders, ...(security?.headers ?? {}) } },
    );
  }
}
