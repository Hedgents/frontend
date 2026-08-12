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
  /** The round's price path so far, sampled server side from Pyth. */
  track: PulsePricePoint[];
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
    marketOpen: boolean;
    lastPublishedAt: string | null;
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

  const track = data?.running?.track;

  useEffect(() => {
    // Each round is its own chart. Carrying ticks across a boundary would draw a line against an
    // opening price that no longer applies.
    if (roundRef.current !== runningRound) {
      roundRef.current = runningRound;
      setSeries(track ?? []);
      return;
    }
    // The server's track is the round's real path; live polls only extend its tail. Merging by
    // timestamp means a reconnect or a slow tab recovers the whole round rather than drawing a
    // straight line from wherever it happened to rejoin.
    setSeries((current) => {
      const merged = new Map(current.map((point) => [point.atUnix, point]));
      for (const point of track ?? []) merged.set(point.atUnix, point);
      if (latest) {
        const atUnix = Math.floor(Date.parse(latest.publishedAt) / 1_000);
        merged.set(atUnix, { atUnix, price: latest.price });
      }
      const next = [...merged.values()].sort((left, right) => left.atUnix - right.atUnix);
      return next.length === current.length && next.every((point, index) => point === current[index])
        ? current
        : next;
    });
  }, [latest, track, runningRound]);

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
        <PulsePriceChart
          points={series}
          openingPrice={opening?.price ?? null}
          startsAtUnix={data.running?.startsAtUnix ?? null}
          endsAtUnix={data.running?.endsAtUnix ?? null}
          nowUnix={data.nowUnix}
        />
        {!data.price.marketOpen ? (
          <p className={styles.warn}>
            <CircleAlert size={13} aria-hidden="true" />
            Spot gold is closed, so the price is frozen at its last print
            {data.price.lastPublishedAt
              ? ` of ${new Date(data.price.lastPublishedAt).toUTCString().replace("GMT", "UTC")}`
              : ""}
            . Rounds that run and close on a frozen price tie, settle invalid and refund, so there is
            nothing to win until it reopens. Gold breaks daily around 21:00 UTC and is shut from
            Friday evening to Sunday evening.
          </p>
        ) : null}
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
            marketOpen={data.price.marketOpen}
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
