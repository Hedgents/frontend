import "server-only";
import { randomBytes } from "node:crypto";
import { get, put } from "@vercel/blob";
import {
  accessCodeHashesMatch,
  hashAccessCode,
  validateAccessCode,
} from "@/lib/access-auth";
import { ApiSecurityError } from "@/lib/api-security";

const INDEX_PATH = "invites/index.json";
const MAX_INVITES = 250;

interface StoredInvite {
  id: string;
  hash: string;
  createdAt: string;
  redemptions: number;
  lastRedeemedAt: string | null;
  active: boolean;
}

interface InviteIndex {
  version: 1;
  invites: StoredInvite[];
}

export interface InviteCodeSummary {
  id: string;
  createdAt: string;
  redemptions: number;
  lastRedeemedAt: string | null;
  active: boolean;
}

interface InviteIndexRead {
  index: InviteIndex;
  etag: string | null;
}

const globalInviteState = globalThis as typeof globalThis & {
  __hedgentsInviteIndex?: InviteIndex;
};

function emptyIndex(): InviteIndex {
  return { version: 1, invites: [] };
}

function storageConfigured() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

function validateIndex(value: unknown): InviteIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invite index is malformed.");
  const candidate = value as { version?: unknown; invites?: unknown };
  if (candidate.version !== 1 || !Array.isArray(candidate.invites) || candidate.invites.length > MAX_INVITES) {
    throw new Error("Invite index version or size is invalid.");
  }
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const invites = candidate.invites.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invite entry is malformed.");
    const record = entry as Partial<StoredInvite>;
    if (
      typeof record.id !== "string" || !/^[A-F0-9]{12}$/.test(record.id)
      || typeof record.hash !== "string" || !/^[a-f0-9]{64}$/.test(record.hash)
      || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))
      || !Number.isSafeInteger(record.redemptions) || Number(record.redemptions) < 0
      || (record.lastRedeemedAt !== null && (typeof record.lastRedeemedAt !== "string" || !Number.isFinite(Date.parse(record.lastRedeemedAt))))
      || typeof record.active !== "boolean"
      || ids.has(record.id) || hashes.has(record.hash)
    ) {
      throw new Error("Invite entry failed integrity validation.");
    }
    ids.add(record.id);
    hashes.add(record.hash);
    return record as StoredInvite;
  });
  return { version: 1, invites };
}

async function readIndex(): Promise<InviteIndexRead> {
  if (!storageConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new ApiSecurityError("Private invite storage is not configured.", 503);
    }
    globalInviteState.__hedgentsInviteIndex ??= emptyIndex();
    return { index: structuredClone(globalInviteState.__hedgentsInviteIndex), etag: null };
  }
  const result = await get(INDEX_PATH, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return { index: emptyIndex(), etag: null };
  const value = await new Response(result.stream).json().catch(() => null);
  return { index: validateIndex(value), etag: result.blob.etag };
}

async function writeIndex(index: InviteIndex, etag: string | null) {
  if (!storageConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new ApiSecurityError("Private invite storage is not configured.", 503);
    }
    globalInviteState.__hedgentsInviteIndex = structuredClone(index);
    return;
  }
  await put(INDEX_PATH, JSON.stringify(index), {
    access: "private",
    contentType: "application/json",
    cacheControlMaxAge: 60,
    addRandomSuffix: false,
    allowOverwrite: Boolean(etag),
    ...(etag ? { ifMatch: etag } : {}),
  });
}

async function mutateIndex<T>(mutation: (index: InviteIndex) => T): Promise<T> {
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

function summary(invite: StoredInvite): InviteCodeSummary {
  return {
    id: invite.id,
    createdAt: invite.createdAt,
    redemptions: invite.redemptions,
    lastRedeemedAt: invite.lastRedeemedAt,
    active: invite.active,
  };
}

export async function listInviteCodes() {
  const { index } = await readIndex();
  return index.invites
    .map(summary)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export async function createInviteCode() {
  const code = `HG-BETA-${randomBytes(8).toString("hex").toUpperCase()}`;
  const hash = hashAccessCode(code);
  const createdAt = new Date().toISOString();
  const invite = await mutateIndex((index) => {
    if (index.invites.length >= MAX_INVITES) {
      throw new ApiSecurityError(`The ${MAX_INVITES}-code beta limit has been reached.`, 409);
    }
    const stored: StoredInvite = {
      id: hash.slice(0, 12).toUpperCase(),
      hash,
      createdAt,
      redemptions: 0,
      lastRedeemedAt: null,
      active: true,
    };
    index.invites.unshift(stored);
    return stored;
  });
  return { code, invite: summary(invite) };
}

export async function redeemInviteCode(code: unknown) {
  if (validateAccessCode(code, "beta")) return { valid: true, inviteId: "legacy" };
  if (typeof code !== "string" || code.length < 8 || code.length > 128) {
    return { valid: false, inviteId: null };
  }
  const candidate = hashAccessCode(code.trim());
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { index, etag } = await readIndex();
      const invite = index.invites.find((entry) => entry.active && accessCodeHashesMatch(entry.hash, candidate));
      if (!invite) return { valid: false, inviteId: null };
      invite.redemptions += 1;
      invite.lastRedeemedAt = new Date().toISOString();
      await writeIndex(index, etag);
      return { valid: true, inviteId: invite.id };
    } catch {
      if (attempt === 2) return { valid: false, inviteId: null };
    }
  }
  return { valid: false, inviteId: null };
}
