"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Check, LockKeyhole } from "lucide-react";
import { PulsePriceChart, type PulsePricePoint } from "./PulsePriceChart";
import { PulseTicket, type PulseTradeableRound } from "./PulseTicket";
import styles from "./pulse-market.module.css";

interface PulseRunningRound {
  roundId: string;
  startsAtUnix: number;
  endsAtUnix: number;
  onChain: boolean;
}

interface PulseLive {
  cluster: "devnet" | "mainnet-beta" | null;
  nowUnix: number;
  intervalSeconds: number;
  price: {
    latest: { price: number; publishedAt: string } | null;
    opening: { price: number; publishedAt: string } | null;
    roundStatus: string;
    providerState: "online" | "degraded";
    refreshAfterMs: number;
    mode: string;
  };
  running: PulseRunningRound | null;
  tradeable: PulseTradeableRound | null;
  error?: string;
}

async function fetchLive() {
  const response = await fetch("/api/scarcity/pulse/live", { cache: "no-store" });
  const payload = (await response.json()) as PulseLive;
  if (!response.ok) throw new Error(payload.error ?? "The Gold 15 round is unavailable.");
  return payload;
}

function countdown(toUnix: number, nowUnix: number) {
  const remaining = Math.max(0, toUnix - nowUnix);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Gold 15.
 *
 * The screen answers one question and shows one number moving against one line, because that is the
 * whole instrument. Taking a side buys a YES or NO contract from the operator's resting order; the
 * cost and the payout are both fixed and both shown before the wallet opens, so nobody has to work
 * out what they stand to win from a price and a quantity.
 */
export function PulseMarket({ onConnect }: { onConnect: () => void }) {
  const live = useQuery({
    queryKey: ["pulse-live"],
    queryFn: fetchLive,
    refetchInterval: 5_000,
    retry: 1,
  });
  const [series, setSeries] = useState<PulsePricePoint[]>([]);
  const [filled, setFilled] = useState<string | null>(null);
  const roundRef = useRef<string | null>(null);

  const data = live.data ?? null;
  const latest = data?.price.latest ?? null;
  const opening = data?.price.opening ?? null;
  const runningRound = data?.running?.roundId ?? null;

  useEffect(() => {
    // Each round is its own chart. Carrying ticks across a boundary would draw a line against an
    // opening price that no longer applies.
    if (roundRef.current !== runningRound) {
      roundRef.current = runningRound;
      setSeries(opening ? [{ atUnix: Math.floor(Date.parse(opening.publishedAt) / 1_000), price: opening.price }] : []);
      return;
    }
    if (!latest) return;
    const atUnix = Math.floor(Date.parse(latest.publishedAt) / 1_000);
    setSeries((current) => (current.at(-1)?.atUnix === atUnix
      ? current
      : [...current, { atUnix, price: latest.price }].slice(-360)));
  }, [latest, opening, runningRound]);

  if (live.isLoading) return <section className={styles.panel}><p className={styles.muted}>Loading the round…</p></section>;

  if (live.error || !data) {
    return (
      <section className={styles.panel}>
        <p className={styles.error} role="alert">
          <CircleAlert size={14} aria-hidden="true" />
          {live.error instanceof Error ? live.error.message : "The Gold 15 round is unavailable."}
        </p>
      </section>
    );
  }

  const tradeable = data.tradeable;
  const tradingClosesAt = tradeable ? tradeable.startsAtUnix - 15 : 0;
  const open = Boolean(tradeable) && data.nowUnix < tradingClosesAt;

  return (
    <section className={styles.panel} aria-labelledby="pulse-title">
      <header className={styles.head}>
        <span>Price market · Gold 15 · XAU/USD via Pyth</span>
        <h2 id="pulse-title">Will gold close higher than it opened?</h2>
        <p className={styles.muted}>
          A round runs fifteen minutes. It settles on the Pyth closing price against the opening
          price of the same round. An exact tie settles invalid and refunds.
        </p>
      </header>

      <div className={styles.chartBlock}>
        <div className={styles.chartHead}>
          <span>Round in progress{runningRound ? ` · ${runningRound.replace("gold-15m-", "")}` : ""}</span>
          {data.running ? <strong>{countdown(data.running.endsAtUnix, data.nowUnix)} to close</strong> : null}
        </div>
        <PulsePriceChart points={series} openingPrice={opening?.price ?? null} />
        {data.price.providerState === "degraded" ? (
          <p className={styles.warn}>
            <CircleAlert size={13} aria-hidden="true" />
            The price feed is degraded. A round with no valid opening or closing observation settles
            invalid and refunds rather than guessing.
          </p>
        ) : null}
      </div>

      <div className={styles.betting}>
        <div className={styles.bettingHead}>
          <span>Next round{tradeable ? ` · ${tradeable.roundId.replace("gold-15m-", "")}` : ""}</span>
          {tradeable ? (
            <strong>
              {open ? `${countdown(tradingClosesAt, data.nowUnix)} to take a side` : "Entry frozen"}
            </strong>
          ) : null}
        </div>

        {!tradeable ? (
          <p className={styles.muted}>No round is open for entry yet.</p>
        ) : !open ? (
          <p className={styles.frozen}>
            <LockKeyhole size={14} aria-hidden="true" />
            Entry freezes fifteen seconds before a round opens, so nobody can take a side once the
            opening price is effectively known.
          </p>
        ) : (
          <PulseTicket
            round={tradeable}
            cluster={data.cluster ?? "devnet"}
            onConnect={onConnect}
            onFilled={(signature) => {
              setFilled(signature);
              // The book has moved, so pull it again rather than leaving a stale remainder on screen.
              void live.refetch();
            }}
          />
        )}

        {filled ? (
          <p className={styles.filled} role="status">
            <Check size={13} aria-hidden="true" />
            Your side is taken. It settles automatically when the round closes, and you redeem from
            the portfolio once it does. Signature {filled.slice(0, 8)}…{filled.slice(-6)}
          </p>
        ) : null}

        <p className={styles.muted}>
          {data.cluster === "mainnet-beta"
            ? "Settles in USDC."
            : "Solana devnet. This round settles in a test token with no value, issued by the operator for rehearsal."}
        </p>
      </div>
    </section>
  );
}
