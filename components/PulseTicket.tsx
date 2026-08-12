"use client";

import { useMemo, useState } from "react";
import { address, type Instruction } from "@solana/kit";
import { CircleAlert, TrendingDown, TrendingUp } from "lucide-react";
import {
  deriveAssociatedTokenAddress,
  getCreateAssociatedTokenIdempotentInstruction,
  getFillAskInstruction,
  hexToBytes,
} from "@/lib/scarcity-exchange";
import {
  formatPulseAmount,
  formatPulseExact,
  priceMetalPulseTicket,
  PULSE_STAKE_CHOICES,
  PULSE_TOKEN_SCALE,
  type PulseOffer,
} from "@/lib/metal-pulse-ticket";
import { ScarcityWalletTransaction } from "./ScarcityWalletActions";
import styles from "./pulse-market.module.css";

export interface PulseTradeableRound {
  roundId: string;
  marketId: string;
  yesMint: string;
  noMint: string;
  startsAtUnix: number;
  endsAtUnix: number;
  onChain: boolean;
  collateralMint: string | null;
  feeRecipient: string | null;
  paused: boolean | null;
  status: string | null;
  offers: { yes: PulseOffer | null; no: PulseOffer | null };
}

type Side = "yes" | "no";

const SIDES = [
  { side: "yes" as const, label: "Higher", icon: TrendingUp, className: styles.up },
  { side: "no" as const, label: "Lower", icon: TrendingDown, className: styles.down },
];

/**
 * Take a side on a Gold 15 round.
 *
 * The bet is one binary question, so the screen asks for one choice and one stake and then states
 * the cost and the payout in full before anything opens a wallet. Under it this is an ordinary
 * taker fill against a resting ask, but a bettor should never have to know that: no price, no
 * quantity, no order book.
 *
 * Nothing here is quoted from a guess. The offer, the fee and the fill history all come from the
 * chain, and the arithmetic is the program's own, so the number on the button is the number the
 * wallet asks to sign.
 */
