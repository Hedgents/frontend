import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  createAccessSession,
  SESSION_COOKIE_OPTIONS,
  validateAccessCode,
} from "@/lib/access-auth";
import { apiSecurityError, readJsonBody, secureMutation } from "@/lib/api-security";

export async function POST(request: Request) {
  let headers: Record<string, string> = {};
  try {
    headers = secureMutation(request, { key: "admin-auth", limit: 5, windowMs: 10 * 60_000 }, 1_024).headers;
    const body = await readJsonBody(request, 1_024);
    if (!validateAccessCode(body.code, "admin")) {
      return NextResponse.json({ error: "Administrator code rejected." }, { status: 401, headers });
    }
    const response = NextResponse.json({ ok: true }, { headers: { ...headers, "cache-control": "no-store" } });
    response.cookies.set(ADMIN_COOKIE, createAccessSession("admin", 12 * 3_600), {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: 12 * 3_600,
    });
    return response;
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "Administrator access could not be verified." },
      { status: security?.status ?? 400, headers: { ...headers, ...(security?.headers ?? {}) } },
    );
  }
}

