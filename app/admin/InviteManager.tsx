"use client";

import { useCallback, useEffect, useState } from "react";
import type { InviteCodeSummary } from "@/lib/invite-store";
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
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
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
        <div className={styles.inviteTableHead}><span>Identifier</span><span>Created UTC</span><span>Entries</span><span>Last entry UTC</span></div>
        {loading ? <p className={styles.empty}>Loading invite registry…</p> : invites.length ? invites.map((invite) => (
          <div className={styles.inviteRow} key={invite.id}>
            <code>{invite.id}</code>
            <span>{timestamp(invite.createdAt)}</span>
            <strong>{invite.redemptions}</strong>
            <span>{timestamp(invite.lastRedeemedAt)}</span>
          </div>
        )) : <p className={styles.empty}>No panel-generated codes yet. The original deployment invite remains active.</p>}
      </div>
    </section>
  );
}
