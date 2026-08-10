import { createHmac, randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";

function localSession(role: "beta" | "admin") {
  const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
  const payload = `${role}.${expiresAt}.${randomUUID()}`;
  const signature = createHmac(
    "sha256",
    process.env.HEDGENTS_AUTH_SECRET ?? "hedgents-local-auth-secret-do-not-use-in-production",
  ).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export async function grantLocalBetaSession(context: BrowserContext) {
  await context.addCookies([{
    name: "hedgents_beta",
    value: localSession("beta"),
    url: "http://127.0.0.1:3010",
    httpOnly: true,
    sameSite: "Lax",
  }]);
}
