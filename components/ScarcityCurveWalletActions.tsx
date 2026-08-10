"use client";

import {
  AccountRole,
  address,
  type Address,
  type Instruction,
} from "@solana/kit";
import type { ReactNode } from "react";
import { ScarcityWalletTransaction } from "@/components/ScarcityWalletActions";
import type { ScarcityCurveChainState } from "@/hooks/use-scarcity-exchange";
import { parseTokenAmountToBaseUnits } from "@/lib/execution-validation";
import { curveWeight } from "@/lib/scarcity-curve-math";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  deriveAssociatedTokenAddress,
  deriveCurveMarketAddresses,
  SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "@/lib/scarcity-exchange/addresses";
import {
  getAddCurveStakeInstruction,
  getClaimCurvePositionInstruction,
  getOpenCurvePositionInstruction,
  getWithdrawCurveStakeInstruction,
} from "@/lib/scarcity-exchange/instructions";
import styles from "./scarcity-curve-wallet-actions.module.css";

type ConfirmedCallback = (signature: string) => void;

type SharedCurveActionProps = {
  state: ScarcityCurveChainState;
  marketId: string;
  bucket: number;
  displayValue: string;
  unit: string;
  onConnect: () => void;
  onConfirmed: ConfirmedCallback;
};

export type ScarcityCurveStakeActionProps = SharedCurveActionProps & {
  amount: string;
  hasPosition: boolean;
};

export type ScarcityCurveWithdrawActionProps = SharedCurveActionProps & {
  amount: string;
};

export type ScarcityCurveClaimActionProps = SharedCurveActionProps & {
  stake: string;
  claimable: string;
};

