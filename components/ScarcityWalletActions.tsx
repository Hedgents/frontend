"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  pipe,
  signature,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
  type Address,
  type Instruction,
} from "@solana/kit";
import type { UiWalletAccount } from "@wallet-standard/ui";
import { useClient, useWalletAccountTransactionSendingSigner } from "@solana/react";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import type { AppSolanaClient } from "@/app/providers";
import { parseTokenAmountToBaseUnits } from "@/lib/execution-validation";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  deriveAssociatedTokenAddress,
  SYSTEM_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "@/lib/scarcity-exchange/addresses";
import {
  getCancelOrderInstruction,
  getFillAskInstruction,
  getFillBidInstruction,
  getMergeCompleteSetInstruction,
  getMintCompleteSetInstruction,
  getPlaceOrderInstruction,
  getRedeemInstruction,
} from "@/lib/scarcity-exchange/instructions";
import type { ScarcityBookOrder, ScarcityChainState } from "@/hooks/use-scarcity-exchange";
import {
  SCARCITY_PENDING_EVENT,
  SCARCITY_PENDING_STORAGE_KEY,
  parseScarcityPendingTransactions,
  removeScarcityPendingTransaction,
  upsertScarcityPendingTransaction,
  type ScarcityPendingTransaction,
} from "@/lib/scarcity-pending-transactions";
import styles from "./scarcity-wallet-actions.module.css";

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "The wallet transaction did not complete.";
}

function parsePriceMicroUsdc(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,3}(?:\.\d{1,4})?$/.test(normalized)) throw new Error("Enter a limit price from 0.0001 to 100 cents.");
  const [whole, fraction = ""] = normalized.split(".");
  const price = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0"));
  if (price <= 0n || price > 1_000_000n) throw new Error("Enter a limit price from 0.0001 to 100 cents.");
  return price;
}

