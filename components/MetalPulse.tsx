"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Clock,
  Database,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import {
  createMetalPulsePaperAccount,
  placeMetalPulsePaperPosition,
  settleMetalPulsePaperAccount,
  type MetalPulseDirection,
  type MetalPulsePaperAccount,
  type MetalPulseRound,
} from "@/lib/metal-pulse";
import {
  fetchMetalPulseRound,
  useMetalPulse,
  useScarcityData,
  useScarcityPulse,
} from "@/hooks/use-scarcity-exchange";
import styles from "./metal-pulse.module.css";

const PAPER_ACCOUNT_KEY = "hedgents-metal-pulse-paper-v1";

function money(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function price(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signed(value: number | null) {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function roundTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }).format(new Date(value));
}

function countdown(target: string, now: number) {
  if (!now) return "--:--";
  const seconds = Math.max(0, Math.ceil((Date.parse(target) - now) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function roundLabel(round: MetalPulseRound) {
  if (round.status === "resolved") return round.outcome?.toUpperCase() ?? "RESOLVED";
  if (round.status === "invalid") return "RETURNED";
  if (round.status === "session-closed") return "PAUSED";
  return round.status.toUpperCase();
}

function RoundCard({ round, slot, now }: { round: MetalPulseRound; slot: "previous" | "current" | "next"; now: number }) {
  const clock = slot === "next"
    ? countdown(round.startsAt, now)
    : round.status === "trading" || round.status === "frozen"
      ? countdown(round.endsAt, now)
      : `${roundTime(round.startsAt)}–${roundTime(round.endsAt)}`;
  return (
    <article className={`${styles.roundCard} ${slot === "current" ? styles.roundCurrent : ""}`}>
      <header><span>{slot} / {round.id.split("-").at(-1)}</span><strong className={styles[`status_${round.status.replace("-", "_")}`]}>{roundLabel(round)}</strong></header>
      <div>
        <span>{roundTime(round.startsAt)} UTC</span>
        <strong>{clock}</strong>
      </div>
      <footer>
        <span>{round.opening ? price(round.opening.priceUsd) : slot === "next" ? "opening mark pending" : "no opening mark"}</span>
        {round.outcome === "up" ? <ArrowUpRight size={13} /> : round.outcome === "down" ? <ArrowDownRight size={13} /> : <Clock size={12} />}
      </footer>
    </article>
  );
}

export function MetalPulse() {
  const pulseQuery = useMetalPulse();
  const weeklyQuery = useScarcityPulse("Au");
  const scarcityQuery = useScarcityData("Au");
  const [now, setNow] = useState(0);
  const [direction, setDirection] = useState<MetalPulseDirection>("up");
  const [stake, setStake] = useState("10");
  const [account, setAccount] = useState<MetalPulsePaperAccount>(() => createMetalPulsePaperAccount());
  const [accountReady, setAccountReady] = useState(false);
  const [ticketMessage, setTicketMessage] = useState<string | null>(null);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (pulseQuery.data || !pulseQuery.isFetching) {
      setLoadTimedOut(false);
      return;
    }
    const timeout = window.setTimeout(() => setLoadTimedOut(true), 8_000);
    return () => window.clearTimeout(timeout);
  }, [pulseQuery.data, pulseQuery.isFetching, retryAttempt]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PAPER_ACCOUNT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as MetalPulsePaperAccount;
        if (parsed.version === 1 && Number.isFinite(parsed.balanceUsdc) && Array.isArray(parsed.positions)) setAccount(parsed);
      }
    } catch {
      window.localStorage.removeItem(PAPER_ACCOUNT_KEY);
    } finally {
      setAccountReady(true);
    }
  }, []);

  useEffect(() => {
    if (accountReady) window.localStorage.setItem(PAPER_ACCOUNT_KEY, JSON.stringify(account));
  }, [account, accountReady]);

  useEffect(() => {
    const snapshot = pulseQuery.data;
    if (!snapshot || !accountReady) return;
    const immediatelyKnown = new Map([
      [snapshot.previous.id, snapshot.previous],
      [snapshot.current.id, snapshot.current],
      [snapshot.next.id, snapshot.next],
    ]);
    setAccount((current) => settleMetalPulsePaperAccount(current, immediatelyKnown));
    const unresolved = account.positions
      .filter((position) => position.status === "open" && !immediatelyKnown.has(position.roundId))
      .slice(0, 8);
    if (!unresolved.length) return;
    let cancelled = false;
    void Promise.all(unresolved.map((position) => fetchMetalPulseRound(position.roundId).catch(() => null)))
      .then((rounds) => {
        if (cancelled) return;
        const resolved = new Map(rounds.flatMap((round) => round ? [[round.id, round] as const] : []));
        setAccount((current) => settleMetalPulsePaperAccount(current, resolved));
      });
    return () => { cancelled = true; };
  }, [pulseQuery.data, accountReady, account.positions]);

  const snapshot = pulseQuery.data;
  const current = snapshot?.current;
  const next = snapshot?.next;
  const opening = current?.opening?.priceUsd ?? null;
  const currentPrice = current?.latest?.priceUsd ?? null;
  const movePct = opening && currentPrice ? ((currentPrice - opening) / opening) * 100 : null;
  const moveBps = movePct === null ? 0 : movePct * 100;
  const beamPosition = Math.max(6, Math.min(94, 50 + moveBps * 1.6));
  const stakeNumber = Number(stake);
  const paperPriceCents = direction === "up" ? next?.paperQuote.upCents ?? 50 : next?.paperQuote.downCents ?? 50;
  const paperShares = Number.isFinite(stakeNumber) ? stakeNumber / (paperPriceCents / 100) : 0;
  const currentSessionActive = current?.status === "trading" || current?.status === "frozen";
  const entryWindowOpen = Boolean(next && now > 0 && now < Date.parse(next.entryClosesAt));
  const canEnter = Boolean(next && currentSessionActive && entryWindowOpen && accountReady && stakeNumber >= 1 && stakeNumber <= 100 && stakeNumber <= account.balanceUsdc);
  const openExposure = account.positions.filter((position) => position.status === "open").reduce((total, position) => total + position.stakeUsdc, 0);
  const settledPositions = account.positions.filter((position) => position.status !== "open" && position.status !== "invalid");
  const wins = settledPositions.filter((position) => position.status === "won").length;
  const winRate = settledPositions.length ? Math.round((wins / settledPositions.length) * 100) : null;
  const weekly = weeklyQuery.data?.weekly;
  const managedMoney = weekly?.latest?.managedMoneyNetPct ?? null;
  const physicalState = scarcityQuery.data?.state;
  const positions = useMemo(() => account.positions.slice(0, 6), [account.positions]);
  const entryUnavailableReason = !currentSessionActive
    ? "Paper entries pause while the XAU/USD source is not publishing."
    : !entryWindowOpen
      ? "The next round entry window is frozen. Wait for the following window."
      : !accountReady
        ? "Restoring the local paper account."
        : !Number.isFinite(stakeNumber) || stakeNumber < 1 || stakeNumber > 100
          ? "Enter a paper stake between 1 and 100 pUSDC."
          : stakeNumber > account.balanceUsdc
            ? "Paper stake exceeds the available simulator balance."
            : null;

  function placePaperEntry() {
    if (!next) return;
    try {
      const result = placeMetalPulsePaperPosition({
        account,
        round: next,
        direction,
        stakeUsdc: stakeNumber,
        positionId: crypto.randomUUID(),
      });
      setAccount(result.account);
      setTicketMessage(`${direction.toUpperCase()} paper entry queued for ${roundTime(next.startsAt)} UTC.`);
    } catch (error) {
      setTicketMessage(error instanceof Error ? error.message : "Paper entry failed.");
    }
  }

  function resetAccount() {
    setAccount(createMetalPulsePaperAccount());
    setTicketMessage("Paper account reset to 1,000 USDC.");
  }

  function retryPulse() {
    setLoadTimedOut(false);
    setRetryAttempt((attempt) => attempt + 1);
    void pulseQuery.refetch({ cancelRefetch: true });
  }

  if (!snapshot && pulseQuery.isFetching && !loadTimedOut) {
    return <section className={styles.loading} role="status" aria-live="polite"><div aria-hidden="true"><i /><i /><i /></div><span>Calibrating Gold 15 windows…</span><small>Live source checks stop after eight seconds.</small></section>;
  }

  if (!snapshot) {
    const detail = pulseQuery.error instanceof Error
      ? pulseQuery.error.message
      : loadTimedOut
        ? "The live source did not answer within eight seconds."
        : "No verified Gold 15 snapshot is available.";
    return (
      <section className={styles.sourceState} role="alert">
        <div className={styles.sourceStateMark}><AlertTriangle size={24} aria-hidden="true" /></div>
        <span>SCX / GOLD 15 / SOURCE GATE</span>
        <h1>Live observations are unavailable.</h1>
        <p>{detail} Paper trading is paused and no position or wallet state was changed.</p>
        <div>
          <button type="button" onClick={retryPulse} disabled={pulseQuery.isFetching && !loadTimedOut}>
            <RotateCcw size={14} aria-hidden="true" /> {pulseQuery.isFetching ? "Checking source…" : "Retry source"}
          </button>
          <small>Gold 15 fails closed when its committed reference cannot be verified.</small>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.pulse}>
      <header className={styles.hero}>
        <div className={styles.heroIdentity}>
          <span className={styles.kicker}>SCX / METAL PULSE / PAPER LAB 01</span>
          <div className={styles.elementLockup}><small>79</small><strong>Au</strong><i /></div>
          <h1>Gold.<br /><em>Fifteen minutes.</em></h1>
          <p>A deterministic rehearsal for a recurring Solana market. Predict the next interval before its opening mark is committed.</p>
        </div>
        <div className={styles.heroClock} style={{ "--progress": `${now && current ? Math.max(0, Math.min(100, ((now - Date.parse(current.startsAt)) / (Date.parse(current.endsAt) - Date.parse(current.startsAt))) * 100)) : 0}%` } as CSSProperties}>
          <div>
            <span>{currentSessionActive ? "CURRENT ROUND" : "SOURCE STATE"}</span>
            <strong>{currentSessionActive && current ? countdown(current.endsAt, now) : "PAUSED"}</strong>
            <small>{currentSessionActive ? "until observation close" : "metal session not publishing"}</small>
          </div>
        </div>
        <div className={styles.heroSource}>
          <span><i className={snapshot?.providerState === "online" ? styles.sourceOnline : styles.sourceDegraded} /> PYTH CORE</span>
          <strong>{currentPrice ? price(currentPrice) : "No current mark"}</strong>
          <small>{current?.latest?.publishedAt ? `Last observation ${new Date(current.latest.publishedAt).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} UTC` : snapshot?.providerMessage ?? "Waiting for XAU/USD"}</small>
          <code>{snapshot?.source.feedId.slice(0, 10)}…{snapshot?.source.feedId.slice(-8)}</code>
        </div>
      </header>

      {pulseQuery.isError || snapshot.providerState === "degraded" ? (
        <div className={styles.sourceWarning} role="status">
          <AlertTriangle size={15} aria-hidden="true" />
          <span><strong>Source degraded.</strong> Showing the last verified snapshot from {new Date(snapshot.asOf).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })} UTC. New entries remain fail-closed when the round pauses.</span>
          <button type="button" onClick={retryPulse} disabled={pulseQuery.isFetching}>{pulseQuery.isFetching ? "Checking…" : "Retry"}</button>
        </div>
      ) : null}

      {snapshot ? <section className={styles.roundRail} aria-label="Gold 15 round sequence">
        <RoundCard round={snapshot.previous} slot="previous" now={now} />
        <RoundCard round={snapshot.current} slot="current" now={now} />
        <RoundCard round={snapshot.next} slot="next" now={now} />
      </section> : null}

      <a className={styles.mobileTicketDock} href="#gold-15-ticket">
        <span><small>Paper market</small><strong>{direction.toUpperCase()} · {stake || "0"} pUSDC</strong></span>
        <em>Open ticket ↓</em>
      </a>

      <div className={styles.workspace}>
        <section className={styles.marketStage}>
          <header className={styles.marketQuestion}>
            <div>
              <span>NEXT COMMITTED WINDOW</span>
              <h2>Will gold finish higher?</h2>
              <p>{next ? `${roundTime(next.startsAt)}–${roundTime(next.endsAt)} UTC · XAU/USD opening versus closing observation` : "Waiting for the next deterministic round."}</p>
            </div>
            <strong>PAPER ONLY</strong>
          </header>

          <div className={styles.referencePanel}>
            <div className={styles.referenceNumbers}>
              <article><span>Opening mark</span><strong>{price(opening)}</strong><small>{current?.opening ? roundTime(current.opening.publishedAt) : "not committed"}</small></article>
              <article><span>Current mark</span><strong>{price(currentPrice)}</strong><small>{current?.status ?? "unavailable"}</small></article>
              <article><span>Move from open</span><strong className={(movePct ?? 0) > 0 ? styles.upText : (movePct ?? 0) < 0 ? styles.downText : undefined}>{signed(movePct)}</strong><small>reference movement · not probability</small></article>
            </div>
            <div className={styles.priceBeam} aria-label="Current XAU reference relative to the round opening mark">
              <span>lower</span><div><i className={styles.openMarker} /><i className={styles.liveMarker} style={{ left: `${beamPosition}%` }} /></div><span>higher</span>
              <small style={{ left: `${beamPosition}%` }}>{currentPrice ? "NOW" : "NO FEED"}</small>
            </div>
          </div>

          <section className={styles.edgePanel}>
            <header><div><span>Hedgents context rail</span><small>Objective observations only · no directional recommendation</small></div><Activity size={15} /></header>
            <div>
              <article><span>Managed money net</span><strong>{managedMoney === null ? "—" : `${managedMoney > 0 ? "+" : ""}${managedMoney.toFixed(1)}%`}</strong><small>{weekly?.freshness ?? "unavailable"} CFTC positioning</small></article>
              <article><span>Physical state</span><strong>{physicalState?.coverageStatus ?? "uncovered"}</strong><small>market tightness {physicalState?.marketTightness?.toFixed(1) ?? "—"}</small></article>
              <article><span>Data confidence</span><strong>{physicalState ? Math.round(physicalState.confidence) : "—"}</strong><small>separate from market probability</small></article>
              <article><span>Resolution discipline</span><strong>±60s</strong><small>committed observation tolerance</small></article>
            </div>
          </section>

          <section className={styles.rulesStrip}>
            <div><ShieldCheck size={14} /><span><strong>Fully specified</strong><small>15-minute UTC boundaries · 15-second freeze · exact Pyth feed</small></span></div>
            <div><Database size={14} /><span><strong>Fail closed</strong><small>Missing mark or equal price returns paper positions at cost</small></span></div>
            <div><CircleDollarSign size={14} /><span><strong>No live capital</strong><small>Local paper ledger · no wallet signature · no transaction</small></span></div>
          </section>
        </section>

        <aside className={styles.ticket} id="gold-15-ticket" aria-labelledby="gold-15-ticket-title">
          <header className={styles.ticketHeader}>
            <div><span id="gold-15-ticket-title">PAPER TICKET</span><small>Next Gold 15 round</small></div>
            <div><span>Balance</span><strong>{money(account.balanceUsdc)} <small>pUSDC</small></strong></div>
          </header>

          <div className={styles.choiceGrid}>
            <button type="button" className={direction === "up" ? styles.upActive : undefined} onClick={() => { setDirection("up"); setTicketMessage(null); }}>
              <ArrowUpRight size={18} /><span>UP</span><strong>{next?.paperQuote.upCents ?? 50}¢</strong><small>close &gt; open</small>
            </button>
            <button type="button" className={direction === "down" ? styles.downActive : undefined} onClick={() => { setDirection("down"); setTicketMessage(null); }}>
              <ArrowDownRight size={18} /><span>DOWN</span><strong>{next?.paperQuote.downCents ?? 50}¢</strong><small>close &lt; open</small>
            </button>
          </div>

          <label className={styles.stakeInput}>
            <span>Paper stake</span>
            <div><input value={stake} onChange={(event) => { setStake(event.target.value); setTicketMessage(null); }} inputMode="decimal" aria-label="Paper stake in USDC" /><strong>pUSDC</strong></div>
          </label>
          <div className={styles.quickStakes}>{[5, 10, 25, 100].map((value) => <button type="button" key={value} onClick={() => setStake(String(value))}>{value}</button>)}</div>

          <dl className={styles.ticketMath}>
            <div><dt>Entry price</dt><dd>{paperPriceCents}¢ fixed simulator quote</dd></div>
            <div><dt>Paper shares</dt><dd>{Number.isFinite(paperShares) ? paperShares.toFixed(2) : "—"}</dd></div>
            <div><dt>Maximum loss</dt><dd>{Number.isFinite(stakeNumber) ? money(Math.max(0, stakeNumber)) : "—"} pUSDC</dd></div>
            <div><dt>Winning payout</dt><dd>{Number.isFinite(paperShares) ? money(Math.max(0, paperShares)) : "—"} pUSDC</dd></div>
          </dl>

          <button type="button" className={styles.submit} disabled={!canEnter} onClick={placePaperEntry}>
            {!currentSessionActive
              ? "Entries pause with the metal feed"
              : !entryWindowOpen
                ? "Next round entry frozen"
                : `Queue ${direction.toUpperCase()} for ${next ? roundTime(next.startsAt) : "next round"}`}
          </button>
          <p className={styles.ticketNote} role={ticketMessage ? "status" : undefined}>{ticketMessage ?? entryUnavailableReason ?? snapshot?.separation ?? "Paper simulator only."}</p>

          <div className={styles.paperStats}>
            <div><span>Open risk</span><strong>{money(openExposure)}</strong></div>
            <div><span>Settled</span><strong>{settledPositions.length}</strong></div>
            <div><span>Win rate</span><strong>{winRate === null ? "—" : `${winRate}%`}</strong></div>
          </div>

          <section className={styles.positionList}>
            <header><span>Paper ledger</span><button type="button" onClick={resetAccount}><RotateCcw size={11} /> reset</button></header>
            {positions.length ? positions.map((position) => (
              <article key={position.id}>
                <i className={position.direction === "up" ? styles.upDot : styles.downDot} />
                <div><strong>{position.direction.toUpperCase()} · {money(position.stakeUsdc)} pUSDC</strong><small>{position.roundId.split("-").at(-1)}</small></div>
                <span className={styles[`position_${position.status}`]}>{position.status}</span>
              </article>
            )) : <div className={styles.emptyLedger}><Clock size={14} /><span>No paper entries yet.</span></div>}
          </section>
        </aside>
      </div>
    </section>
  );
}
