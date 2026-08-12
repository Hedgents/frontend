"use client";

import { useCallback, useEffect, useState } from "react";
import type { XpAnalytics } from "@/lib/xp/analytics";
import styles from "./admin.module.css";

/**
 * Operator view of the tester programme.
 *
 * Leads with the drop-off rather than the leaderboard. A ranking shows the handful of people who
 * were always going to engage; what tells you whether the programme works is how many linked a
 * wallet and then never held a position, and whether anyone came back for a second round.
 */
export function XpManager() {
  const [data, setData] = useState<XpAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [awarding, setAwarding] = useState(false);
  const [granteeId, setGranteeId] = useState("");
  const [points, setPoints] = useState("500");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/xp/analytics?limit=50", { cache: "no-store" });
      const payload = (await response.json()) as XpAnalytics & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "XP analytics are unavailable.");
      setData(payload);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "XP analytics are unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function award(event: React.FormEvent) {
    event.preventDefault();
    setAwarding(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/xp/award", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ granteeId: granteeId.trim(), points: Number(points), reason: reason.trim(), cluster: "devnet" }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The award could not be recorded.");
      setGranteeId("");
      setReason("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The award could not be recorded.");
    } finally {
      setAwarding(false);
    }
  }

  const cards: Array<[string, string]> = data ? [
    ["Invites with a wallet", String(data.totals.grantsWithLinks)],
    ["Reached a settled round", String(data.totals.grantsWithCompletedRounds)],
    ["Linked but never played", String(data.engagement.linkedButNeverPlayed)],
    ["Played once only", String(data.engagement.playedOnce)],
    ["Returned three or more", String(data.engagement.returning)],
    ["Median rounds", String(data.engagement.medianRoundsCompleted)],
    ["Linked wallets", String(data.totals.linkedWallets)],
    ["Most wallets on one invite", String(data.distribution.maximumWalletsOnOneGrant)],
    ["Total XP", data.totals.xpAwarded.toLocaleString()],
    ["Top decile holds", `${Math.round(data.distribution.topDecileShare * 100)}%`],
  ] : [];

  return (
    <section className={styles.card} id="tester-xp" aria-labelledby="tester-xp-admin-title">
      <h2 id="tester-xp-admin-title">Tester XP</h2>
      <p className={styles.note}>{data?.note ?? "XP is a contribution record, not a token."}</p>

      {loading && !data ? <p>Loading…</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      {data ? (
        <>
          <div className={styles.metrics}>
            {cards.map(([label, value]) => (
              <div className={styles.metric} key={label}><span>{label}</span><strong>{value}</strong></div>
            ))}
          </div>

          <h3>Ranking</h3>
          {data.leaderboard.length ? (
            <table>
              <thead>
                <tr>
                  <th scope="col">Invite</th>
                  <th scope="col">XP</th>
                  <th scope="col">Rounds</th>
                  <th scope="col">Wallets</th>
                  <th scope="col">Reports</th>
                  <th scope="col">Devnet / Mainnet</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((row, index) => (
                  <tr key={row.granteeId}>
                    <td>
                      <strong>#{index + 1}</strong>{" "}
                      <code title={row.granteeId}>{row.granteeId.slice(0, 10)}…</code>
                    </td>
                    <td>{row.total.toLocaleString()}</td>
                    <td>{row.roundsCompleted}</td>
                    <td>{row.wallets}</td>
                    <td>{row.awards || "—"}</td>
                    <td>{row.byCluster.devnet.toLocaleString()} / {row.byCluster["mainnet-beta"].toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No invite has linked a wallet yet.</p>
          )}

          <h3>Award a verified report</h3>
          <p className={styles.note}>
            The only XP that is not derived from the chain. Use it for a reproduced defect, and state
            what it was: the reason is stored with the award and is the audit trail.
          </p>
          <form onSubmit={award} className={styles.inlineForm}>
            <label>
              Invite id
              <input value={granteeId} onChange={(event) => setGranteeId(event.target.value)} required placeholder="grant id from the ranking" />
            </label>
            <label>
              Points
              <input value={points} onChange={(event) => setPoints(event.target.value)} inputMode="numeric" required />
            </label>
            <label>
              Reason
              <input value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="reproduced the settlement rounding defect" />
            </label>
            <button type="submit" disabled={awarding}>{awarding ? "Recording…" : "Record award"}</button>
          </form>

          <p className={styles.note}>
            Generated {new Date(data.generatedAt).toLocaleString("en-GB", { timeZone: "UTC", hour12: false })} UTC.
            Every figure is recomputed from chain state on read, so this page and a tester&apos;s own
            profile can never disagree.
          </p>
        </>
      ) : null}
    </section>
  );
}
