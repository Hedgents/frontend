import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { ApiSecurityError } from "@/lib/api-security";

export const BETA_COOKIE = "hedgents_beta";
export const ADMIN_COOKIE = "hedgents_admin";
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export type AccessRole = "beta" | "admin";

export interface AccessSessionClaims {
  version: 2;
  role: AccessRole;
  expiresAt: number;
  issuedAt: number;
  sessionId: string;
  grantId: string;
  grantVersion: number;
}

export const ACCESS_ATTESTATION_HEADER = "x-hedgents-access-attestation";
export const BETA_SESSION_LIFETIME_SECONDS = 12 * 3_600;
const INTERNAL_ATTESTATION_LIFETIME_SECONDS = 30;

const DEV_CODES: Record<AccessRole, string> = {
  beta: "hedgents-beta",
  admin: "hedgents-admin",
};

export function hashAccessCode(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function authSecret() {
  const configured = process.env.HEDGENTS_AUTH_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return "hedgents-local-auth-secret-do-not-use-in-production";
  throw new ApiSecurityError("Access control is not configured.", 503);
}

function expectedCodeHash(role: AccessRole) {
  const variable = role === "admin" ? "HEDGENTS_ADMIN_CODE_HASH" : "HEDGENTS_INVITE_CODE_HASH";
  const configured = process.env[variable]?.trim().toLowerCase();
  if (configured && /^[a-f0-9]{64}$/.test(configured)) return configured;
  if (process.env.NODE_ENV !== "production") return hashAccessCode(DEV_CODES[role]);
  throw new ApiSecurityError("Access control is not configured.", 503);
}

function safeEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function validateAccessCode(code: unknown, role: AccessRole) {
  if (typeof code !== "string" || code.length < 8 || code.length > 128) return false;
  return safeEqualHex(hashAccessCode(code.trim()), expectedCodeHash(role));
}

export function accessCodeHashesMatch(left: string, right: string) {
  return safeEqualHex(left, right);
}

function validGrantId(value: string) {
  return value === "admin" || value === "dev" || /^[A-F0-9]{12}$/.test(value);
}

function safeEqualText(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createAccessSession(
  role: AccessRole,
  lifetimeSeconds: number,
  grant: { id: string; version: number } = { id: role === "admin" ? "admin" : "dev", version: 1 },
) {
  if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds < 1) {
    throw new ApiSecurityError("Access session lifetime is invalid.", 500);
  }
  if (role === "beta" && lifetimeSeconds > BETA_SESSION_LIFETIME_SECONDS) {
    throw new ApiSecurityError("Beta access sessions cannot exceed 12 hours.", 500);
  }
  if (role === "beta" && grant.id === "dev" && process.env.NODE_ENV === "production") {
    throw new ApiSecurityError("A durable invite grant is required in production.", 503);
  }
  if (
    !validGrantId(grant.id)
    || (role === "admin" && grant.id !== "admin")
    || (role === "beta" && grant.id === "admin")
    || !Number.isSafeInteger(grant.version)
    || grant.version < 1
  ) {
    throw new ApiSecurityError("Access session grant is invalid.", 500);
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + lifetimeSeconds;
  const payload = `v2.${role}.${expiresAt}.${issuedAt}.${randomUUID()}.${grant.id}.${grant.version}`;
  const signature = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readAccessSession(token: string | null | undefined, role: AccessRole): AccessSessionClaims | null {
  if (!token || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length === 4) {
    // Preserve existing operator sessions during rollout, but old beta cookies
    // have no revocable grant identity and therefore fail closed.
    if (role !== "admin") return null;
    const [tokenRole, expiry, sessionId, signature] = parts;
    if (tokenRole !== role || !/^\d+$/.test(expiry) || !/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
    if (Number(expiry) <= Math.floor(Date.now() / 1000)) return null;
    const expected = createHmac("sha256", authSecret())
      .update(`${tokenRole}.${expiry}.${sessionId}`)
      .digest("base64url");
    if (!safeEqualText(signature, expected)) return null;
    return {
      version: 2,
      role,
      expiresAt: Number(expiry),
      issuedAt: Number(expiry) - BETA_SESSION_LIFETIME_SECONDS,
      sessionId,
      grantId: "admin",
      grantVersion: 1,
    };
  }
  if (parts.length !== 8) return null;
  const [version, tokenRole, expiry, issued, sessionId, grantId, grantVersion, signature] = parts;
  if (
    version !== "v2"
    || tokenRole !== role
    || !/^\d+$/.test(expiry)
    || !/^\d+$/.test(issued)
    || !/^[0-9a-f-]{36}$/i.test(sessionId)
    || !validGrantId(grantId)
    || (role === "admin" && grantId !== "admin")
    || (role === "beta" && grantId === "admin")
    || !/^\d+$/.test(grantVersion)
  ) return null;
  const expiresAt = Number(expiry);
  const issuedAt = Number(issued);
  const numericGrantVersion = Number(grantVersion);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(expiresAt)
    || !Number.isSafeInteger(issuedAt)
    || !Number.isSafeInteger(numericGrantVersion)
    || numericGrantVersion < 1
    || issuedAt > now + 60
    || expiresAt <= now
    || expiresAt <= issuedAt
    || (role === "beta" && expiresAt - issuedAt > BETA_SESSION_LIFETIME_SECONDS)
  ) return null;
  const expected = createHmac("sha256", authSecret())
    .update(parts.slice(0, 7).join("."))
    .digest("base64url");
  if (!safeEqualText(signature, expected)) return null;
  return {
    version: 2,
    role,
    expiresAt,
    issuedAt,
    sessionId,
    grantId,
    grantVersion: numericGrantVersion,
  };
}

export function verifyAccessSession(token: string | null | undefined, role: AccessRole) {
  return Boolean(readAccessSession(token, role));
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [candidate, ...value] = part.trim().split("=");
    if (candidate === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function hasInviteAccess(request: Request) {
  return verifyAccessSession(cookieValue(request, BETA_COOKIE), "beta")
    || verifyAccessSession(cookieValue(request, ADMIN_COOKIE), "admin");
}

export function hasAdminAccess(request: Request) {
  return verifyAccessSession(cookieValue(request, ADMIN_COOKIE), "admin");
}

function requestPathname(request: Request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "/";
  }
}

export function createAccessAttestation(
  claims: AccessSessionClaims,
  method: string,
  pathname: string,
  lifetimeSeconds = INTERNAL_ATTESTATION_LIFETIME_SECONDS,
) {
  if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > 60) {
    throw new ApiSecurityError("Internal access attestation lifetime is invalid.", 500);
  }
  const expiresAt = Math.floor(Date.now() / 1000) + lifetimeSeconds;
  const payload = `v1.${expiresAt}.${claims.sessionId}`;
  const signature = createHmac("sha256", authSecret())
    .update(`${payload}.${method.toUpperCase()}.${pathname}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyAccessAttestation(request: Request, claims: AccessSessionClaims) {
  const token = request.headers.get(ACCESS_ATTESTATION_HEADER);
  if (!token || token.length > 512) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [version, expiry, sessionId, signature] = parts;
  if (version !== "v1" || !/^\d+$/.test(expiry) || sessionId !== claims.sessionId) return false;
  const expiresAt = Number(expiry);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 60) return false;
  const expected = createHmac("sha256", authSecret())
    .update(`${version}.${expiry}.${sessionId}.${request.method.toUpperCase()}.${requestPathname(request)}`)
    .digest("base64url");
  return safeEqualText(signature, expected);
}

export function safeLocalRedirectPath(value: unknown) {
  if (typeof value !== "string" || value.length > 2_048) return "/";
  try {
    const base = new URL("https://terminal.hedgents.invalid/");
    const target = new URL(value, base);
    if (target.origin !== base.origin || !value.startsWith("/")) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

export function requireInviteAccess(request: Request) {
  const admin = readAccessSession(cookieValue(request, ADMIN_COOKIE), "admin");
  if (admin) return admin;
  const beta = readAccessSession(cookieValue(request, BETA_COOKIE), "beta");
  if (!beta || !verifyAccessAttestation(request, beta)) {
    throw new ApiSecurityError("A valid beta invite is required.", 401);
  }
  return beta;
}

export function requireAdminAccess(request: Request) {
  if (!hasAdminAccess(request)) throw new ApiSecurityError("Administrator access is required.", 401);
}
