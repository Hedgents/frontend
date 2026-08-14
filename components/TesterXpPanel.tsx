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
 * The XP record, and the wallet link that makes it possible.
 *
 * Nothing here calls this a tester or testing record. XP accrues on mainnet as well as devnet, so
 * that framing would be wrong the moment a real trade counts toward it, and it would also imply the
 * score is a throwaway artifact of a beta rather than a running record.
 *
 * The disclosure comes from the server on every profile rather than being written here, so a
 * surface cannot render a score while quietly dropping what the score is and is not.
 */
type ConnectedWallet = NonNullable<ReturnType<typeof useConnectedWallet>>;

/**
 * The link control, mounted only once a wallet is actually connected.
 *
 * This is a separate component because `useSignMessage` reads `.features` off the account it is
 * given and throws outright on undefined. A hook cannot be called conditionally, so the only way to
 * avoid handing it nothing is to move it behind a component that does not render until there is a
 * real account. Passing `connected?.account as never` type-checked and then crashed the whole view
 * for every visitor who had not connected yet, which is most first-time visitors.
 */
function LinkWalletControl({
  account,
  wallet,
  onLinked,
}: {
  account: ConnectedWallet["account"];
  wallet: string;
  onLinked: () => void;
}) {
  const signMessage = useSignMessage(account);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    setLinking(true);
    setError(null);
    try {
      const challenge = await requestWalletLinkChallenge(wallet);
      // The wallet signs the server's exact message. Nothing here composes bytes of its own, so
      // what the holder sees in their wallet prompt is exactly what the server will verify.
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
      onLinked();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The wallet link could not be completed.");
    } finally {
      setLinking(false);
    }
  }

  return (
    <>
      <button type="button" onClick={link} disabled={linking}>
        {linking ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
        {linking ? "Waiting for your wallet…" : `Link ${shortAddress(wallet)}`}
      </button>
      {error ? (
        <p className={styles.error} role="alert"><CircleAlert size={13} aria-hidden="true" /> {error}</p>
      ) : null}
    </>
  );
}

export function TesterXpPanel({ onConnect }: { onConnect: () => void }) {
  const client = useClient<AppSolanaClient>();
  const connected = useConnectedWallet(client);
  const xp = useTesterXp();

  const wallet = connected ? String(connected.account.address) : null;
  const profile = xp.data ?? null;
  const alreadyLinked = Boolean(wallet && profile?.wallets.some((entry) => entry.wallet === wallet));

  return (
    <section className={styles.panel} aria-labelledby="tester-xp-title">
      <header className={styles.head}>
        <span><Trophy size={14} aria-hidden="true" /> XP record</span>
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

        {!connected || !wallet ? (
          <button type="button" onClick={onConnect}>Connect a wallet</button>
        ) : alreadyLinked ? (
          <p className={styles.linkedNote}>
            <ShieldCheck size={13} aria-hidden="true" /> {shortAddress(wallet)} is linked to this invite.
          </p>
        ) : (
          <LinkWalletControl
            account={connected.account}
            wallet={wallet}
            onLinked={() => void xp.refetch()}
          />
        )}
        <p className={styles.signNote}>
          Linking asks for a signature only. It authorises no transaction, moves no funds, and grants
          no spending permission.
        </p>
      </div>

      {profile && (profile.rounds.length || profile.binary.length || profile.terminal.length) ? (
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
              {profile.binary.map((position) => (
                <tr key={`binary-${position.cluster}-${position.marketSlug}`}>
                  <td>
                    <span>{position.marketSlug}</span>
                    <small>{position.note ?? "Binary market"}</small>
                  </td>
                  <td>{position.participation || "—"}</td>
                  <td>{position.correct || "—"}</td>
                  <td>—</td>
                  <td><strong>{position.total || "—"}</strong></td>
                </tr>
              ))}
              {profile.terminal.map((entry) => (
                <tr key={`terminal-${entry.cluster}`}>
                  <td>
                    <span>Terminal trading</span>
                    <small>
                      {entry.trades} trade{entry.trades === 1 ? "" : "s"}
                      {entry.roundTrips ? `, ${entry.roundTrips} round trip${entry.roundTrips === 1 ? "" : "s"}` : ""}
                      {entry.trades > entry.countedTrades ? ` · ${entry.countedTrades} counted after the daily cap` : ""}
                    </small>
                  </td>
                  <td colSpan={3} />
                  <td><strong>{entry.total || "—"}</strong></td>
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
