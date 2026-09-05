"use client";

import {
  ArrowLeft,
  Check,
  Coins,
  Flame,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  GENESIS_BATCH_SIZE,
  GENESIS_PULL_PRICE_USD,
  GENESIS_RELIC_TIERS,
  genesisPullForTicket,
  genesisEconomy,
  secureRandomIndex,
  tierOddsPct,
  type GenesisPullResult,
  type RelicTier,
} from "@/lib/relic-vault";
import styles from "./genesis-vault.module.css";

const LiquidGoldForm = dynamic(
  () => import("./LiquidGoldForm").then((module) => module.LiquidGoldForm),
  { ssr: false },
);

type RevealPhase = "idle" | "shuffling" | "opening" | "revealed";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function RelicArtwork({
  tier,
  image,
  active = false,
  reveal = false,
}: {
  tier?: RelicTier;
  image?: string;
  active?: boolean;
  reveal?: boolean;
}) {
  const kind = tier?.id ?? "sealed";
  return (
    <div
      className={`${styles.artwork} ${styles[kind]} ${active ? styles.artworkActive : ""}`}
      data-reveal-artwork={reveal ? "true" : undefined}
      aria-hidden="true"
    >
      {tier ? (
        <Image
          className={styles.artworkImage}
          src={image ?? tier.image}
          alt=""
          fill
          loading={reveal ? "eager" : undefined}
          sizes="(max-width: 560px) 280px, (max-width: 1100px) 40vw, 320px"
        />
      ) : (
        <>
          <div className={styles.halo} />
          <div className={styles.object}>
            <i className={styles.objectCore} />
            <i className={styles.objectFacet} />
            <i className={styles.objectGem} />
          </div>
          <div className={styles.orbit}><i /><i /><i /></div>
          <span className={styles.assay}>Au · 79</span>
        </>
      )}
    </div>
  );
}