export function PulseTicket({
  round,
  cluster,
  marketOpen,
  onConnect,
  onFilled,
}: {
  round: PulseTradeableRound;
  cluster: "devnet" | "mainnet-beta";
  marketOpen: boolean;
  onConnect: () => void;
  onFilled: (signature: string) => void;
}) {
  const [side, setSide] = useState<Side>("yes");
  const [stakeUnits, setStakeUnits] = useState<number>(5);

  const offer = round.offers[side];
  const ticket = useMemo(
    () => (offer ? priceMetalPulseTicket({ offer, stake: BigInt(stakeUnits) * PULSE_TOKEN_SCALE }) : null),
    [offer, stakeUnits],
  );

  const blocked = !marketOpen
    // Selling a side into a frozen feed would be selling a bet that cannot win: the round opens and
    // closes on the same price, ties, and refunds. Better to say so than to take the stake.
    ? "Spot gold is closed, so this round would open and close on the same frozen price. It would tie, settle invalid and refund, so there is nothing to win."
    : !round.onChain
      ? "This round has not been opened on chain yet."
      : round.paused
        ? "The exchange is paused. No new positions can be taken."
        : round.status && round.status !== "unresolved"
          ? "This round is already resolved."
          : !round.collateralMint || !round.feeRecipient
            ? "The round's collateral accounts are unavailable."
            : null;

  return (
    <div className={styles.ticket}>
      <div className={styles.sides} role="radiogroup" aria-label="Pick a side">
        {SIDES.map(({ side: value, label, icon: Icon, className }) => {
          const available = Boolean(round.offers[value]);
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={side === value}
              disabled={!available}
              onClick={() => setSide(value)}
              className={className}
              data-selected={side === value ? "" : undefined}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
              <small>
                {available
                  ? `Pays ${formatPulseAmount(PULSE_TOKEN_SCALE)} per contract if gold closes ${value === "yes" ? "above" : "below"} the open`
                  : "Nobody is offering this side right now"}
              </small>
            </button>
          );
        })}
      </div>

      <div className={styles.stakes} role="radiogroup" aria-label="Pick a stake">
        <span>Stake</span>
        {PULSE_STAKE_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={stakeUnits === choice}
            onClick={() => setStakeUnits(choice)}
            data-selected={stakeUnits === choice ? "" : undefined}
          >
            {choice}
          </button>
        ))}
      </div>

      {!offer ? (
        <p className={styles.muted}>
          There is no resting offer on this side, so it cannot be taken. Try the other side or wait
          for the next round to be quoted.
        </p>
      ) : !ticket ? (
        <p className={styles.muted}>This side is sold out for the round.</p>
      ) : (
        <>
          <dl className={styles.economics}>
            <div><dt>You pay</dt><dd>{formatPulseAmount(ticket.cost, 2, "up")}</dd></div>
            <div><dt>You win</dt><dd data-win="">{formatPulseAmount(ticket.payout)}</dd></div>
            <div><dt>Profit if right</dt><dd data-win="">+{formatPulseAmount(ticket.profit)}</dd></div>
            <div><dt>Loss if wrong</dt><dd data-lose="">−{formatPulseAmount(ticket.cost, 2, "up")}</dd></div>
          </dl>

          {ticket.capped ? (
            <p className={styles.warn}>
              <CircleAlert size={13} aria-hidden="true" />
              Only {formatPulseAmount(ticket.quantity)} contracts are left on this side, so the stake
              was cut to what the offer can actually fill.
            </p>
          ) : null}

          {blocked ? (
            <p className={styles.warn}>
              <CircleAlert size={13} aria-hidden="true" />
              {blocked}
            </p>
          ) : (
            <ScarcityWalletTransaction
              cluster={cluster}
              label={`Bet ${formatPulseAmount(ticket.cost, 2, "up")} on ${side === "yes" ? "Higher" : "Lower"}`}
              reviewTitle={`${side === "yes" ? "Higher" : "Lower"} · ${round.roundId.replace("gold-15m-", "")}`}
              confirmLabel="Continue to wallet"
              review={(
                <dl className={styles.reviewEconomics}>
                  <div><dt>Question</dt><dd>Will gold close {side === "yes" ? "above" : "below"} the round&rsquo;s opening price?</dd></div>
                  <div><dt>Round</dt><dd>{round.roundId}</dd></div>
                  <div><dt>Network</dt><dd>{cluster === "devnet" ? "Solana devnet · test token, no value" : "Solana mainnet"}</dd></div>
                  <div><dt>Contracts</dt><dd>{formatPulseExact(ticket.quantity)}</dd></div>
                  <div><dt>To the maker</dt><dd>{formatPulseExact(ticket.gross)}</dd></div>
                  <div><dt>Protocol fee</dt><dd>{formatPulseExact(ticket.fee)} · {(offer.feeBps / 100).toFixed(2)}%</dd></div>
                  <div><dt>Total debit</dt><dd>{formatPulseExact(ticket.cost)}</dd></div>
                  <div><dt>Pays if right</dt><dd>{formatPulseExact(ticket.payout)}</dd></div>
                  <div>
                    <dt>If the round ties</dt>
                    <dd>It settles invalid and both sides redeem one for one, so the stake comes back.</dd>
                  </div>
                </dl>
              )}
              onConfirmed={onFilled}
              onConnect={onConnect}
              build={async (taker) => {
                const collateralMint = address(round.collateralMint as string);
                const feeRecipient = address(round.feeRecipient as string);
                const outcomeMint = address(side === "yes" ? round.yesMint : round.noMint);
                const maker = address(offer.maker);
                const [takerCollateral] = await deriveAssociatedTokenAddress(taker, collateralMint);
                const [takerOutcome] = await deriveAssociatedTokenAddress(taker, outcomeMint);
                const [makerCollateral] = await deriveAssociatedTokenAddress(maker, collateralMint);
                const instructions: Instruction[] = [
                  // The maker is paid into an associated account and the taker receives contracts
                  // into one. Either may not exist yet, and the creates are idempotent, so this is
                  // cheaper and more reliable than reading first and branching.
                  getCreateAssociatedTokenIdempotentInstruction({
                    payer: taker, owner: maker, mint: collateralMint, associatedToken: makerCollateral,
                  }),
                  getCreateAssociatedTokenIdempotentInstruction({
                    payer: taker, owner: taker, mint: outcomeMint, associatedToken: takerOutcome,
                  }),
                  await getFillAskInstruction({
                    maker,
                    taker,
                    collateralMint,
                    feeRecipient,
                    marketId: hexToBytes(round.marketId),
                    orderId: hexToBytes(offer.orderId),
                    outcomeMint,
                    makerCollateral,
                    takerCollateral,
                    takerOutcome,
                    quantity: ticket.quantity,
                  }),
                ];
                return instructions;
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