function hexToBytes(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("Expected a 32-byte hexadecimal value.");
  return Uint8Array.from({ length: 32 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

async function orderId(owner: string) {
  const bytes = new TextEncoder().encode(`${owner}:${Date.now()}:${crypto.randomUUID()}`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function associatedTokenInstruction(input: { payer: Address; owner: Address; mint: Address; ata: Address }): Instruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    accounts: [
      { address: input.payer, role: 3 },
      { address: input.ata, role: 1 },
      { address: input.owner, role: 0 },
      { address: input.mint, role: 0 },
      { address: SYSTEM_PROGRAM_ADDRESS, role: 0 },
      { address: TOKEN_PROGRAM_ADDRESS, role: 0 },
    ],
    data: Uint8Array.of(1),
  };
}

function rpcUrl(cluster: ScarcityChainState["deployment"]["cluster"]) {
  if (cluster === "devnet") {
    return process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL
      ?? (process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet" ? process.env.NEXT_PUBLIC_SOLANA_RPC_URL : undefined)
      ?? "https://api.devnet.solana.com";
  }
  return process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL
    ?? (process.env.NEXT_PUBLIC_SOLANA_CLUSTER !== "devnet" ? process.env.NEXT_PUBLIC_SOLANA_RPC_URL : undefined)
    ?? "https://api.mainnet-beta.solana.com";
}

function clusterLabel(cluster: ScarcityChainState["deployment"]["cluster"]) {
  return cluster === "mainnet-beta" ? "Solana mainnet" : "Solana devnet";
}

function humanTokenAmount(value: string, decimals = 6) {
  if (!/^\d+$/.test(value)) return "—";
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
}

function readPendingTransactions() {
  return parseScarcityPendingTransactions(window.localStorage.getItem(SCARCITY_PENDING_STORAGE_KEY));
}

function writePendingTransactions(records: ScarcityPendingTransaction[]) {
  window.localStorage.setItem(SCARCITY_PENDING_STORAGE_KEY, JSON.stringify(records));
  window.dispatchEvent(new Event(SCARCITY_PENDING_EVENT));
}

function savePendingTransaction(record: ScarcityPendingTransaction) {
  writePendingTransactions(upsertScarcityPendingTransaction(readPendingTransactions(), record));
}

function deletePendingTransaction(transactionSignature: string) {
  writePendingTransactions(removeScarcityPendingTransaction(readPendingTransactions(), transactionSignature));
}

function readableDate(epochSeconds: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(Number(epochSeconds) * 1_000));
}

function ReviewRows({ rows, notice }: { rows: Array<[string, ReactNode]>; notice?: string }) {
  return <>
    <dl className={styles.reviewRows}>
      {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    {notice ? <p className={styles.reviewNotice}>{notice}</p> : null}
  </>;
}

type ConnectedActionProps = {
  cluster: ScarcityChainState["deployment"]["cluster"];
  build: (owner: Address) => Promise<Instruction[]>;
  idleLabel: string;
  reviewTitle: string;
  review: ReactNode;
  confirmLabel?: string;
  onConfirmed: (signature: string) => void;
};

function ConnectedAction(props: ConnectedActionProps) {
  const client = useClient<AppSolanaClient>();
  const connected = useConnectedWallet(client);
  if (!connected) return null;
  return <SignedAction {...props} account={connected.account} />;
}

function SignedAction(props: ConnectedActionProps & { account: UiWalletAccount }) {
  const chain = props.cluster === "devnet" ? "solana:devnet" : "solana:mainnet";
  const signer = useWalletAccountTransactionSendingSigner(props.account, chain);
  const [phase, setPhase] = useState<"idle" | "simulating" | "signing" | "confirming" | "done">("idle");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactionSignatureText, setTransactionSignatureText] = useState<string | null>(null);
  const [simulationUnits, setSimulationUnits] = useState<string | null>(null);

  async function execute() {
    setReviewOpen(false);
    setError(null);
    setTransactionSignatureText(null);
    setPhase("simulating");
    let submittedSignature: string | null = null;
    let definitivelyFailed = false;
    try {
      const rpc = createSolanaRpc(rpcUrl(props.cluster));
      const instructions = await props.build(signer.address);
      const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (current) => setTransactionMessageFeePayerSigner(signer, current),
        (current) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, current),
        (current) => appendTransactionMessageInstructions(instructions, current),
      );
      const wireTransaction = getBase64EncodedWireTransaction(compileTransaction(message));
      const simulation = await rpc.simulateTransaction(wireTransaction, {
        encoding: "base64",
        sigVerify: false,
        commitment: "processed",
      }).send();
      if (simulation.value.err) {
        const programLog = simulation.value.logs?.slice(-4).join(" · ");
        throw new Error(`Pre-sign simulation failed: ${JSON.stringify(simulation.value.err)}${programLog ? ` · ${programLog}` : ""}`);
      }
      setSimulationUnits(simulation.value.unitsConsumed === undefined ? "passed" : `${simulation.value.unitsConsumed.toString()} CU`);
      setPhase("signing");
      const signatureBytes = await signAndSendTransactionMessageWithSigners(message);
      const transactionSignature = getBase58Decoder().decode(signatureBytes);
      submittedSignature = transactionSignature;
      setTransactionSignatureText(transactionSignature);
      savePendingTransaction({
        schemaVersion: "1.0.0",
        signature: transactionSignature,
        cluster: props.cluster,
        wallet: String(signer.address),
        label: props.reviewTitle,
        submittedAt: new Date().toISOString(),
        state: "pending",
        lastCheckedAt: null,
        error: null,
      });
      setPhase("confirming");
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const statuses = await rpc.getSignatureStatuses([signature(transactionSignature)]).send();
        const status = statuses.value[0];
        if (status?.err) {
          definitivelyFailed = true;
          throw new Error("Solana rejected the transaction.");
        }
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
          deletePendingTransaction(transactionSignature);
          setPhase("done");
          props.onConfirmed(transactionSignature);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      throw new Error("The transaction was sent but confirmation is still pending. Check the signature in Explorer.");
    } catch (caught) {
      const message = errorMessage(caught);
      if (submittedSignature) {
        const current = readPendingTransactions().find((record) => record.signature === submittedSignature);
        if (current) savePendingTransaction({
          ...current,
          state: definitivelyFailed ? "failed" : "pending",
          lastCheckedAt: new Date().toISOString(),
          error: definitivelyFailed ? message : "Confirmation is unavailable; verify the signature before retrying.",
        });
      }
      setError(message);
      setPhase("idle");
    }
  }

  return (
    <div data-scarcity-wallet-action>
      <button type="button" onClick={() => setReviewOpen(true)} disabled={phase === "simulating" || phase === "signing" || phase === "confirming"}>
        {phase === "simulating" ? "Simulating…" : phase === "signing" ? "Approve in wallet" : phase === "confirming" ? "Confirming…" : phase === "done" ? "Confirmed" : props.idleLabel}
      </button>
      {simulationUnits ? <small>Pre-sign simulation {simulationUnits}</small> : null}
      {transactionSignatureText ? <small>Signature {transactionSignatureText.slice(0, 8)}…{transactionSignatureText.slice(-6)}</small> : null}
      {error ? <small role="alert">{error}</small> : null}
      {reviewOpen ? <div className={styles.reviewOverlay} role="presentation" onMouseDown={() => setReviewOpen(false)}>
        <section
          className={styles.reviewDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="scarcity-review-title"
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") setReviewOpen(false);
          }}
        >
          <header>
            <div><span>Review transaction</span><h2 id="scarcity-review-title">{props.reviewTitle}</h2></div>
            <button type="button" autoFocus onClick={() => setReviewOpen(false)} aria-label="Close transaction review">×</button>
          </header>
          {props.review}
          <div className={styles.reviewSafety}><strong>Wallet is the final authority.</strong><span>Confirm the network, amounts, and wallet simulation before signing. Network fees and token-account rent may apply.</span></div>
          <footer>
            <button type="button" onClick={() => setReviewOpen(false)}>Back</button>
            <button type="button" onClick={() => void execute()}>{props.confirmLabel ?? "Continue to wallet"}</button>
          </footer>
        </section>
      </div> : null}
    </div>
  );
}

