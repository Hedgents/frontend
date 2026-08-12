/**
 * Binding a Solana wallet to an invite grant, by proof of wallet control.
 *
 * XP is keyed to the grant so that ten wallets is still one tester, but staking happens client-side
 * straight to the chain and the server never witnesses it. Something has to connect the two, and it
 * has to be a proof rather than a claim, because a tester who simply asserts "this wallet is mine"
 * could claim any wallet's positions and, with them, its record.
 *
 * The scheme: the server issues an HMAC-signed challenge naming the grant, the wallet, a nonce and
 * an expiry. The tester signs the exact canonical message with the wallet. The server re-derives the
 * message, checks its own HMAC, checks expiry, checks the nonce has not been used, and verifies the
 * Ed25519 signature against the claimed address. Only then is the link recorded.
 *
 * Nothing here is stateless-only. Single use genuinely requires state, so the store holds consumed
 * nonces and established links, and nothing else.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getBase58Encoder } from "@solana/kit";

const base58Encoder = getBase58Encoder();

/**
 * Domain separation. A signature produced for another application, or for a different purpose in
 * this one, must not verify here, so the purpose is inside the signed bytes.
 */
export const WALLET_LINK_DOMAIN = "hedgents.xp.wallet-link.v1";
export const CHALLENGE_TTL_SECONDS = 600;

export class WalletLinkError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface WalletLinkChallenge {
  granteeId: string;
  wallet: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  /** HMAC over the canonical message, proving the server issued this exact challenge. */
  proof: string;
  /** The exact bytes the wallet must sign. Nothing else is accepted. */
  message: string;
}

function linkSecret() {
  const secret = process.env.HEDGENTS_XP_LINK_SECRET?.trim()
    ?? process.env.HEDGENTS_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new WalletLinkError("Wallet linking is not configured.", 503);
  }
  return secret;
}

export function assertWalletAddress(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    throw new WalletLinkError("A valid Solana wallet address is required.");
  }
  let decoded: Uint8Array;
  try {
    decoded = new Uint8Array(base58Encoder.encode(value));
  } catch {
    throw new WalletLinkError("A valid Solana wallet address is required.");
  }
  // An Ed25519 public key is exactly 32 bytes. A program-derived address is not a signer and could
  // never produce a signature, so refusing anything else here is the honest failure.
  if (decoded.length !== 32) throw new WalletLinkError("A valid Solana wallet address is required.");
  return value;
}

/**
 * The canonical message. It is rebuilt from parts on both issue and verify, so a tester cannot get
 * a signature over one set of facts and present it as another. Every field that matters is in it.
 */
export function walletLinkMessage(input: {
  granteeId: string;
  wallet: string;
  nonce: string;
  expiresAt: string;
}) {
  return [
    "Hedgents tester wallet link",
    "",
    "Signing this proves you control this wallet so your test activity can be recorded",
    "against your invite. It authorises no transaction, moves no funds, and grants no",
    "spending permission.",
    "",
    `domain: ${WALLET_LINK_DOMAIN}`,
    `invite: ${input.granteeId}`,
    `wallet: ${input.wallet}`,
    `nonce: ${input.nonce}`,
    `expires: ${input.expiresAt}`,
  ].join("\n");
}

function proofFor(message: string) {
  return createHmac("sha256", linkSecret()).update(message).digest("base64url");
}

function proofMatches(message: string, proof: unknown) {
  if (typeof proof !== "string") return false;
  const expected = Buffer.from(proofFor(message));
  const provided = Buffer.from(proof);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function createWalletLinkChallenge(input: {
  granteeId: string;
  wallet: string;
  now?: Date;
}): WalletLinkChallenge {
  if (typeof input.granteeId !== "string" || !input.granteeId.trim()) {
    throw new WalletLinkError("An invite grant is required.", 401);
  }
  const wallet = assertWalletAddress(input.wallet);
  const now = input.now ?? new Date();
  const nonce = randomUUID();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1_000).toISOString();
  const message = walletLinkMessage({ granteeId: input.granteeId, wallet, nonce, expiresAt });
  return {
    granteeId: input.granteeId,
    wallet,
    nonce,
    issuedAt: now.toISOString(),
    expiresAt,
    proof: proofFor(message),
    message,
  };
}

export interface WalletLinkAttempt {
  granteeId: string;
  wallet: string;
  nonce: string;
  expiresAt: string;
  proof: string;
  /** base58, as wallets return it. */
  signature: string;
}

export interface VerifiedWalletLink {
  granteeId: string;
  wallet: string;
  nonce: string;
  linkedAt: string;
}

async function verifyEd25519(wallet: string, message: string, signature: string) {
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = new Uint8Array(base58Encoder.encode(signature));
  } catch {
    throw new WalletLinkError("The signature is malformed.");
  }
  if (signatureBytes.length !== 64) throw new WalletLinkError("The signature is malformed.");
  // Copied into a fresh buffer because WebCrypto requires an ArrayBuffer-backed view.
  const publicKeyBytes = Uint8Array.from(base58Encoder.encode(wallet));
  const key = await crypto.subtle.importKey(
    "raw", publicKeyBytes.buffer as ArrayBuffer, { name: "Ed25519" }, false, ["verify"],
  );
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    Uint8Array.from(signatureBytes).buffer as ArrayBuffer,
    new TextEncoder().encode(message) as unknown as ArrayBufferView<ArrayBuffer>,
  );
}

/**
 * Verify an attempt in isolation. Replay and ownership conflicts are enforced by the caller against
 * the store, because those need durable state; everything checkable from the attempt alone is here.
 */
export async function verifyWalletLinkAttempt(
  attempt: WalletLinkAttempt,
  options: { now?: Date } = {},
): Promise<VerifiedWalletLink> {
  if (typeof attempt.granteeId !== "string" || !attempt.granteeId.trim()) {
    throw new WalletLinkError("An invite grant is required.", 401);
  }
  const wallet = assertWalletAddress(attempt.wallet);
  if (typeof attempt.nonce !== "string" || !/^[0-9a-f-]{36}$/.test(attempt.nonce)) {
    throw new WalletLinkError("The challenge nonce is malformed.");
  }
  if (typeof attempt.expiresAt !== "string" || !Number.isFinite(Date.parse(attempt.expiresAt))) {
    throw new WalletLinkError("The challenge expiry is malformed.");
  }

  // Rebuilt from the attempt's own fields, so a signature obtained for one grant cannot be replayed
  // under another: changing any field changes the message, which fails the HMAC below.
  const message = walletLinkMessage({
    granteeId: attempt.granteeId,
    wallet,
    nonce: attempt.nonce,
    expiresAt: attempt.expiresAt,
  });
  if (!proofMatches(message, attempt.proof)) {
    throw new WalletLinkError("This challenge was not issued by Hedgents, or it has been altered.");
  }

  const now = options.now ?? new Date();
  if (Date.parse(attempt.expiresAt) <= now.getTime()) {
    throw new WalletLinkError("The challenge has expired. Request a new one.", 410);
  }

  if (typeof attempt.signature !== "string" || !attempt.signature.trim()) {
    throw new WalletLinkError("A wallet signature is required.");
  }
  const valid = await verifyEd25519(wallet, message, attempt.signature);
  if (!valid) throw new WalletLinkError("The signature does not match this wallet.", 401);

  return { granteeId: attempt.granteeId, wallet, nonce: attempt.nonce, linkedAt: now.toISOString() };
}
