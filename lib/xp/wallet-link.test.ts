import assert from "node:assert/strict";
import test from "node:test";
import { getAddressDecoder, getBase58Decoder } from "@solana/kit";
import {
  assertWalletAddress,
  createWalletLinkChallenge,
  verifyWalletLinkAttempt,
  walletLinkMessage,
  WALLET_LINK_DOMAIN,
  WalletLinkError,
} from "./wallet-link";

process.env.HEDGENTS_XP_LINK_SECRET = "test-link-secret-that-is-long-enough-000000";

const addressDecoder = getAddressDecoder();
const base58Decoder = getBase58Decoder();

async function wallet() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    address: String(addressDecoder.decode(raw)),
    sign: async (message: string) => {
      const signature = new Uint8Array(await crypto.subtle.sign(
        { name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(message),
      ));
      return String(base58Decoder.decode(signature));
    },
  };
}

async function attemptFor(granteeId: string) {
  const holder = await wallet();
  const challenge = createWalletLinkChallenge({ granteeId, wallet: holder.address });
  return {
    holder,
    challenge,
    attempt: {
      granteeId,
      wallet: holder.address,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      proof: challenge.proof,
      signature: await holder.sign(challenge.message),
    },
  };
}

test("a genuine signature over the issued challenge links the wallet", async () => {
  const { attempt, holder } = await attemptFor("invite-1");
  const linked = await verifyWalletLinkAttempt(attempt);
  assert.equal(linked.granteeId, "invite-1");
  assert.equal(linked.wallet, holder.address);
});

test("the signed message says what it does and authorises nothing", async () => {
  const { challenge } = await attemptFor("invite-1");
  assert.match(challenge.message, /authorises no transaction/);
  assert.match(challenge.message, /moves no funds/);
  assert.match(challenge.message, /grants no/);
  // Domain separation: a signature made for another app or purpose must not verify here.
  assert.ok(challenge.message.includes(WALLET_LINK_DOMAIN));
});

test("a signature obtained for one invite cannot be replayed under another", async () => {
  const { attempt } = await attemptFor("invite-1");
  await assert.rejects(
    () => verifyWalletLinkAttempt({ ...attempt, granteeId: "invite-2" }),
    (error: WalletLinkError) => /not issued by Hedgents|altered/.test(error.message),
  );
});

test("a signature cannot be presented for a different wallet", async () => {
  const { attempt } = await attemptFor("invite-1");
  const other = await wallet();
  await assert.rejects(
    () => verifyWalletLinkAttempt({ ...attempt, wallet: other.address }),
    (error: WalletLinkError) => /not issued by Hedgents|altered/.test(error.message),
  );
});

test("a forged challenge without the server HMAC is refused", async () => {
  const holder = await wallet();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const message = walletLinkMessage({
    granteeId: "invite-1", wallet: holder.address, nonce: "11111111-1111-1111-1111-111111111111", expiresAt,
  });
  const signature = await holder.sign(message);
  await assert.rejects(
    () => verifyWalletLinkAttempt({
      granteeId: "invite-1", wallet: holder.address, nonce: "11111111-1111-1111-1111-111111111111",
      expiresAt, proof: "not-a-real-proof", signature,
    }),
    (error: WalletLinkError) => /not issued by Hedgents|altered/.test(error.message),
  );
});

test("an expired challenge is refused even with a valid signature", async () => {
  const { attempt } = await attemptFor("invite-1");
  const later = new Date(Date.parse(attempt.expiresAt) + 1_000);
  await assert.rejects(
    () => verifyWalletLinkAttempt(attempt, { now: later }),
    (error: WalletLinkError) => error.status === 410 && /expired/.test(error.message),
  );
});

test("a signature over different bytes does not verify", async () => {
  const { attempt, holder } = await attemptFor("invite-1");
  const wrong = await holder.sign("some other message entirely");
  await assert.rejects(
    () => verifyWalletLinkAttempt({ ...attempt, signature: wrong }),
    (error: WalletLinkError) => error.status === 401 && /does not match/.test(error.message),
  );
});

test("another wallet's signature over the same message does not verify", async () => {
  const { attempt, challenge } = await attemptFor("invite-1");
  const impostor = await wallet();
  const impostorSignature = await impostor.sign(challenge.message);
  await assert.rejects(
    () => verifyWalletLinkAttempt({ ...attempt, signature: impostorSignature }),
    (error: WalletLinkError) => error.status === 401 && /does not match/.test(error.message),
  );
});

test("malformed input is rejected before any crypto runs", async () => {
  const { attempt } = await attemptFor("invite-1");
  const cases: Array<[string, Record<string, unknown>]> = [
    ["no grant", { granteeId: "" }],
    ["bad wallet", { wallet: "not-an-address" }],
    ["bad nonce", { nonce: "nope" }],
    ["bad expiry", { expiresAt: "whenever" }],
    ["no signature", { signature: "" }],
    ["short signature", { signature: "1111" }],
  ];
  for (const [label, override] of cases) {
    await assert.rejects(
      () => verifyWalletLinkAttempt({ ...attempt, ...override } as typeof attempt),
      (error: unknown) => error instanceof WalletLinkError,
      label,
    );
  }
});

test("address validation catches shape, and the signature catches everything else", async () => {
  // A program-derived address is a full 32 bytes and WebCrypto will import it happily, so the
  // length check cannot distinguish it from a real wallet. It does not need to: an off-curve
  // address has no private key, so it can never produce a signature that verifies, and the
  // signature check below is what actually refuses it. Asserting that here rather than pretending
  // the cheap check does the work.
  assert.doesNotThrow(() => assertWalletAddress("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"));
  assert.throws(() => assertWalletAddress(""), WalletLinkError);
  assert.throws(() => assertWalletAddress(null), WalletLinkError);
  assert.throws(() => assertWalletAddress("tooshort"), WalletLinkError);

  const pda = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  const challenge = createWalletLinkChallenge({ granteeId: "invite-1", wallet: pda });
  const impostor = await wallet();
  const signature = await impostor.sign(challenge.message);
  await assert.rejects(
    () => verifyWalletLinkAttempt({
      granteeId: "invite-1", wallet: pda, nonce: challenge.nonce,
      expiresAt: challenge.expiresAt, proof: challenge.proof, signature,
    }),
    (error: WalletLinkError) => error.status === 401 && /does not match/.test(error.message),
  );
});

test("linking is unavailable rather than insecure when the secret is missing", async () => {
  const previous = process.env.HEDGENTS_XP_LINK_SECRET;
  const previousAuth = process.env.HEDGENTS_AUTH_SECRET;
  try {
    delete process.env.HEDGENTS_XP_LINK_SECRET;
    delete process.env.HEDGENTS_AUTH_SECRET;
    assert.throws(
      () => createWalletLinkChallenge({ granteeId: "invite-1", wallet: "11111111111111111111111111111112" }),
      (error: WalletLinkError) => error.status === 503,
    );
  } finally {
    if (previous !== undefined) process.env.HEDGENTS_XP_LINK_SECRET = previous;
    if (previousAuth !== undefined) process.env.HEDGENTS_AUTH_SECRET = previousAuth;
  }
});