export function ScarcityTransactionRecovery(props: {
  wallet: string | null;
  onRecovered?: () => void;
}) {
  const [records, setRecords] = useState<ScarcityPendingTransaction[]>([]);
  const [checking, setChecking] = useState(false);

  const reload = useCallback(() => {
    const all = readPendingTransactions();
    setRecords(props.wallet ? all.filter((record) => record.wallet === props.wallet) : []);
  }, [props.wallet]);

  const verify = useCallback(async () => {
    if (!props.wallet) return;
    const all = readPendingTransactions();
    const walletRecords = all.filter((record) => record.wallet === props.wallet);
    if (!walletRecords.length) {
      setRecords([]);
      return;
    }
    setChecking(true);
    let next = all;
    let recovered = false;
    try {
      for (const cluster of ["devnet", "mainnet-beta"] as const) {
        const clusterRecords = walletRecords.filter((record) => record.cluster === cluster && record.state === "pending");
        if (!clusterRecords.length) continue;
        const rpc = createSolanaRpc(rpcUrl(cluster));
        const statuses = await rpc.getSignatureStatuses(
          clusterRecords.map((record) => signature(record.signature)),
          { searchTransactionHistory: true },
        ).send();
        clusterRecords.forEach((record, index) => {
          const status = statuses.value[index];
          if (status?.err) {
            next = upsertScarcityPendingTransaction(next, {
              ...record,
              state: "failed",
              lastCheckedAt: new Date().toISOString(),
              error: "Solana reported that this transaction failed.",
            });
          } else if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
            next = removeScarcityPendingTransaction(next, record.signature);
            recovered = true;
          } else {
            next = upsertScarcityPendingTransaction(next, { ...record, lastCheckedAt: new Date().toISOString() });
          }
        });
      }
      writePendingTransactions(next);
      setRecords(next.filter((record) => record.wallet === props.wallet));
      if (recovered) props.onRecovered?.();
    } finally {
      setChecking(false);
    }
  }, [props.wallet, props.onRecovered]);

  useEffect(() => {
    reload();
    window.addEventListener(SCARCITY_PENDING_EVENT, reload);
    return () => window.removeEventListener(SCARCITY_PENDING_EVENT, reload);
  }, [reload]);

  useEffect(() => {
    void verify();
  }, [verify]);

  if (!records.length) return null;
  return <aside className={styles.recoveryPanel} aria-live="polite">
    <div><strong>Scarcity transaction recovery</strong><span>{records.length} wallet submission{records.length === 1 ? "" : "s"} need verification after reload.</span></div>
    <div className={styles.recoveryRows}>{records.map((record) => <div key={record.signature}>
      <span><strong>{record.label}</strong><small>{record.state === "failed" ? record.error : "Awaiting Solana confirmation"}</small></span>
      <a href={`https://explorer.solana.com/tx/${record.signature}${record.cluster === "devnet" ? "?cluster=devnet" : ""}`} target="_blank" rel="noreferrer">Explorer</a>
      {record.state === "failed" ? <button type="button" onClick={() => { deletePendingTransaction(record.signature); reload(); }}>Dismiss</button> : null}
    </div>)}</div>
    <button type="button" onClick={() => void verify()} disabled={checking}>{checking ? "Verifying…" : "Verify now"}</button>
  </aside>;
}

