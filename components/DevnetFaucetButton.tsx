"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useClient } from "@solana/react";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { Check, CircleAlert, Coins } from "lucide-react";
import type { AppSolanaClient } from "@/app/providers";
import styles from "./devnet-faucet.module.css";

interface FaucetBalances {
  cluster: "devnet" | null;
  mint?: string;
  tokenBalance?: string | null;
  lamportBalance?: string | null;
  toppedUp?: boolean;
  unavailable?: boolean;
  error?: string;
}

interface FaucetGrant {
  tokensGranted: string;
  lamportsGranted: string;
  tokenBalance: string;
  lamportBalance: string;
  signature: string | null;
  note: string;
  error?: string;
}

function testUnits(baseUnits: string | null | undefined) {
  if (!baseUnits) return "0";
  return (Number(BigInt(baseUnits)) / 1_000_000).toFixed(2);
}

function sol(lamports: string | null | undefined) {
  if (!lamports) return "0";
  return (Number(BigInt(lamports)) / 1_000_000_000).toFixed(3);
}

/**
 * Self-service devnet test funds.
 *
 * Every devnet market settles in an operator-issued token, and a tester also needs devnet SOL to
 * pay for the transaction, so an empty wallet cannot do anything anywhere in the workspace. One
 * button grants both, which is the difference between a demo somebody can try and one they can only
 * be shown.
 *
 * It renders nothing off devnet. There is no test money on mainnet and a button implying otherwise
 * would be worse than no button.
 */
export function DevnetFaucetButton() {
  const client = useClient<AppSolanaClient>();
  const connected = useConnectedWallet(client);
  const wallet = connected ? String(connected.account.address) : null;
  const [grant, setGrant] = useState<FaucetGrant | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balances = useQuery({
    queryKey: ["devnet-faucet", wallet],
    queryFn: async (): Promise<FaucetBalances> => {
      const response = await fetch(
        wallet ? `/api/scarcity/faucet?wallet=${wallet}` : "/api/scarcity/faucet",
        { cache: "no-store" },
      );
      const payload = (await response.json()) as FaucetBalances;
      if (!response.ok) throw new Error(payload.error ?? "Test balances are unavailable.");
      return payload;
    },
    refetchInterval: 30_000,
  });

  // Nothing to offer off devnet, and a button implying otherwise is worse than no button.
  if (balances.data && balances.data.cluster !== "devnet") return null;

  async function requestFunds() {
    if (!wallet) return;
    setSending(true);
    setError(null);
    setGrant(null);
    try {
      const response = await fetch("/api/scarcity/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      const payload = (await response.json()) as FaucetGrant;
      if (!response.ok) throw new Error(payload.error ?? "Test funds could not be sent.");
      setGrant(payload);
      void balances.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Test funds could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.faucet}>
      <div className={styles.head}>
        <Coins size={14} aria-hidden="true" />
        <div>
          <strong>Devnet test funds</strong>
          <span>
            {wallet
              ? `${testUnits(balances.data?.tokenBalance)} test units · ${sol(balances.data?.lamportBalance)} SOL`
              : "Connect a wallet to collect test funds"}
          </span>
        </div>
      </div>

      <button type="button" onClick={() => void requestFunds()} disabled={!wallet || sending}>
        {sending ? "Sending…" : balances.data?.toppedUp ? "Top up again" : "Get test funds"}
      </button>

      {grant ? (
        <p className={styles.granted} role="status">
          <Check size={13} aria-hidden="true" />
          {BigInt(grant.tokensGranted) > 0n || BigInt(grant.lamportsGranted) > 0n
            ? `Sent ${testUnits(grant.tokensGranted)} test units and ${sol(grant.lamportsGranted)} SOL.`
            : grant.note}
        </p>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          <CircleAlert size={13} aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <p className={styles.note}>
        Solana devnet only. The token has no value and exists so devnet markets have something to
        settle in. It is the collateral for every market here: price, curve and event.
      </p>
    </div>
  );
}
