import { NextResponse } from "next/server";
import { ADMIN_COOKIE, BETA_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/access-auth";
import { apiSecurityError, secureMutation } from "@/lib/api-security";

export async function POST(request: Request) {
  try {
    const headers = secureMutation(request, { key: "auth-logout", limit: 20, windowMs: 60_000 }, 128).headers;
    const response = NextResponse.json({ ok: true }, { headers });
    response.cookies.set(BETA_COOKIE, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    response.cookies.set(ADMIN_COOKIE, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    return response;
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: security?.message ?? "Could not end the session." },
      { status: security?.status ?? 400, headers: security?.headers },
    );
  }
}