export function ScarcityOrderSubmit(props: {
  state: ScarcityChainState;
  marketId: string;
  outcome: "YES" | "NO";
  orderSide: "BUY" | "SELL";
  price: string;
  quantity: string;
  onConfirmed: (signature: string) => void;
  onConnect: () => void;
}) {
  const client = useClient<AppSolanaClient>();
  const connected = useConnectedWallet(client);
  if (!connected) return <button type="button" onClick={props.onConnect}>Connect wallet to trade</button>;
  const priceCents = Number(props.price) || 0;
  const quantity = Number(props.quantity) || 0;
  const gross = priceCents / 100 * quantity;
  const fee = gross * props.state.deployment.tradingFeeBps / 10_000;
  return (
    <ConnectedAction
      cluster={props.state.deployment.cluster}
      idleLabel={`Review ${props.orderSide.toLowerCase()}`}
      reviewTitle={`${props.orderSide} ${props.outcome} limit order`}
      confirmLabel="Sign order"
      review={<ReviewRows rows={[
        ["Network", clusterLabel(props.state.deployment.cluster)],
        ["Order", `${props.orderSide} ${props.quantity || "—"} ${props.outcome} @ ${props.price || "—"}¢`],
        [props.orderSide === "BUY" ? "Maximum spend" : "Expected proceeds", money(props.orderSide === "BUY" ? gross + fee : Math.max(0, gross - fee))],
        ["Protocol fee", `${money(fee)} · ${(props.state.deployment.tradingFeeBps / 100).toFixed(2)}%`],
        ["Expires", readableDate(props.state.market.closesAt)],
      ]} notice={props.orderSide === "BUY" ? "USDC is escrowed when the order is placed." : `${props.outcome} contracts are escrowed when the order is placed.`} />}
      onConfirmed={props.onConfirmed}
      build={async (owner) => {
        if (props.state.deployment.paused) throw new Error("New scarcity orders are paused by the protocol administrator.");
        if (props.state.market.status !== "unresolved") throw new Error("This market is already resolved.");
        const closesAt = BigInt(props.state.market.closesAt);
        const now = BigInt(Math.floor(Date.now() / 1_000));
        if (closesAt <= now + 30n) throw new Error("This market is closed or too close to closing.");
        const marketId = hexToBytes(props.marketId);
        const outcomeMint = address(props.outcome === "YES" ? props.state.deployment.yesMint : props.state.deployment.noMint);
        const collateralMint = address(props.state.deployment.collateralMint);
        const [source] = await deriveAssociatedTokenAddress(owner, props.orderSide === "BUY" ? collateralMint : outcomeMint);
        const quantityBaseUnits = BigInt(parseTokenAmountToBaseUnits(props.quantity, 6, `${props.outcome} contracts`));
        const instructions: Instruction[] = [];
        if (props.orderSide === "BUY") {
          const [outcomeAta] = await deriveAssociatedTokenAddress(owner, outcomeMint);
          instructions.push(associatedTokenInstruction({ payer: owner, owner, mint: outcomeMint, ata: outcomeAta }));
        }
        instructions.push(await getPlaceOrderInstruction({
          maker: owner,
          collateralMint,
          feeRecipient: address(props.state.deployment.feeRecipient),
          marketId,
          orderId: await orderId(String(owner)),
          outcomeMint,
          makerSource: source,
          side: props.orderSide === "BUY" ? "bid" : "ask",
          priceMicroUsdc: parsePriceMicroUsdc(props.price),
          quantity: quantityBaseUnits,
          expiresAt: closesAt - 1n,
        }));
        return instructions;
      }}
    />
  );
}

