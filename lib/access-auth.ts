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

type AccessRole = "beta" | "admin";

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

export function createAccessSession(role: AccessRole, lifetimeSeconds: number) {
  const expiresAt = Math.floor(Date.now() / 1000) + lifetimeSeconds;
  const payload = `${role}.${expiresAt}.${randomUUID()}`;
  const signature = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyAccessSession(token: string | null | undefined, role: AccessRole) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [tokenRole, expiry, sessionId, signature] = parts;
  if (tokenRole !== role || !/^\d+$/.test(expiry) || !/^[0-9a-f-]{36}$/i.test(sessionId)) return false;
  if (Number(expiry) <= Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac("sha256", authSecret())
    .update(`${tokenRole}.${expiry}.${sessionId}`)
    .digest("base64url");
  const actualBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [candidate, ...value] = part.trim().split("=");
    if (candidate === name) return decodeURIComponent(value.join("="));
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
  if (!hasInviteAccess(request)) throw new ApiSecurityError("A valid beta invite is required.", 401);
}

export function requireAdminAccess(request: Request) {
  if (!hasAdminAccess(request)) throw new ApiSecurityError("Administrator access is required.", 401);
}
