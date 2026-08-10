"use client";

import { useCallback, useEffect, useState } from "react";
import type { InviteCodeSummary } from "@/lib/invite-registry";
import styles from "./admin.module.css";

interface InviteResponse {
  invites?: InviteCodeSummary[];
  code?: string;
  invite?: InviteCodeSummary;
  error?: string;
}

function timestamp(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-GB", { timeZone: "UTC", hour12: false });
}

export function InviteManager() {
  const [invites, setInvites] = useState<InviteCodeSummary[]>([]);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [generatedInviteId, setGeneratedInviteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const loadInvites = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/invites", { cache: "no-store" });
      const payload = (await response.json()) as InviteResponse;
      if (!response.ok) throw new Error(payload.error ?? "Invite codes could not be loaded.");
      setInvites(payload.invites ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invite codes could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadInvites(); }, [loadInvites]);

  async function generate() {
    setGenerating(true);
    setGeneratedCode(null);
    setGeneratedInviteId(null);
    setCopied(false);
    setError("");
    try {
      const response = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const payload = (await response.json()) as InviteResponse;
      if (!response.ok || !payload.code || !payload.invite) {
        throw new Error(payload.error ?? "A new invite could not be generated.");
      }
      setGeneratedCode(payload.code);
      setGeneratedInviteId(payload.invite.id);
      setInvites((current) => [payload.invite as InviteCodeSummary, ...current]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A new invite could not be generated.");
    } finally {
      setGenerating(false);
    }
  }

  async function copyCode() {
    if (!generatedCode) return;
    await navigator.clipboard.writeText(generatedCode);
    setCopied(true);
  }

  async function revoke(invite: InviteCodeSummary) {
    if (!invite.active || revokingId) return;
    if (!window.confirm(`Revoke invite ${invite.id}? Trading stops immediately; read-only access expires within one minute.`)) return;
    setRevokingId(invite.id);
    setError("");
    try {
      const response = await fetch("/api/admin/invites", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: invite.id }),
      });
      const payload = (await response.json()) as InviteResponse;
      if (!response.ok || !payload.invite) {
        throw new Error(payload.error ?? "The invite could not be revoked.");
      }
      const durableInvite = payload.invite;
      // Reflect only the durable record returned by the server. A failed write
      // never changes the row to a misleading revoked state.
      setInvites((current) => current.map((entry) => (
        entry.id === durableInvite.id ? durableInvite : entry
      )));
      if (generatedInviteId === durableInvite.id) {
        setGeneratedCode(null);
        setGeneratedInviteId(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invite could not be revoked.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className={styles.invitePanel} aria-labelledby="invite-manager-title" id="beta-invitations">
      <div className={styles.inviteHeader}>
        <div>
          <p className={styles.kicker}>Access / invite registry</p>
          <h2 id="invite-manager-title">Beta invitations</h2>
          <p>Generate a new code for a tester. Its plaintext is shown once; only the hash is retained.</p>
        </div>
        <button className={styles.generateButton} type="button" onClick={generate} disabled={generating}>
          {generating ? "Generating…" : "Generate invite"}
        </button>
      </div>
      {generatedCode ? (
        <div className={styles.generatedInvite} role="status">
          <div><span>New invite — copy it now</span><code data-testid="generated-invite-code">{generatedCode}</code></div>
          <button type="button" onClick={() => void copyCode()}>{copied ? "Copied" : "Copy code"}</button>
        </div>
      ) : null}
      {error ? <p className={styles.inviteError} role="alert">{error}</p> : null}
      <div className={styles.inviteTable}>
        <div className={styles.inviteTableHead}><span>Identifier</span><span>Status</span><span>Created UTC</span><span>Entries</span><span>Last entry UTC</span><span>Action</span></div>
        {loading ? <p className={styles.empty}>Loading invite registry…</p> : invites.length ? invites.map((invite) => (
          <div className={styles.inviteRow} key={invite.id}>
            <code>{invite.id}</code>
            <span className={invite.active ? styles.inviteActive : styles.inviteRevoked} title={invite.revokedAt ? `Revoked ${timestamp(invite.revokedAt)} UTC` : undefined}>
              {invite.active ? "Active" : "Revoked"}
            </span>
            <span>{timestamp(invite.createdAt)}</span>
            <strong>{invite.redemptions}</strong>
            <span>{timestamp(invite.lastRedeemedAt)}</span>
            <button
              className={styles.revokeButton}
              type="button"
              disabled={!invite.active || revokingId !== null}
              onClick={() => void revoke(invite)}
            >
              {revokingId === invite.id ? "Revoking…" : invite.active ? "Revoke" : "Revoked"}
            </button>
          </div>
        )) : <p className={styles.empty}>No invite grants have been generated yet.</p>}
      </div>
    </section>
  );
}