export function ScarcityOrderFill(props: {
  state: ScarcityChainState;
  marketId: string;
  order: ScarcityBookOrder;
  onConfirmed: () => void;
  onConnect: () => void;
}) {
  const client = useClient<AppSolanaClient>();
  const connected = useConnectedWallet(client);
  const [fillQuantity, setFillQuantity] = useState(humanTokenAmount(props.order.remainingQuantity));
  if (!connected) return <button type="button" onClick={props.onConnect}>Connect</button>;
  const quantity = Number(fillQuantity) || 0;
  const gross = Number(props.order.priceMicroUsdc) / 1_000_000 * quantity;
  const fee = gross * props.order.feeBps / 10_000;
  const takerAction = props.order.side === "ask" ? "Buy" : "Sell";
  return (
    <ConnectedAction
      cluster={props.state.deployment.cluster}
      idleLabel="Review fill"
      reviewTitle={`${takerAction} ${props.order.outcome.toUpperCase()} from order`}
      confirmLabel="Sign fill"
      review={<>
        <label className={styles.fillInput}><span>Fill quantity</span><input value={fillQuantity} onChange={(event) => setFillQuantity(event.target.value)} inputMode="decimal" /><small>Maximum {humanTokenAmount(props.order.remainingQuantity)} contracts</small></label>
        <ReviewRows rows={[
          ["Network", clusterLabel(props.state.deployment.cluster)],
          ["Price", `${(Number(props.order.priceMicroUsdc) / 10_000).toFixed(2)}¢`],
          [takerAction === "Buy" ? "Maximum spend" : "Expected proceeds", money(takerAction === "Buy" ? gross + fee : Math.max(0, gross - fee))],
          ["Protocol fee", `${money(fee)} · ${(props.order.feeBps / 100).toFixed(2)}%`],
        ]} notice="This may partially fill the maker's order; any remainder stays open." />
      </>}
      onConfirmed={props.onConfirmed}
      build={async (taker) => {
        const fillBaseUnits = BigInt(parseTokenAmountToBaseUnits(fillQuantity, 6, "fill quantity"));
        if (fillBaseUnits > BigInt(props.order.remainingQuantity)) throw new Error("Fill quantity exceeds the order remainder.");
        const marketId = hexToBytes(props.marketId);
        const maker = address(props.order.maker);
        const collateralMint = address(props.state.deployment.collateralMint);
        const outcomeMint = address(props.order.outcome === "yes" ? props.state.deployment.yesMint : props.state.deployment.noMint);
        const feeRecipient = address(props.state.deployment.feeRecipient);
        const decodedOrderId = hexToBytes(props.order.orderId);
        const [takerCollateral] = await deriveAssociatedTokenAddress(taker, collateralMint);
        const [takerOutcome] = await deriveAssociatedTokenAddress(taker, outcomeMint);
        const instructions: Instruction[] = [];
        if (props.order.side === "ask") {
          const [makerCollateral] = await deriveAssociatedTokenAddress(maker, collateralMint);
          instructions.push(associatedTokenInstruction({ payer: taker, owner: maker, mint: collateralMint, ata: makerCollateral }));
          instructions.push(associatedTokenInstruction({ payer: taker, owner: taker, mint: outcomeMint, ata: takerOutcome }));
          instructions.push(await getFillAskInstruction({
            maker, taker, collateralMint, feeRecipient, marketId, orderId: decodedOrderId, outcomeMint,
            makerCollateral, takerCollateral, takerOutcome, quantity: fillBaseUnits,
          }));
        } else {
          const [makerOutcome] = await deriveAssociatedTokenAddress(maker, outcomeMint);
          instructions.push(associatedTokenInstruction({ payer: taker, owner: taker, mint: collateralMint, ata: takerCollateral }));
          instructions.push(associatedTokenInstruction({ payer: taker, owner: maker, mint: outcomeMint, ata: makerOutcome }));
          instructions.push(await getFillBidInstruction({
            maker, taker, collateralMint, feeRecipient, marketId, orderId: decodedOrderId, outcomeMint,
            makerOutcome, takerCollateral, takerOutcome, quantity: fillBaseUnits,
          }));
        }
        return instructions;
      }}
    />
  );
}