export function GenesisVault({ embedded = false }: { embedded?: boolean }) {
  const economy = useMemo(() => genesisEconomy(), []);
  const [phase, setPhase] = useState<RevealPhase>("idle");
  const [result, setResult] = useState<GenesisPullResult | null>(null);
  const [pendingResult, setPendingResult] = useState<GenesisPullResult | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearRevealTimers = () => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
  };

  useEffect(() => () => clearRevealTimers(), []);

  const simulatePull = () => {
    clearRevealTimers();
    const pull = genesisPullForTicket(secureRandomIndex(GENESIS_BATCH_SIZE));
    const preload = new window.Image();
    preload.src = pull.image;
    setResult(null);
    setPendingResult(pull);
    setPhase("shuffling");

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      timersRef.current.push(setTimeout(() => {
        setResult(pull);
        setPendingResult(null);
        setPhase("revealed");
        timersRef.current = [];
      }, 220));
      return;
    }

    timersRef.current.push(setTimeout(() => setPhase("opening"), 1_100));
    timersRef.current.push(setTimeout(() => {
      setResult(pull);
      setPendingResult(null);
      setPhase("revealed");
      timersRef.current = [];
    }, 1_850));
  };

  const reset = () => {
    clearRevealTimers();
    setPhase("idle");
    setResult(null);
    setPendingResult(null);
  };

  const busy = phase === "shuffling" || phase === "opening";
  const status = phase === "shuffling"
    ? "Shuffling fixed deck…"
    : phase === "opening"
      ? "Breaking assay seal…"
      : phase === "revealed"
        ? "Relic revealed"
        : "Vault sealed";

  const Root = embedded ? "section" : "main";

  return (
    <Root className={`${styles.page} ${embedded ? styles.embedded : ""}`} aria-label={embedded ? "Genesis Vault" : undefined}>
      {!embedded ? <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="Back to Hedgents Metal Terminal">
          <Image
            src="/brand/hedgents-source-lockup-transparent.png"
            alt="Hedgents"
            width={1275}
            height={355}
            priority
          />
        </Link>
        <div className={styles.topbarCenter}>
          <span>Experimental collection</span>
          <strong>Genesis Vault</strong>
        </div>
        <Link className={styles.backLink} href="/">
          <ArrowLeft size={14} aria-hidden="true" /> Terminal
        </Link>
      </header> : null}

      <section className={styles.hero} aria-labelledby="vault-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span /> Season zero · Fixed deck of 100</p>
          <h1 id="vault-title">Gold, cast<br />into chance.</h1>
          <p className={styles.lede}>
            One sealed pull. Five possible relics. Every revealed artefact carries an immutable claim on PAXG deposited before mint.
          </p>
          <div className={styles.heroFacts}>
            <div><small>Pull</small><strong>$35.00</strong><span>USDC</span></div>
            <div><small>Expected backing</small><strong>$29.75</strong><span>85% RTP</span></div>
            <div><small>Batch reserve</small><strong>$2,975</strong><span>in PAXG</span></div>
          </div>
        </div>

        <div className={styles.revealPanel} aria-live="polite" aria-busy={busy}>
          <div className={styles.panelStatus}>
            <span className={styles.simulationBadge}>Simulation</span>
            <span>{status}</span>
          </div>

          <div
            className={`${styles.revealStage} ${styles[`revealStage${phase[0].toUpperCase()}${phase.slice(1)}`]}`}
            data-phase={phase}
            data-rarity={result?.tier.rarity.toLowerCase()}
          >
            <LiquidGoldForm className={styles.liquidField} active={busy} />
            <div className={styles.assaySweep} aria-hidden="true" />
            <div className={styles.moltenVeil} aria-hidden="true"><i /></div>
            <div className={styles.revealBloom} aria-hidden="true" />
            <div className={styles.resultHalo} aria-hidden="true" />
            <RelicArtwork
              tier={(result ?? pendingResult)?.tier}
              image={(result ?? pendingResult)?.image}
              active={phase === "revealed"}
              reveal
            />
            {phase === "idle" ? (
              <div className={styles.sealCopy}>
                <small>HG · GENESIS · 001</small>
                <strong>?</strong>
                <span>Unassayed relic</span>
              </div>
            ) : null}
            {busy ? (
              <div className={styles.processCopy} aria-hidden="true">
                <small>{phase === "shuffling" ? "Ticket secured" : "Claim verified"}</small>
                <strong>{phase === "shuffling" ? "Assaying" : "Unsealing"}</strong>
                <span>{phase === "shuffling" ? "Reading committed deck" : "Releasing numbered relic"}</span>
              </div>
            ) : null}
            {result ? (
              <div className={styles.editionStamp}>
                <span>Genesis edition</span>
                <strong>#{String(result.edition).padStart(3, "0")}</strong>
              </div>
            ) : null}
          </div>

          {result ? (
            <div className={styles.resultCopy}>
              <div>
                <span>{result.tier.rarity} · {tierOddsPct(result.tier)}% of deck</span>
                <h2>{result.tier.name}</h2>
                <p>{result.tier.description}</p>
              </div>
              <div className={styles.redemptionValue}>
                <small>Gold extraction value</small>
                <strong>{USD.format(result.tier.redemptionUsd)}</strong>
                <span>PAXG fixed at vault funding</span>
              </div>
            </div>
          ) : (
            <div className={styles.resultPlaceholder}>
              <span>Result hidden</span>
              <p>The production reveal starts only after all PAXG liabilities are funded.</p>
            </div>
          )}

          <div className={styles.revealActions}>
            <button type="button" onClick={simulatePull} disabled={busy}>
              <Sparkles size={16} aria-hidden="true" />
              {phase === "revealed" ? "Simulate another" : busy ? "Assaying…" : "Simulate $35 pull"}
            </button>
            {phase === "revealed" ? (
              <button className={styles.resetButton} type="button" onClick={reset} aria-label="Reset reveal simulation">
                <RotateCcw size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <p className={styles.disabledNote}><LockKeyhole size={13} aria-hidden="true" /> Payments and minting are disabled in this design preview.</p>
        </div>
      </section>

      <section className={styles.deckSection} aria-labelledby="deck-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}><span /> The assay</p>
            <h2 id="deck-title">One hundred known outcomes.<br />One unknown draw.</h2>
          </div>
          <p>
            The deck composition is committed before sale. Rarity determines both the digital artefact and the amount of PAXG released when it is burned.
          </p>
        </div>

        <div className={styles.tierGrid}>
          {GENESIS_RELIC_TIERS.map((tier, index) => (
            <article className={styles.tierCard} key={tier.id}>
              <div className={styles.cardIndex}>{String(index + 1).padStart(2, "0")}</div>
              <RelicArtwork tier={tier} />
              <div className={styles.cardBody}>
                <span>{tier.rarity}</span>
                <h3>{tier.name}</h3>
                <p>{tier.description}</p>
              </div>
              <dl>
                <div><dt>Deck</dt><dd>{tier.count} / 100</dd></div>
                <div><dt>Chance</dt><dd>{tierOddsPct(tier)}%</dd></div>
                <div><dt>Burn floor</dt><dd>{USD.format(tier.redemptionUsd)}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.ledgerSection} aria-labelledby="ledger-title">
        <div className={styles.ledgerIntro}>
          <p className={styles.eyebrow}><span /> Solvency before spectacle</p>
          <h2 id="ledger-title">The mint comes last.</h2>
          <p>
            A reveal creates a financial liability whether or not an NFT exists yet. The Genesis flow therefore closes escrow, acquires PAXG, and verifies the vault before showing any result.
          </p>
          <div className={styles.guarantee}>
            <ShieldCheck size={22} aria-hidden="true" />
            <div><strong>Required invariant</strong><span>Vault PAXG ≥ every outstanding burn claim</span></div>
          </div>
        </div>

        <div className={styles.ledger}>
          <div className={styles.ledgerHeader}>
            <span>Genesis batch · 001</span>
            <span className={styles.draftState}>Design preview</span>
          </div>
          <div className={styles.flowSteps}>
            {[
              ["01", "Escrow", `${GENESIS_BATCH_SIZE} × ${USD.format(GENESIS_PULL_PRICE_USD)}`],
              ["02", "Acquire", `${USD.format(economy.batchBackingUsd)} of PAXG`],
              ["03", "Verify", "100% collateralized"],
              ["04", "Reveal", "Shuffle committed deck"],
              ["05", "Mint", "Immutable burn claim"],
            ].map(([number, label, detail], index) => (
              <div className={styles.flowStep} key={number}>
                <i>{number}</i>
                <div><strong>{label}</strong><span>{detail}</span></div>
                {index < 4 ? <b aria-hidden="true">→</b> : null}
              </div>
            ))}
          </div>
          <div className={styles.ledgerRows}>
            <div><span>Gross batch proceeds</span><strong>{USD.format(economy.batchRevenueUsd)}</strong></div>
            <div><span>Committed PAXG liability</span><strong>− {USD.format(economy.batchBackingUsd)}</strong></div>
            <div><span>Maximum protocol gross margin</span><strong>{USD.format(economy.grossMarginUsd)}</strong></div>
          </div>
          <div className={styles.reserveBar}>
            <div style={{ width: `${economy.returnToPlayerPct}%` }} />
            <span>85% backing</span><span>15% gross margin</span>
          </div>
        </div>
      </section>

      <section className={styles.redemptionSection} aria-labelledby="redemption-title">
        <div className={styles.redemptionMark}><Flame size={26} aria-hidden="true" /></div>
        <div>
          <p className={styles.eyebrow}><span /> Burn mechanism</p>
          <h2 id="redemption-title">Keep the relic.<br />Or extract the gold.</h2>
        </div>
        <p>
          Burning destroys the collectible and transfers its exact PAXG allocation to the holder in one transaction. A protocol pause must never trap funded redemption claims.
        </p>
        <ul>
          <li><Check size={14} aria-hidden="true" /> Immutable redemption amount</li>
          <li><Check size={14} aria-hidden="true" /> No discretionary rarity premium</li>
          <li><Check size={14} aria-hidden="true" /> No admin access to reserved backing</li>
        </ul>
      </section>

      {!embedded ? <footer className={styles.footer}>
        <div><Coins size={15} aria-hidden="true" /> Hedgents · Programmable metal ownership</div>
        <p>Concept simulation only · No sale, wager, mint, or redemption is active.</p>
      </footer> : null}
    </Root>
  );
}
