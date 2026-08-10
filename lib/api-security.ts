export interface RateLimitPolicy {
  key: string;
  limit: number;
  windowMs: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  limit: number;
  remaining: number;
  resetAt: number;
  headers: Record<string, string>;
}

export class ApiSecurityError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiSecurityError";
  }
}

const globalRateLimitState = globalThis as typeof globalThis & {
  __hedgentsRateLimits?: Map<string, RateLimitEntry>;
};

const rateLimits = globalRateLimitState.__hedgentsRateLimits ?? new Map<string, RateLimitEntry>();
globalRateLimitState.__hedgentsRateLimits = rateLimits;

function requestIdentity(request: Request) {
  const forwarded = (
    request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
  )?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function rateHeaders(policy: RateLimitPolicy, remaining: number, resetAt: number) {
  return {
    "x-ratelimit-limit": String(policy.limit),
    "x-ratelimit-remaining": String(Math.max(0, remaining)),
    "x-ratelimit-reset": String(Math.ceil(resetAt / 1000)),
  };
}

export function enforceRateLimit(
  request: Request,
  policy: RateLimitPolicy,
  now = Date.now(),
): RateLimitResult {
  const identity = requestIdentity(request);
  const key = `${policy.key}:${identity}`;
  const current = rateLimits.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + policy.windowMs }
    : current;

  entry.count += 1;
  rateLimits.set(key, entry);

  if (rateLimits.size > 10_000) {
    for (const [candidate, value] of rateLimits) {
      if (value.resetAt <= now) rateLimits.delete(candidate);
    }
  }

  const remaining = policy.limit - entry.count;
  const headers = rateHeaders(policy, remaining, entry.resetAt);
  if (entry.count > policy.limit) {
    throw new ApiSecurityError(
      "Too many requests. Wait for the current rate-limit window to reset.",
      429,
      {
        ...headers,
        "retry-after": String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))),
      },
    );
  }

  return { limit: policy.limit, remaining, resetAt: entry.resetAt, headers };
}

function allowedOrigins(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || requestUrl.protocol.replace(":", "");
  const configured = (process.env.HEDGENTS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  let browserFacingOrigin: string | null = null;
  if (host && (protocol === "http" || protocol === "https")) {
    try {
      browserFacingOrigin = new URL(`${protocol}://${host}`).origin;
    } catch {
      browserFacingOrigin = null;
    }
  }
  return new Set([requestUrl.origin, browserFacingOrigin, ...configured].filter(Boolean));
}

export function enforceMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (!allowedOrigins(request).has(origin)) {
    throw new ApiSecurityError("Cross-origin mutation requests are not accepted.", 403);
  }
}

export function enforceJsonBodyLimit(request: Request, maximumBytes = 32_768) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiSecurityError("This endpoint accepts application/json only.", 415);
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximumBytes) {
    throw new ApiSecurityError("The request body is too large.", 413);
  }
}

export async function readJsonBody(
  request: Request,
  maximumBytes = 32_768,
): Promise<Record<string, unknown>> {
  enforceJsonBodyLimit(request, maximumBytes);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maximumBytes) {
    throw new ApiSecurityError("The request body is too large.", 413);
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error();
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ApiSecurityError("The JSON request body is malformed.", 400);
  }
}

export function secureMutation(
  request: Request,
  policy: RateLimitPolicy,
  maximumBytes = 32_768,
) {
  enforceMutationOrigin(request);
  enforceJsonBodyLimit(request, maximumBytes);
  return enforceRateLimit(request, policy);
}

export function apiSecurityError(error: unknown) {
  return error instanceof ApiSecurityError
    ? { message: error.message, status: error.status, headers: error.headers }
    : null;
}

export function resetRateLimitsForTests() {
  rateLimits.clear();
}