export function ScarcitySetAction(props: {
  state: ScarcityChainState;
  marketId: string;
  kind: "mint" | "merge";
  quantity: string;
  onConfirmed: () => void;
  onConnect: () => void;
}) {
  const client = useClient<AppSolanaClient>();
  const connected = useConnectedWallet(client);
  if (!connected) return <button type="button" onClick={props.onConnect}>Connect</button>;
  return (
    <ConnectedAction
      cluster={props.state.deployment.cluster}
      idleLabel={props.kind === "mint" ? "Mint YES + NO" : "Merge pair"}
      reviewTitle={props.kind === "mint" ? "Mint complete outcome set" : "Merge complete outcome set"}
      confirmLabel={props.kind === "mint" ? "Sign mint" : "Sign merge"}
      review={<ReviewRows rows={[
        ["Network", clusterLabel(props.state.deployment.cluster)],
        ["Quantity", `${props.quantity || "—"} complete sets`],
        [props.kind === "mint" ? "Maximum spend" : "Expected return", `${props.quantity || "—"} USDC`],
        ["Wallet receives", props.kind === "mint" ? `${props.quantity || "—"} YES + ${props.quantity || "—"} NO` : "USDC from the collateral vault"],
      ]} notice={props.kind === "mint" ? "Every complete set is backed by USDC before issuance." : "An equal YES and NO balance is burned to recover collateral."} />}
      onConfirmed={props.onConfirmed}
      build={async (owner) => {
        if (props.kind === "mint" && props.state.deployment.paused) throw new Error("New outcome issuance is paused by the protocol administrator.");
        if (props.state.market.status !== "unresolved") throw new Error("Resolved markets cannot issue or merge complete sets.");
        const marketId = hexToBytes(props.marketId);
        const collateralMint = address(props.state.deployment.collateralMint);
        const yesMint = address(props.state.deployment.yesMint);
        const noMint = address(props.state.deployment.noMint);
        const [ownerCollateral] = await deriveAssociatedTokenAddress(owner, collateralMint);
        const [ownerYes] = await deriveAssociatedTokenAddress(owner, yesMint);
        const [ownerNo] = await deriveAssociatedTokenAddress(owner, noMint);
        const amount = BigInt(parseTokenAmountToBaseUnits(props.quantity, 6, "complete sets"));
        const instructions: Instruction[] = [
          associatedTokenInstruction({ payer: owner, owner, mint: yesMint, ata: ownerYes }),
          associatedTokenInstruction({ payer: owner, owner, mint: noMint, ata: ownerNo }),
        ];
        if (props.kind === "merge") {
          instructions.unshift(associatedTokenInstruction({ payer: owner, owner, mint: collateralMint, ata: ownerCollateral }));
          instructions.push(await getMergeCompleteSetInstruction({ owner, collateralMint, marketId, ownerCollateral, ownerYes, ownerNo, amount }));
        } else {
          instructions.push(await getMintCompleteSetInstruction({ owner, collateralMint, marketId, ownerCollateral, ownerYes, ownerNo, amount }));
        }
        return instructions;
      }}
    />
  );
}

export function ScarcityRedeemAction(props: {
  state: ScarcityChainState;
  marketId: string;
  outcome: "YES" | "NO";
  quantity: string;
  onConfirmed: () => void;
  onConnect: () => void;
}) {
  const client = useClient<AppSolanaClient>();
  const connected = useConnectedWallet(client);
  if (!connected) return <button type="button" onClick={props.onConnect}>Connect</button>;
  return (
    <ConnectedAction
      cluster={props.state.deployment.cluster}
      idleLabel={`Redeem ${props.outcome}`}
      reviewTitle={`Redeem ${props.outcome} position`}
      confirmLabel="Sign redemption"
      review={<ReviewRows rows={[
        ["Network", clusterLabel(props.state.deployment.cluster)],
        ["Position burned", `${props.quantity || "—"} ${props.outcome}`],
        ["Payout rate", props.state.market.status === "invalid" ? "0.5 USDC per claim" : "1 USDC per winning claim"],
        ["Market state", props.state.market.status],
      ]} notice={props.state.market.status === "invalid" ? "Invalid markets return 0.5 USDC per YES or NO claim. Odd base-unit amounts round down." : "Only a winning position redeems at 1 USDC. The wallet simulation remains the final payout check."} />}
      onConfirmed={props.onConfirmed}
      build={async (owner) => {
        if (props.state.market.status === "unresolved") throw new Error("This market has not resolved yet.");
        const winning = props.state.market.status === "resolved-yes" ? "YES" : props.state.market.status === "resolved-no" ? "NO" : null;
        if (winning && winning !== props.outcome) throw new Error(`${props.outcome} is not the winning outcome.`);
        const collateralMint = address(props.state.deployment.collateralMint);
        const claimMint = address(props.outcome === "YES" ? props.state.deployment.yesMint : props.state.deployment.noMint);
        const [ownerCollateral] = await deriveAssociatedTokenAddress(owner, collateralMint);
        const [ownerClaim] = await deriveAssociatedTokenAddress(owner, claimMint);
        const amount = BigInt(parseTokenAmountToBaseUnits(props.quantity, 6, `${props.outcome} claims`));
        return [
          associatedTokenInstruction({ payer: owner, owner, mint: collateralMint, ata: ownerCollateral }),
          await getRedeemInstruction({ owner, collateralMint, marketId: hexToBytes(props.marketId), ownerCollateral, claimMint, ownerClaim, amount }),
        ];
      }}
    />
  );
}

