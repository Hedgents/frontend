"use client";

import { useState } from "react";
import { CircleAlert, Link2, Loader2, ShieldCheck, Trophy } from "lucide-react";
import { useSignMessage } from "@solana/react";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { useClient } from "@solana/react";
import type { AppSolanaClient } from "@/app/providers";
import {
  requestWalletLinkChallenge,
  submitWalletLink,
  useTesterXp,
} from "@/hooks/use-scarcity-exchange";
import styles from "./tester-xp-panel.module.css";

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Tester XP, and the wallet link that makes it possible.
 *
 * The disclosure comes from the server on every profile rather than being written here, so a
 * surface cannot render a score while quietly dropping what the score is and is not.
 */
export function TesterXpPanel({ onConnect }: { onConnect: () => void }) {
  const client = useClient<AppSolanaClient>();
  const connected = useConnectedWallet(client);
  const signMessage = useSignMessage(connected?.account as never);
  const xp = useTesterXp();
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wallet = connected ? String(connected.account.address) : null;
  const profile = xp.data ?? null;
  const alreadyLinked = Boolean(wallet && profile?.wallets.some((entry) => entry.wallet === wallet));

  async function link() {
    if (!wallet) return;
    setLinking(true);
    setError(null);
    try {
      const challenge = await requestWalletLinkChallenge(wallet);
      // The wallet signs the server's exact message. Nothing here composes bytes of its own, so
      // what the tester sees in their wallet prompt is exactly what the server will verify.
      const signed = await signMessage({ message: new TextEncoder().encode(challenge.message) });
      const signature = signed?.signature;
      if (!signature) throw new Error("The wallet did not return a signature.");
      const base58 = (await import("@solana/kit")).getBase58Decoder().decode(signature);
      await submitWalletLink({
        wallet,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt,
        proof: challenge.proof,
        signature: String(base58),
      });
      await xp.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The wallet link could not be completed.");
    } finally {
      setLinking(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="tester-xp-title">
      <header className={styles.head}>
        <span><Trophy size={14} aria-hidden="true" /> Tester record</span>
        <h2 id="tester-xp-title">
          {profile ? profile.total.toLocaleString() : "—"} XP
        </h2>
        {profile ? (
          <p className={styles.split}>
            <span>{profile.byCluster.devnet.toLocaleString()} devnet</span>
            <span>{profile.byCluster["mainnet-beta"].toLocaleString()} mainnet</span>
            <span>{profile.roundsCompleted} round{profile.roundsCompleted === 1 ? "" : "s"}</span>
          </p>
        ) : null}
      </header>

      {profile ? (
        <p className={styles.disclosure} role="note">
          <ShieldCheck size={13} aria-hidden="true" />
          <span>{profile.disclosure}</span>
        </p>
      ) : null}

      <div className={styles.wallets}>
        <h3>Linked wallets</h3>
        {profile?.wallets.length ? (
          <ul>
            {profile.wallets.map((entry) => (
              <li key={entry.wallet}>
                <code>{shortAddress(entry.wallet)}</code>
                <small>linked {new Date(entry.linkedAt).toISOString().slice(0, 10)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>
            No wallet linked yet. Your forecasts only count toward this record once the wallet that
            made them is linked to your invite.
          </p>
        )}

        {!connected ? (
          <button type="button" onClick={onConnect}>Connect a wallet</button>
        ) : alreadyLinked ? (
          <p className={styles.linkedNote}>
            <ShieldCheck size={13} aria-hidden="true" /> {shortAddress(wallet!)} is linked to this invite.
          </p>
        ) : (
          <button type="button" onClick={link} disabled={linking}>
            {linking ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
            {linking ? "Waiting for your wallet…" : `Link ${shortAddress(wallet!)}`}
          </button>
        )}
        <p className={styles.signNote}>
          Linking asks for a signature only. It authorises no transaction, moves no funds, and grants
          no spending permission.
        </p>
        {error ? (
          <p className={styles.error} role="alert"><CircleAlert size={13} aria-hidden="true" /> {error}</p>
        ) : null}
      </div>

      {profile?.rounds.length ? (
        <div className={styles.rounds}>
          <h3>How it was earned</h3>
          <table>
            <thead>
              <tr><th scope="col">Round</th><th scope="col">Held</th><th scope="col">Accuracy</th><th scope="col">Claimed</th><th scope="col">Total</th></tr>
            </thead>
            <tbody>
              {profile.rounds.map((round) => (
                <tr key={`${round.cluster}-${round.roundSlug}`}>
                  <td>
                    <span>{round.roundSlug.replace(/-curve-v1$/, "")}</span>
                    {round.note ? <small>{round.note}</small> : null}
                  </td>
                  <td>{round.participation || "—"}</td>
                  <td>{round.accuracy || "—"}</td>
                  <td>{round.settlementClaim || "—"}</td>
                  <td><strong>{round.total || "—"}</strong></td>
                </tr>
              ))}
              {profile.breadth.total ? (
                <tr>
                  <td><span>Returning across rounds</span></td>
                  <td colSpan={3} />
                  <td><strong>{profile.breadth.total}</strong></td>
                </tr>
              ) : null}
              {profile.awards.total ? (
                <tr>
                  <td><span>Reported issues</span><small>{profile.awards.count} verified</small></td>
                  <td colSpan={3} />
                  <td><strong>{profile.awards.total}</strong></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {xp.error ? (
        <p className={styles.error} role="alert">
          <CircleAlert size={13} aria-hidden="true" /> {xp.error instanceof Error ? xp.error.message : "XP is unavailable."}
        </p>
      ) : null}
    </section>
  );
}
