"use client";

import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useCctpFunding } from "@/hooks/use-cctp-funding";
import {
  CCTP_SOURCES,
  type CctpSourceId,
  formatUsdcBaseUnits,
  solanaExplorerTransaction,
  sourceExplorerTransaction,
  totalCctpFeesBaseUnits,
} from "@/lib/rail-cctp";
import styles from "./metal-terminal.module.css";

interface CctpFundingPanelProps {
  sourceId: CctpSourceId;
  amountUsd: string;
  sourceAddress: string;
  destinationAddress: string;
  productName: string;
  ticker: string;
  allowNewFunding: boolean;
  canContinueToMetal: boolean;
  onFunded: (receivedAmountBaseUnits: string) => void;
  onClose: () => void;
}

export function CctpFundingPanel({
  sourceId,
  amountUsd,
  sourceAddress,
  destinationAddress,
  productName,
  ticker,
  allowNewFunding,
  canContinueToMetal,
  onFunded,
  onClose,
}: CctpFundingPanelProps) {
  const source = CCTP_SOURCES[sourceId];
  const { state, hydrated, quoteFunding, executeFunding, reset } = useCctpFunding({
    sourceId,
    amountUsd,
    sourceAddress,
    destinationAddress,
    allowNewFunding,
  });
  const [riskAccepted, setRiskAccepted] = useState(false);
  const quote = state.quote;
  const isWalletBusy = state.phase === "approval" || state.phase === "funding";
  const minimumFundsPurchase = quote
    ? BigInt(quote.funding.minimumOutput.amountBaseUnits) >= 10_000_000n
    : false;

  useEffect(() => {
    if (allowNewFunding && hydrated && state.phase === "idle") void quoteFunding();
  }, [allowNewFunding, hydrated, quoteFunding, state.phase]);

  const retry = () => {
    reset();
    setRiskAccepted(false);
    void quoteFunding();
  };

  const sourceTxUrl = state.reference
    ? sourceExplorerTransaction(sourceId, state.reference.txId)
    : null;
  const destinationTxUrl = state.status?.destinationReference
    ? solanaExplorerTransaction(state.status.destinationReference.txId)
    : null;

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={isWalletBusy ? undefined : onClose}>
      <section
        className={styles.fundingPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="funding-panel-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {state.phase === "completed" && state.status?.received ? (
          <div className={styles.confirmedState}>
            <span><CheckCircle2 size={26} aria-hidden="true" /></span>
            <p className={styles.overline}>Circle CCTP V2 / RPC verified</p>
            <h2>Solana USDC arrived.</h2>
            <p>
              The Rail SDK matched the source burn to Circle&apos;s exact Solana delivery transaction
              and measured the credit to your wallet. {canContinueToMetal
                ? "The metal swap is still a separate approval."
                : "Metal execution is paused; the delivered USDC remains in your wallet."}
            </p>
            <div>
              <small>Verified purchase balance</small>
              <strong>{formatUsdcBaseUnits(state.status.received.amountBaseUnits)} USDC</strong>
              <span>Ready for {productName} · {ticker}</span>
            </div>
            <div className={styles.fundingLinks}>
              {sourceTxUrl ? (
                <a href={sourceTxUrl} target="_blank" rel="noreferrer">
                  Source burn <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : null}
              {destinationTxUrl ? (
                <a href={destinationTxUrl} target="_blank" rel="noreferrer">
                  Solana delivery <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : null}
            </div>
            <button
              type="button"
              className={styles.reviewButton}
              onClick={canContinueToMetal
                ? () => onFunded(state.status!.received!.amountBaseUnits)
                : onClose}
            >
              {canContinueToMetal ? "Continue to metal quote" : "Return to terminal"} <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        ) : state.phase === "quoting" || !hydrated ? (
          <div className={styles.fundingProgress}>
            <span className={styles.progressPulse}><RefreshCw className={styles.spin} size={24} aria-hidden="true" /></span>
            <p className={styles.overline}>Rail SDK / live CCTP quote</p>
            <h2>Pricing the funding leg.</h2>
            <p>Reading Circle&apos;s forwarding fee and checking whether your Solana USDC account needs setup.</p>
          </div>
        ) : state.phase === "approval" || state.phase === "funding" || state.phase === "confirming" ? (
          <div className={styles.fundingProgress}>
            <span className={styles.progressPulse}>
              {state.phase === "confirming" ? <Clock3 size={24} aria-hidden="true" /> : <RefreshCw className={styles.spin} size={24} aria-hidden="true" />}
            </span>
            <p className={styles.overline}>
              {state.phase === "approval"
                ? "Wallet step 1 of 2"
                : state.phase === "funding"
                  ? "Wallet step 2 of 2"
                  : "Circle delivery / verifying"}
            </p>
            <h2>
              {state.phase === "approval"
                ? "Approve the exact amount."
                : state.phase === "funding"
                  ? "Send USDC to Solana."
                  : "Waiting for verified delivery."}
            </h2>
            <p>
              {state.phase === "approval"
                ? "The allowance equals this transfer only; the SDK never requests unlimited approval."
                : state.phase === "funding"
                  ? "Circle burns native USDC on the source chain and forwards native USDC to your Solana wallet."
                  : state.status?.detail ?? "A source signature is not settlement. Hedgents waits for the SDK to verify the exact Solana credit."}
            </p>
            {sourceTxUrl ? (
              <a href={sourceTxUrl} target="_blank" rel="noreferrer">
                View source transaction <ExternalLink size={12} aria-hidden="true" />
              </a>
            ) : null}
            {state.error ? (
              <div className={styles.executionError} role="status">
                <CircleAlert size={15} aria-hidden="true" />
                <span><strong>Verification retrying</strong>{state.error}</span>
              </div>
            ) : null}
            {state.phase === "confirming" ? (
              <button type="button" className={styles.secondaryModalButton} onClick={onClose}>
                Close — resume verification later
              </button>
            ) : null}
          </div>
        ) : state.phase === "failed" ? (
          <div className={styles.fundingProgress}>
            <span className={styles.progressPulse}><CircleAlert size={25} aria-hidden="true" /></span>
            <p className={styles.overline}>Funding stopped safely</p>
            <h2>No metal order was placed.</h2>
            <p>{state.error ?? "The CCTP funding route could not be prepared."}</p>
            {state.approvalTxId ? (
              <a href={sourceExplorerTransaction(sourceId, state.approvalTxId)} target="_blank" rel="noreferrer">
                Inspect exact approval <ExternalLink size={12} aria-hidden="true" />
              </a>
            ) : null}
            {sourceTxUrl ? (
              <a href={sourceTxUrl} target="_blank" rel="noreferrer">
                Inspect source burn <ExternalLink size={12} aria-hidden="true" />
              </a>
            ) : null}
            {allowNewFunding && !state.reference ? (
              <button type="button" className={styles.reviewButton} onClick={retry}>
                Build a fresh funding quote <RefreshCw size={14} aria-hidden="true" />
              </button>
            ) : null}
            <button type="button" className={styles.secondaryModalButton} onClick={onClose}>
              Return to terminal
            </button>
          </div>
        ) : quote && allowNewFunding ? (
          <>
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.overline}>External Rail SDK / two-phase purchase</p>
                <h2 id="funding-panel-title">Fund {ticker} from {source.label}</h2>
              </div>
              <button type="button" onClick={onClose} aria-label="Close CCTP funding review">
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <div className={styles.fundingJourney} aria-label="Cross-chain funding journey">
              <span><i>01</i><small>Source</small><strong>{amountUsd} native USDC<br />{source.label}</strong></span>
              <ArrowRight size={16} aria-hidden="true" />
              <span><i>02</i><small>Funding</small><strong>Circle CCTP V2<br />Forwarding Service</strong></span>
              <ArrowRight size={16} aria-hidden="true" />
              <span><i>03</i><small>Destination</small><strong>{formatUsdcBaseUnits(quote.funding.minimumOutput.amountBaseUnits)} USDC min.<br />Your Solana wallet</strong></span>
            </div>

            <dl className={styles.reviewCosts}>
              <div><dt>Source asset</dt><dd>Native USDC · {source.label}</dd></div>
              <div><dt>Destination</dt><dd>{destinationAddress.slice(0, 5)}…{destinationAddress.slice(-4)}</dd></div>
              <div><dt>Circle + forwarding fees</dt><dd>{formatUsdcBaseUnits(totalCctpFeesBaseUnits(quote))} USDC</dd></div>
              <div><dt>Minimum delivered</dt><dd>{formatUsdcBaseUnits(quote.funding.minimumOutput.amountBaseUnits)} USDC</dd></div>
              <div><dt>Estimated delivery</dt><dd>~{quote.totalEtaSeconds}s after source confirmation</dd></div>
              <div><dt>Quote expires</dt><dd>{new Date(quote.expiresAt).toLocaleTimeString()}</dd></div>
              <div><dt>Wallet approvals</dt><dd>2 on {source.label}</dd></div>
              <div><dt>Metal swap</dt><dd>Separate Solana approval after delivery</dd></div>
            </dl>

            <div className={styles.reviewWarnings}>
              <ShieldCheck size={16} aria-hidden="true" />
              <div>
                <p>
                  {source.disclosure} This moves native USDC only; it does not make the CCTP leg and
                  the later Jupiter purchase atomic.
                </p>
                {!minimumFundsPurchase ? (
                  <p>The guaranteed Solana output is below the terminal&apos;s $10 minimum metal order. Increase the funding amount before signing.</p>
                ) : null}
                <label className={styles.eligibilityCheck}>
                  <input
                    type="checkbox"
                    checked={riskAccepted}
                    onChange={(event) => setRiskAccepted(event.target.checked)}
                  />
                  <span>I understand this is an alpha, two-phase mainnet transfer and each wallet request is a real transaction.</span>
                </label>
              </div>
            </div>

            <button
              type="button"
              className={styles.reviewButton}
              onClick={() => void executeFunding()}
              disabled={!riskAccepted || !minimumFundsPurchase}
            >
              {!minimumFundsPurchase
                ? "Increase amount to fund the metal order"
                : riskAccepted
                  ? "Approve exact USDC funding"
                  : "Acknowledge alpha risk to continue"}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </>
        ) : !allowNewFunding ? (
          <div className={styles.fundingProgress}>
            <span className={styles.progressPulse}><ShieldCheck size={25} aria-hidden="true" /></span>
            <p className={styles.overline}>Terminal funding gate</p>
            <h2>New Rail funding is paused.</h2>
            <p>No wallet transaction was requested. A previously broadcast source burn remains recoverable from this browser.</p>
            <button type="button" className={styles.secondaryModalButton} onClick={onClose}>
              Return to terminal
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