export function ScarcityOrderCancel(props: {
  state: ScarcityChainState;
  marketId: string;
  order: ScarcityBookOrder;
  onConfirmed: () => void;
}) {
  const client = useClient<AppSolanaClient>();
  const connected = useConnectedWallet(client);
  if (!connected || connected.account.address !== props.order.maker) return null;
  const refundAsset = props.order.side === "bid" ? "USDC" : props.order.outcome.toUpperCase();
  return (
    <ConnectedAction
      cluster={props.state.deployment.cluster}
      idleLabel="Cancel"
      reviewTitle="Cancel open order"
      confirmLabel="Sign cancellation"
      review={<ReviewRows rows={[
        ["Network", clusterLabel(props.state.deployment.cluster)],
        ["Order", `${props.order.side.toUpperCase()} ${props.order.outcome.toUpperCase()} @ ${(Number(props.order.priceMicroUsdc) / 10_000).toFixed(2)}¢`],
        ["Remaining", `${humanTokenAmount(props.order.remainingQuantity)} contracts`],
        ["Refund asset", refundAsset],
      ]} notice="Cancellation returns the order's remaining escrow to your wallet. Token-account rent may apply if a refund account must be created." />}
      onConfirmed={props.onConfirmed}
      build={async (maker) => {
        const escrowMint = address(props.order.side === "bid"
          ? props.state.deployment.collateralMint
          : props.order.outcome === "yes" ? props.state.deployment.yesMint : props.state.deployment.noMint);
        const [makerRefund] = await deriveAssociatedTokenAddress(maker, escrowMint);
        return [
          associatedTokenInstruction({ payer: maker, owner: maker, mint: escrowMint, ata: makerRefund }),
          await getCancelOrderInstruction({ maker, marketId: hexToBytes(props.marketId), orderId: hexToBytes(props.order.orderId), escrowMint, makerRefund }),
        ];
      }}
    />
  );
}

export function ScarcityWalletTransaction(props: {
  cluster: "devnet" | "mainnet-beta";
  label: string;
  build: (owner: Address) => Promise<Instruction[]>;
  onConfirmed: (signature: string) => void;
  onConnect: () => void;
  reviewTitle?: string;
  review?: ReactNode;
  confirmLabel?: string;
}) {
  const client = useClient<AppSolanaClient>();
  const connected = useConnectedWallet(client);
  if (!connected) return <button type="button" onClick={props.onConnect}>Connect Solana wallet</button>;
  return (
    <ConnectedAction
      cluster={props.cluster}
      idleLabel={props.label}
      reviewTitle={props.reviewTitle ?? props.label}
      confirmLabel={props.confirmLabel ?? "Continue to operator wallet"}
      review={props.review ?? <ReviewRows rows={[["Network", clusterLabel(props.cluster)], ["Signer", `${String(connected.account.address).slice(0, 8)}…${String(connected.account.address).slice(-6)}`], ["Action", props.label]]} notice="This is an operator action. Confirm the derived accounts and wallet simulation before signing." />}
      build={props.build}
      onConfirmed={props.onConfirmed}
    />
  );
}
