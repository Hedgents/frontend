import "server-only";
import { get, put } from "@vercel/blob";
import { ApiSecurityError } from "@/lib/api-security";
import { verifyWalletLinkAttempt, type WalletLinkAttempt } from "./wallet-link";
import {
  applyAward,
  applyWalletLink,
  emptyXpIndex,
  readXpIndex,
  type XpIndex,
} from "./index-ops";
import type { XpCluster } from "./rules";
import { strongEtag } from "@/lib/blob-etag";

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
    // No object yet. An empty index with a null etag is correct here, and writeIndex will refuse to
    // overwrite if one appears in the meantime.
    if (!result || result.statusCode !== 200) return { index: emptyXpIndex(), etag: null };
    const value = await new Response(result.stream).json().catch(() => null);
    const report = readXpIndex(value);
    // An object EXISTS and we could not read it. Returning an empty index with its live etag would
    // hand the caller a valid write token for state it never saw: the next wallet link would apply
    // to nothing, ifMatch would succeed, and every link and award would be replaced by that single
    // entry. One unparseable byte would silently destroy the whole index. Refuse instead. Recovery
    // is a human restoring from xp/backups/, not a write that papers over the damage.
    if (report.unreadable) {
      throw new ApiSecurityError(
        "The stored XP index could not be read. Refusing to write over it; restore from a backup.",
        503,
      );
    }
    if (report.dropped > 0) {
      throw new ApiSecurityError(
        `The stored XP index has ${report.dropped} unreadable entr${report.dropped === 1 ? "y" : "ies"}.`
          + " Refusing to write, which would drop them permanently.",
        503,
      );
    }
    return { index: report.index, etag: strongEtag(result.blob.etag) };
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
    // Snapshot what is about to be replaced, before replacing it. A schedule would be wrong in both
    // directions here: it runs on days nothing changed, and it still misses whatever happened
    // between two runs. There is nothing to preserve when etag is null, because no stored object
    // exists yet.
    if (etag) await snapshotBeforeWrite(index);
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

const BACKUP_PREFIX = "xp/backups/index-";

/**
 * Preserve the current index before a mutation replaces it, at most once a day.
 *
 * The live index is a single object overwritten in place, with no version history to fall back on.
 * Wallet links are the one thing here that cannot be recomputed from chain: lose them and every
 * tester has to sign again, a cost that grows with each person who joins.
 *
 * `allowOverwrite: false` does the work. The first mutation of a day writes that day's snapshot and
 * every later one silently fails the write, which is the intended outcome rather than an error. So
 * the snapshot always holds the state as it was before the day's changes, and the object count
 * grows with days-on-which-something-happened rather than with days.
 *
 * Best effort on purpose. Refusing to link a wallet because a backup could not be written would
 * trade a certain failure for an unlikely one, and the mutation it guards can only append.
 */
async function snapshotBeforeWrite(index: XpIndex, now = new Date()) {
  if (!storageConfigured()) return;
  const day = now.toISOString().slice(0, 10);
  try {
    await put(`${BACKUP_PREFIX}${day}.json`, JSON.stringify(index), {
      access: "private",
      contentType: "application/json",
      cacheControlMaxAge: 0,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  } catch {
    // Already written today, or transiently unwritable. Neither should block the mutation.
  }
}

export function resetXpStoreForTests() {
  if (process.env.NODE_ENV === "production") throw new Error("Cannot reset XP state in production.");
  globalXpState.__hedgentsXpIndex = undefined;
}
