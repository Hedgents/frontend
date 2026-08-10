import { createHmac, timingSafeEqual } from "node:crypto";

export class SignedTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignedTokenError";
  }
}

function signature(namespace: string, encodedClaims: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`${namespace}.${encodedClaims}`)
    .digest("base64url");
}

export function createSignedToken<T extends object>(
  namespace: string,
  claims: T,
  secret: string,
) {
  if (!secret) throw new SignedTokenError("A signing secret is required.");
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${encodedClaims}.${signature(namespace, encodedClaims, secret)}`;
}

export function verifySignedToken<T extends object>(
  namespace: string,
  value: unknown,
  secret: string,
): T {
  if (typeof value !== "string" || value.length < 40 || value.length > 4_096) {
    throw new SignedTokenError("The signed token is missing or malformed.");
  }
  const [encodedClaims, suppliedSignature, extra] = value.split(".");
  if (!encodedClaims || !suppliedSignature || extra) {
    throw new SignedTokenError("The signed token is malformed.");
  }
  const expected = Buffer.from(signature(namespace, encodedClaims, secret));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new SignedTokenError("The signed token could not be authenticated.");
  }
  try {
    const claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8"));
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) throw new Error();
    return claims as T;
  } catch {
    throw new SignedTokenError("The signed token is malformed.");
  }
}
