import "server-only";
import { randomBytes } from "node:crypto";
import { get, put } from "@vercel/blob";
import {
  accessCodeHashesMatch,
  hashAccessCode,
  validateAccessCode,
} from "@/lib/access-auth";
import { ApiSecurityError } from "@/lib/api-security";
import {
  MAX_INVITES,
  emptyInviteIndex,
  isInviteGrantCurrent,
  revokeInviteInIndex,
  summarizeInvite,
  validateInviteIndex,
  type InviteIndex,
  type StoredInvite,
} from "@/lib/invite-registry";

const INDEX_PATH = "invites/index.json";

interface InviteIndexRead {
  index: InviteIndex;
  etag: string | null;
}

const globalInviteState = globalThis as typeof globalThis & {
  __hedgentsInviteIndex?: InviteIndex;
};

function emptyIndex(): InviteIndex {
  return emptyInviteIndex();
}

function storageConfigured() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

async function readIndex(options: { useCache?: boolean } = {}): Promise<InviteIndexRead> {
  if (!storageConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new ApiSecurityError("Private invite storage is not configured.", 503);
    }
    globalInviteState.__hedgentsInviteIndex ??= emptyIndex();
    return { index: structuredClone(globalInviteState.__hedgentsInviteIndex), etag: null };
  }
  try {
    const result = await get(INDEX_PATH, { access: "private", useCache: options.useCache ?? false });
    if (!result || result.statusCode !== 200) return { index: emptyIndex(), etag: null };
    const value = await new Response(result.stream).json().catch(() => null);
    return { index: validateInviteIndex(value), etag: result.blob.etag };
  } catch (error) {
    if (error instanceof ApiSecurityError) throw error;
    throw new ApiSecurityError("Private invite storage is temporarily unavailable.", 503);
  }
}

async function writeIndex(index: InviteIndex, etag: string | null) {
  if (!storageConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new ApiSecurityError("Private invite storage is not configured.", 503);
    }
    globalInviteState.__hedgentsInviteIndex = structuredClone(index);
    return;
  }
  try {
    await put(INDEX_PATH, JSON.stringify(index), {
      access: "private",
      contentType: "application/json",
      cacheControlMaxAge: 60,
      addRandomSuffix: false,
      allowOverwrite: Boolean(etag),
      ...(etag ? { ifMatch: etag } : {}),
    });
  } catch {
    throw new ApiSecurityError("Private invite storage is temporarily unavailable.", 503);
  }
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

export async function listInviteCodes() {
  const { index } = await readIndex();
  return index.invites
    .map(summarizeInvite)
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
      revokedAt: null,
      sessionVersion: 1,
    };
    index.invites.unshift(stored);
    return stored;
  });
  return { code, invite: summarizeInvite(invite) };
}

export async function redeemInviteCode(code: unknown) {
  // Local development keeps a deterministic bootstrap code. Production has no
  // environment-hash bypass: every beta session must reference a durable,
  // individually revocable invite grant.
  if (process.env.NODE_ENV !== "production" && validateAccessCode(code, "beta")) {
    return { valid: true, inviteId: "dev", grantVersion: 1 };
  }
  if (typeof code !== "string" || code.length < 8 || code.length > 128) {
    return { valid: false, inviteId: null, grantVersion: null };
  }
  const candidate = hashAccessCode(code.trim());
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { index, etag } = await readIndex();
      const invite = index.invites.find((entry) => entry.active && accessCodeHashesMatch(entry.hash, candidate));
      if (!invite) return { valid: false, inviteId: null, grantVersion: null };
      invite.redemptions += 1;
      invite.lastRedeemedAt = new Date().toISOString();
      await writeIndex(index, etag);
      return { valid: true, inviteId: invite.id, grantVersion: invite.sessionVersion };
    } catch (error) {
      if (attempt === 2) {
        if (error instanceof ApiSecurityError) throw error;
        throw new ApiSecurityError("Private invite storage is temporarily unavailable.", 503);
      }
    }
  }
  throw new ApiSecurityError("Private invite storage is temporarily unavailable.", 503);
}

export async function revokeInviteCode(id: string) {
  if (!/^[A-F0-9]{12}$/.test(id)) throw new ApiSecurityError("Invite identifier is invalid.", 400);
  const invite = await mutateIndex((index) => {
    const revoked = revokeInviteInIndex(index, id, new Date().toISOString());
    if (!revoked) throw new ApiSecurityError("Invite code was not found.", 404);
    return revoked;
  });
  return summarizeInvite(invite);
}

export async function isInviteGrantActive(
  id: string,
  sessionVersion: number,
  options: { useCache?: boolean } = {},
) {
  if (id === "dev") return process.env.NODE_ENV !== "production" && sessionVersion === 1;
  if (!/^[A-F0-9]{12}$/.test(id) || !Number.isSafeInteger(sessionVersion) || sessionVersion < 1) return false;
  const { index } = await readIndex(options);
  return isInviteGrantCurrent(index, id, sessionVersion);
}
