import "server-only";
import { get, put } from "@vercel/blob";
import { ApiSecurityError } from "@/lib/api-security";
import { verifyWalletLinkAttempt, type WalletLinkAttempt } from "./wallet-link";
import {
  applyAward,
  applyWalletLink,
  emptyXpIndex,
  validateXpIndex,
  type XpIndex,
} from "./index-ops";
import type { XpCluster } from "./rules";

/**
 * Durable state for tester XP, and deliberately only the parts that cannot be derived.
 *
 *   - wallet links, which are the only way to connect chain activity to an invite
 *   - consumed challenge nonces, so a link signature works exactly once
 *   - operator awards, which have no on-chain trace
 *
 * There is no XP balance here. Everything else is recomputed from the chain on read, so a bug in
 * this file can lose a link but can never mint a score. The rules that decide whether a link is
 * allowed live in index-ops so they can be tested without a server runtime.
 */
const INDEX_PATH = "xp/index.json";

const globalXpState = globalThis as typeof globalThis & { __hedgentsXpIndex?: XpIndex };

function storageConfigured() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

async function readIndex(): Promise<{ index: XpIndex; etag: string | null }> {
  if (!storageConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new ApiSecurityError("Private XP storage is not configured.", 503);
    }
    globalXpState.__hedgentsXpIndex ??= emptyXpIndex();
    return { index: structuredClone(globalXpState.__hedgentsXpIndex), etag: null };
  }
  try {
    const result = await get(INDEX_PATH, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return { index: emptyXpIndex(), etag: null };
    const value = await new Response(result.stream).json().catch(() => null);
    return { index: validateXpIndex(value), etag: result.blob.etag };
  } catch (error) {
    if (error instanceof ApiSecurityError) throw error;
    throw new ApiSecurityError("Private XP storage is temporarily unavailable.", 503);
  }
}

async function writeIndex(index: XpIndex, etag: string | null) {
  if (!storageConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new ApiSecurityError("Private XP storage is not configured.", 503);
    }
    globalXpState.__hedgentsXpIndex = structuredClone(index);
    return;
  }
  try {
    await put(INDEX_PATH, JSON.stringify(index), {
      access: "private",
      contentType: "application/json",
      cacheControlMaxAge: 0,
      addRandomSuffix: false,
      allowOverwrite: Boolean(etag),
      ...(etag ? { ifMatch: etag } : {}),
    });
  } catch {
    throw new ApiSecurityError("Private XP storage is temporarily unavailable.", 503);
  }
}

/**
 * Read, mutate, write with the etag we read. A concurrent writer wins and we retry against fresh
 * state, which is what stops two simultaneous link attempts both passing the single-use check.
 */
async function mutateIndex<T>(mutation: (index: XpIndex) => T): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { index, etag } = await readIndex();
    const result = mutation(index);
    try {
      await writeIndex(index, etag);
      return result;
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
  }
  throw lastError;
}

export async function linkWallet(attempt: WalletLinkAttempt, options: { now?: Date } = {}) {
  const now = options.now ?? new Date();
  const verified = await verifyWalletLinkAttempt(attempt, { now });
  return mutateIndex((index) => applyWalletLink(index, verified, now));
}

export async function listLinkedWallets(granteeId: string) {
  const { index } = await readIndex();
  return index.links.filter((link) => link.granteeId === granteeId);
}

export async function listAwards(granteeId: string) {
  const { index } = await readIndex();
  return index.awards.filter((award) => award.granteeId === granteeId);
}

/** Operator-awarded, for contributions with no on-chain trace such as a reproduced defect. */
export async function recordAward(input: {
  id: string;
  granteeId: string;
  cluster: XpCluster;
  points: number;
  reason: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return mutateIndex((index) => applyAward(index, { ...input, now }));
}

/** Whole-index read for the operator analytics view. Never exposed to a tester-facing route. */
export async function readXpIndexForAnalytics() {
  const { index } = await readIndex();
  return index;
}

export function resetXpStoreForTests() {
  if (process.env.NODE_ENV === "production") throw new Error("Cannot reset XP state in production.");
  globalXpState.__hedgentsXpIndex = undefined;
}
