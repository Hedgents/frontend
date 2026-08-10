export const MAX_INVITES = 250;

export interface StoredInvite {
  id: string;
  hash: string;
  createdAt: string;
  redemptions: number;
  lastRedeemedAt: string | null;
  active: boolean;
  revokedAt: string | null;
  sessionVersion: number;
}

export interface InviteIndex {
  version: 2;
  invites: StoredInvite[];
}

export interface InviteCodeSummary {
  id: string;
  createdAt: string;
  redemptions: number;
  lastRedeemedAt: string | null;
  active: boolean;
  revokedAt: string | null;
  sessionVersion: number;
}

interface LegacyStoredInvite {
  id: string;
  hash: string;
  createdAt: string;
  redemptions: number;
  lastRedeemedAt: string | null;
  active: boolean;
}

export function emptyInviteIndex(): InviteIndex {
  return { version: 2, invites: [] };
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateBaseInvite(entry: unknown): LegacyStoredInvite {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("Invite entry is malformed.");
  }
  const record = entry as Partial<LegacyStoredInvite>;
  if (
    typeof record.id !== "string" || !/^[A-F0-9]{12}$/.test(record.id)
    || typeof record.hash !== "string" || !/^[a-f0-9]{64}$/.test(record.hash)
    || !validTimestamp(record.createdAt)
    || !Number.isSafeInteger(record.redemptions) || Number(record.redemptions) < 0
    || (record.lastRedeemedAt !== null && !validTimestamp(record.lastRedeemedAt))
    || typeof record.active !== "boolean"
  ) {
    throw new Error("Invite entry failed integrity validation.");
  }
  return record as LegacyStoredInvite;
}

export function validateInviteIndex(value: unknown): InviteIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invite index is malformed.");
  }
  const candidate = value as { version?: unknown; invites?: unknown };
  if ((candidate.version !== 1 && candidate.version !== 2)
    || !Array.isArray(candidate.invites)
    || candidate.invites.length > MAX_INVITES) {
    throw new Error("Invite index version or size is invalid.");
  }

  const ids = new Set<string>();
  const hashes = new Set<string>();
  const invites = candidate.invites.map((entry) => {
    const base = validateBaseInvite(entry);
    if (ids.has(base.id) || hashes.has(base.hash)) {
      throw new Error("Invite entry failed integrity validation.");
    }
    ids.add(base.id);
    hashes.add(base.hash);

    if (candidate.version === 1) {
      return {
        ...base,
        // A legacy inactive entry has no trustworthy revocation timestamp. The
        // migration records creation as the earliest durable boundary instead
        // of inventing a later time.
        revokedAt: base.active ? null : base.createdAt,
        sessionVersion: base.active ? 1 : 2,
      } satisfies StoredInvite;
    }

    const record = entry as Partial<StoredInvite>;
    if (
      (record.revokedAt !== null && !validTimestamp(record.revokedAt))
      || !Number.isSafeInteger(record.sessionVersion)
      || Number(record.sessionVersion) < 1
      || Number(record.sessionVersion) >= Number.MAX_SAFE_INTEGER
      || (base.active && record.revokedAt !== null)
      || (!base.active && record.revokedAt === null)
    ) {
      throw new Error("Invite entry failed v2 integrity validation.");
    }
    return {
      ...base,
      revokedAt: record.revokedAt as string | null,
      sessionVersion: Number(record.sessionVersion),
    };
  });
  return { version: 2, invites };
}

export function summarizeInvite(invite: StoredInvite): InviteCodeSummary {
  return {
    id: invite.id,
    createdAt: invite.createdAt,
    redemptions: invite.redemptions,
    lastRedeemedAt: invite.lastRedeemedAt,
    active: invite.active,
    revokedAt: invite.revokedAt,
    sessionVersion: invite.sessionVersion,
  };
}

export function revokeInviteInIndex(index: InviteIndex, id: string, revokedAt: string) {
  if (!/^[A-F0-9]{12}$/.test(id) || !validTimestamp(revokedAt)) return null;
  const invite = index.invites.find((entry) => entry.id === id);
  if (!invite) return null;
  if (invite.active) {
    invite.active = false;
    invite.revokedAt = revokedAt;
    invite.sessionVersion += 1;
  }
  return invite;
}

export function isInviteGrantCurrent(index: InviteIndex, id: string, sessionVersion: number) {
  if (!/^[A-F0-9]{12}$/.test(id) || !Number.isSafeInteger(sessionVersion) || sessionVersion < 1) return false;
  const invite = index.invites.find((entry) => entry.id === id);
  return Boolean(invite?.active && invite.sessionVersion === sessionVersion);
}