function hexToBytes(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("Curve market ID must be a 32-byte hexadecimal value.");
  }
  return Uint8Array.from(
    { length: 32 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function createAssociatedTokenIdempotentInstruction(input: {
  payer: Address;
  owner: Address;
  mint: Address;
  ata: Address;
}): Instruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    accounts: [
      { address: input.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: input.ata, role: AccountRole.WRITABLE },
      { address: input.owner, role: AccountRole.READONLY },
      { address: input.mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    // Associated Token Program: create_idempotent.
    data: Uint8Array.of(1),
  };
}

function displayForecast(value: string, unit: string) {
  return unit ? `${value} ${unit}` : value;
}

function displayBaseUnits(value: string) {
  if (!/^\d+$/.test(value)) return "—";
  const padded = value.padStart(7, "0");
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function displayUtc(epochSeconds: string) {
  const value = Number(epochSeconds);
  if (!Number.isFinite(value)) return "Unavailable";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value * 1_000));
}

function clusterLabel(cluster: ScarcityCurveChainState["deployment"]["cluster"]) {
  return cluster === "mainnet-beta" ? "Solana mainnet" : "Solana devnet";
}

function weightLabel(weight: number, bucketCount: number) {
  const percent = weight / bucketCount * 100;
  return `${weight}/${bucketCount} weight · ${percent.toFixed(percent < 10 ? 1 : 0)}% of maximum`;
}

function assertBucket(state: ScarcityCurveChainState, bucket: number) {
  if (!Number.isInteger(bucket) || bucket < 0 || bucket >= state.market.bucketCount) {
    throw new Error("The selected forecast bucket is outside this market's committed range.");
  }
}

function assertUnresolved(state: ScarcityCurveChainState) {
  if (state.market.status !== "unresolved") {
    throw new Error("This forecast pool is already resolved.");
  }
}

function assertBeforeClose(state: ScarcityCurveChainState) {
  const closesAt = BigInt(state.market.closesAt);
  if (BigInt(Math.floor(Date.now() / 1_000)) >= closesAt) {
    throw new Error("This forecast pool has closed.");
  }
}

async function curveAccounts(
  state: ScarcityCurveChainState,
  marketIdText: string,
  owner: Address,
) {
  if (state.deployment.programAddress !== String(SCARCITY_EXCHANGE_PROGRAM_ADDRESS)) {
    throw new Error("The deployment manifest does not match the reviewed scarcity program.");
  }
  const marketId = hexToBytes(marketIdText);
  const derived = await deriveCurveMarketAddresses(marketId);
  if (
    String(derived.market) !== state.deployment.market
    || String(derived.vault) !== state.deployment.vault
  ) {
    throw new Error("The deployment manifest does not match this curve market's canonical accounts.");
  }
  const collateralMint = address(state.deployment.collateralMint);
  const [ownerCollateral] = await deriveAssociatedTokenAddress(owner, collateralMint);
  return { marketId, collateralMint, ownerCollateral };
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className={styles.facts}>{children}</dl>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function PoolIdentity(props: { children: ReactNode }) {
  return (
    <div className={styles.poolIdentity}>
      <span><i /> Forecast pool position</span>
      <strong>Nontransferable</strong>
      <p>{props.children}</p>
    </div>
  );
}

function PayoutScenarios(props: {
  state: ScarcityCurveChainState;
  bucket: number;
}) {
  const { bucketCount } = props.state.market;
  const adjacentBucket = props.bucket === bucketCount - 1 ? props.bucket - 1 : props.bucket + 1;
  const farthestBucket = props.bucket <= (bucketCount - 1) / 2 ? bucketCount - 1 : 0;
  const exactWeight = curveWeight(props.bucket, props.bucket, bucketCount);
  const adjacentWeight = curveWeight(props.bucket, adjacentBucket, bucketCount);
  const farWeight = curveWeight(props.bucket, farthestBucket, bucketCount);
  return (
    <section className={styles.scenarios} aria-label="Forecast payout scenarios">
      <header>
        <span>Scenario payouts</span>
        <small>Relative weighting, not a guaranteed return</small>
      </header>
      <div>
        <article className={styles.scenarioExact}>
          <i>Exact</i>
          <strong>{weightLabel(exactWeight, bucketCount)}</strong>
          <small>Curve share + eligibility for the capped exact-result jackpot.</small>
        </article>
        <article>
          <i>± 1 bucket</i>
          <strong>{weightLabel(adjacentWeight, bucketCount)}</strong>
          <small>Accuracy-weighted curve share; no exact-result jackpot.</small>
        </article>
        <article>
          <i>Farthest result</i>
          <strong>{weightLabel(farWeight, bucketCount)}</strong>
          <small>The full-support curve keeps a smaller positive weight.</small>
        </article>
      </div>
      <p>
        The exact jackpot targets {(props.state.market.jackpotBps / 100).toFixed(2)}% of the payout pool and is capped at {props.state.market.jackpotLeverageCap}× exact-bucket stake. Actual USDC payout depends on every bucket's final stake.
      </p>
    </section>
  );
}

function ActionShell({ children, note }: { children: ReactNode; note: string }) {
  return <div className={styles.actionShell}>{children}<small className={styles.actionNote}>{note}</small></div>;
}

export function ScarcityCurveStakeAction(props: ScarcityCurveStakeActionProps) {
  const action = props.hasPosition ? "Add stake" : "Open forecast";
  const forecast = displayForecast(props.displayValue, props.unit);
  return (
    <ActionShell note="USDC enters the fully collateralized forecast pool.">
      <ScarcityWalletTransaction
        cluster={props.state.deployment.cluster}
        label={props.hasPosition ? "Review added stake" : "Review forecast"}
        reviewTitle={`${action} at ${forecast}`}
        confirmLabel={props.hasPosition ? "Add USDC stake" : "Open pool position"}
        onConnect={props.onConnect}
        onConfirmed={props.onConfirmed}
        review={<div className={styles.reviewBody}>
          <PoolIdentity>
            This position records your forecast and USDC stake in the program. It is not a token and cannot be transferred or resold.
          </PoolIdentity>
          <Facts>
            <Fact label="Network">{clusterLabel(props.state.deployment.cluster)}</Fact>
            <Fact label="Forecast">{forecast} · bucket {props.bucket + 1}/{props.state.market.bucketCount}</Fact>
            <Fact label={props.hasPosition ? "Additional stake" : "Stake"}>{props.amount || "—"} USDC</Fact>
            <Fact label="Pool closes">{displayUtc(props.state.market.closesAt)}</Fact>
          </Facts>
          <PayoutScenarios state={props.state} bucket={props.bucket} />
        </div>}
        build={async (owner) => {
          if (props.state.deployment.paused) {
            throw new Error("New curve stakes are paused by the protocol administrator.");
          }
          assertUnresolved(props.state);
          assertBeforeClose(props.state);
          assertBucket(props.state, props.bucket);
          const opensAt = BigInt(props.state.market.opensAt);
          if (BigInt(Math.floor(Date.now() / 1_000)) < opensAt) {
            throw new Error("This forecast pool has not opened yet.");
          }
          const accounts = await curveAccounts(props.state, props.marketId, owner);
          const amount = BigInt(parseTokenAmountToBaseUnits(props.amount, 6, "USDC stake"));
          const instruction = props.hasPosition
            ? getAddCurveStakeInstruction({
              owner,
              collateralMint: accounts.collateralMint,
              ownerCollateral: accounts.ownerCollateral,
              marketId: accounts.marketId,
              bucket: props.bucket,
              amount,
            })
            : getOpenCurvePositionInstruction({
              owner,
              collateralMint: accounts.collateralMint,
              ownerCollateral: accounts.ownerCollateral,
              marketId: accounts.marketId,
              bucket: props.bucket,
              amount,
            });
          return [await instruction];
        }}
      />
    </ActionShell>
  );
}

export function ScarcityCurveWithdrawAction(props: ScarcityCurveWithdrawActionProps) {
  const forecast = displayForecast(props.displayValue, props.unit);
  return (
    <ActionShell note="Available only before the committed close time.">
      <ScarcityWalletTransaction
        cluster={props.state.deployment.cluster}
        label="Review withdrawal"
        reviewTitle={`Withdraw from ${forecast}`}
        confirmLabel="Withdraw USDC"
        onConnect={props.onConnect}
        onConfirmed={props.onConfirmed}
        review={<div className={styles.reviewBody}>
          <PoolIdentity>
            This nontransferable forecast stays open with any stake left behind. The withdrawn portion stops participating in every payout scenario.
          </PoolIdentity>
          <Facts>
            <Fact label="Network">{clusterLabel(props.state.deployment.cluster)}</Fact>
            <Fact label="Forecast">{forecast} · bucket {props.bucket + 1}/{props.state.market.bucketCount}</Fact>
            <Fact label="Returned now">{props.amount || "—"} USDC</Fact>
            <Fact label="Pool closes">{displayUtc(props.state.market.closesAt)}</Fact>
          </Facts>
          <section className={styles.withdrawImpact}>
            <span>Payout impact</span>
            <strong>Withdrawn stake earns no curve or jackpot payout.</strong>
            <p>Only the position's remaining onchain stake participates when the numerical result is resolved.</p>
          </section>
        </div>}
        build={async (owner) => {
          assertUnresolved(props.state);
          assertBeforeClose(props.state);
          assertBucket(props.state, props.bucket);
          const accounts = await curveAccounts(props.state, props.marketId, owner);
          const amount = BigInt(parseTokenAmountToBaseUnits(props.amount, 6, "USDC withdrawal"));
          return [
            createAssociatedTokenIdempotentInstruction({
              payer: owner,
              owner,
              mint: accounts.collateralMint,
              ata: accounts.ownerCollateral,
            }),
            await getWithdrawCurveStakeInstruction({
              owner,
              collateralMint: accounts.collateralMint,
              ownerCollateral: accounts.ownerCollateral,
              marketId: accounts.marketId,
              bucket: props.bucket,
              amount,
            }),
          ];
        }}
      />
    </ActionShell>
  );
}

export function ScarcityCurveClaimAction(props: ScarcityCurveClaimActionProps) {
  const forecast = displayForecast(props.displayValue, props.unit);
  const stake = displayBaseUnits(props.stake);
  const claimable = displayBaseUnits(props.claimable);
  const invalid = props.state.market.status === "invalid";
  const distance = invalid ? null : Math.abs(props.bucket - props.state.market.winningBucket);
  const outcomeLabel = invalid
    ? "Invalid market · one-for-one stake refund"
    : distance === 0
      ? "Exact result · curve share + capped jackpot"
      : `${distance} bucket${distance === 1 ? "" : "s"} from result · curve share`;
  return (
    <ActionShell note="A position can be claimed once after resolution.">
      <ScarcityWalletTransaction
        cluster={props.state.deployment.cluster}
        label="Review claim"
        reviewTitle={`Claim ${claimable} USDC`}
        confirmLabel="Claim to wallet"
        onConnect={props.onConnect}
        onConfirmed={props.onConfirmed}
        review={<div className={styles.reviewBody}>
          <PoolIdentity>
            Claiming settles this nontransferable forecast position. The program marks it claimed permanently; no forecast token is minted.
          </PoolIdentity>
          <Facts>
            <Fact label="Network">{clusterLabel(props.state.deployment.cluster)}</Fact>
            <Fact label="Forecast">{forecast} · bucket {props.bucket + 1}/{props.state.market.bucketCount}</Fact>
            <Fact label="Original stake">{stake} USDC</Fact>
            <Fact label="Resolved scenario">{outcomeLabel}</Fact>
            <Fact label="Claimable now"><strong className={styles.claimable}>{claimable} USDC</strong></Fact>
          </Facts>
          <section className={styles.claimOutcome}>
            <span>{invalid ? "Refund payout" : "Resolved payout"}</span>
            <strong>{claimable} USDC to your Solana wallet</strong>
            <p>{invalid ? "The invalid-market rule returns recorded stake one for one." : "This amount is fixed by the resolved pool totals, linear accuracy weight, and exact-jackpot rule."}</p>
          </section>
        </div>}
        build={async (owner) => {
          if (props.state.market.status === "unresolved") {
            throw new Error("This forecast pool has not resolved yet.");
          }
          assertBucket(props.state, props.bucket);
          const accounts = await curveAccounts(props.state, props.marketId, owner);
          return [
            createAssociatedTokenIdempotentInstruction({
              payer: owner,
              owner,
              mint: accounts.collateralMint,
              ata: accounts.ownerCollateral,
            }),
            await getClaimCurvePositionInstruction({
              owner,
              collateralMint: accounts.collateralMint,
              ownerCollateral: accounts.ownerCollateral,
              marketId: accounts.marketId,
              bucket: props.bucket,
            }),
          ];
        }}
      />
    </ActionShell>
  );
}
