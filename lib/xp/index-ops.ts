/**
 * Pure operations on the XP index, split out of the store the same way invite-registry is split
 * from invite-store: the rules that decide whether a link is allowed are the part worth testing,
 * and they should not require blob storage or a server runtime to exercise.
 */
import { WalletLinkError, type VerifiedWalletLink } from "./wallet-link";
import type { XpAward, XpCluster } from "./rules";

/** A consumed nonce only needs to outlive the challenge that created it. */
export const NONCE_RETENTION_HOURS = 24;
export const MAX_WALLETS_PER_GRANT = 5;
export const MAX_AWARD_POINTS = 5_000;

export interface XpWalletLink {
  wallet: string;
  granteeId: string;
  linkedAt: string;
}

export interface XpIndex {
  version: 1;
  links: XpWalletLink[];
  consumedNonces: Array<{ nonce: string; consumedAt: string }>;
  awards: XpAward[];
}

export function emptyXpIndex(): XpIndex {
  return { version: 1, links: [], consumedNonces: [], awards: [] };
}

export function validateXpIndex(value: unknown): XpIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyXpIndex();
  const candidate = value as Partial<XpIndex>;
  if (candidate.version !== 1) return emptyXpIndex();
  return {
    version: 1,
    links: (Array.isArray(candidate.links) ? candidate.links : []).filter(
      (link): link is XpWalletLink => Boolean(
        link && typeof link.wallet === "string" && typeof link.granteeId === "string"
        && typeof link.linkedAt === "string",
      ),
    ),
    consumedNonces: (Array.isArray(candidate.consumedNonces) ? candidate.consumedNonces : []).filter(
      (entry): entry is { nonce: string; consumedAt: string } => Boolean(
        entry && typeof entry.nonce === "string" && typeof entry.consumedAt === "string",
      ),
    ),
    awards: (Array.isArray(candidate.awards) ? candidate.awards : []).filter(
      (award): award is XpAward => Boolean(
        award && typeof award.id === "string" && typeof award.granteeId === "string"
        && Number.isFinite(award.points),
      ),
    ),
  };
}

export function pruneConsumedNonces(index: XpIndex, now: Date) {
  const cutoff = now.getTime() - NONCE_RETENTION_HOURS * 3_600_000;
  index.consumedNonces = index.consumedNonces.filter((entry) => Date.parse(entry.consumedAt) >= cutoff);
}

/**
 * Apply a link that has already had its signature verified, enforcing the two rules that need
 * durable state.
 *
 * Single use: the challenge nonce burns exactly once, so a captured signature cannot be replayed.
 * Sole ownership: a wallet belongs to one grant, because a wallet counted under two invites would
 * have its positions scored twice, which is precisely the attack a future distribution invites.
 */
export function applyWalletLink(index: XpIndex, verified: VerifiedWalletLink, now: Date): XpWalletLink {
  pruneConsumedNonces(index, now);
  if (index.consumedNonces.some((entry) => entry.nonce === verified.nonce)) {
    throw new WalletLinkError("This link challenge has already been used.", 409);
  }
  const existing = index.links.find((link) => link.wallet === verified.wallet);
  if (existing && existing.granteeId !== verified.granteeId) {
    throw new WalletLinkError("This wallet is already linked to another invite.", 409);
  }
  if (!existing) {
    const held = index.links.filter((link) => link.granteeId === verified.granteeId);
    if (held.length >= MAX_WALLETS_PER_GRANT) {
      throw new WalletLinkError(`An invite can link at most ${MAX_WALLETS_PER_GRANT} wallets.`, 409);
    }
  }
  // The nonce burns whether or not a new link was created, so a repeat of the same signature is
  // still refused on the next attempt.
  index.consumedNonces.push({ nonce: verified.nonce, consumedAt: now.toISOString() });
  if (existing) return existing;
  const link: XpWalletLink = {
    wallet: verified.wallet,
    granteeId: verified.granteeId,
    linkedAt: verified.linkedAt,
  };
  index.links.push(link);
  return link;
}

export function applyAward(index: XpIndex, input: {
  id: string;
  granteeId: string;
  cluster: XpCluster;
  points: number;
  reason: string;
  now: Date;
}): XpAward {
  if (!Number.isInteger(input.points) || input.points <= 0 || input.points > MAX_AWARD_POINTS) {
    throw new WalletLinkError(`Award points must be a positive integer up to ${MAX_AWARD_POINTS}.`, 400);
  }
  if (!input.granteeId.trim()) throw new WalletLinkError("An award needs an invite.", 400);
  if (!input.reason.trim()) throw new WalletLinkError("An award needs a stated reason.", 400);
  if (index.awards.some((award) => award.id === input.id)) {
    throw new WalletLinkError("That award has already been recorded.", 409);
  }
  const award: XpAward = {
    id: input.id,
    granteeId: input.granteeId,
    kind: "verified-report",
    cluster: input.cluster,
    points: input.points,
    awardedAt: input.now.toISOString(),
    reason: input.reason.trim(),
  };
  index.awards.push(award);
  return award;
}
