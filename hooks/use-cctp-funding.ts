"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfig } from "wagmi";
import { sendTransaction, switchChain, waitForTransactionReceipt } from "wagmi/actions";
import type {
  FundingStatus,
  IntentQuote,
  TransactionReference,
  WalletStep,
} from "@hedgents/stablecoin-rail";
import type { Address, Hash } from "viem";
import {
  CCTP_SOURCES,
  type CctpSourceId,
  getCctpRailClient,
  quoteCctpFunding,
} from "@/lib/rail-cctp";
import {
  clearPendingCctpFunding,
  readPendingCctpFunding,
  savePendingCctpFunding,
} from "@/lib/cctp-funding-storage";

const STATUS_POLL_MS = 7_500;

export type CctpFundingPhase =
  | "idle"
  | "quoting"
  | "ready"
  | "approval"
  | "funding"
  | "confirming"
  | "completed"
  | "failed";

export interface CctpFundingState {
  phase: CctpFundingPhase;
  quote: IntentQuote | null;
  approvalTxId: string | null;
  reference: TransactionReference | null;
  status: FundingStatus | null;
  error: string | null;
}

const initialState: CctpFundingState = {
  phase: "idle",
  quote: null,
  approvalTxId: null,
  reference: null,
  status: null,
  error: null,
};

function errorMessage(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { shortMessage?: unknown; message?: unknown };
    if (typeof candidate.shortMessage === "string") return candidate.shortMessage;
    if (typeof candidate.message === "string") return candidate.message;
  }
  return "The CCTP funding request did not complete.";
}

function isEvmStep(step: WalletStep) {
  return step.request.namespace === "evm";
}

export function useCctpFunding(input: {
  sourceId: CctpSourceId;
  amountUsd: string;
  sourceAddress: string;
  destinationAddress: string;
  allowNewFunding: boolean;
}) {
  const config = useConfig();
  const [state, setState] = useState<CctpFundingState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const pollInFlight = useRef(false);

  const quoteFunding = useCallback(async () => {
    if (!input.allowNewFunding) {
      setState((current) => ({
        ...current,
        phase: "failed",
        error: "New cross-chain funding is paused. Existing source burns can still be verified.",
      }));
      return;
    }
    setState({ ...initialState, phase: "quoting" });
    try {
      const quote = await quoteCctpFunding({
        id: `hedgents-${crypto.randomUUID()}`,
        sourceId: input.sourceId,
        sourceAddress: input.sourceAddress,
        destinationAddress: input.destinationAddress,
        amountUsd: input.amountUsd,
      });
      setState({
        ...initialState,
        phase: "ready",
        quote,
      });
    } catch (error) {
      setState({
        ...initialState,
        phase: "failed",
        error: errorMessage(error),
      });
    }
  }, [input.allowNewFunding, input.amountUsd, input.destinationAddress, input.sourceAddress, input.sourceId]);

  const executeFunding = useCallback(async () => {
    if (!input.allowNewFunding) {
      setState((current) => ({
        ...current,
        phase: "failed",
        error: "New cross-chain funding is paused. No wallet transaction was requested.",
      }));
      return;
    }
    const quote = state.quote;
    if (!quote) return;
    let fundingBroadcast = state.reference;
    try {
      const source = CCTP_SOURCES[input.sourceId];
      if (quote.intent.source.account.address.toLowerCase() !== input.sourceAddress.toLowerCase()) {
        throw new Error("The connected EVM account changed. Build a fresh funding quote.");
      }
      if (quote.intent.destination.account.address !== input.destinationAddress) {
        throw new Error("The connected Solana account changed. Build a fresh funding quote.");
      }

      const steps = await getCctpRailClient().prepareFunding(quote, {
        connectedAccounts: [
          quote.intent.source.account,
          quote.intent.destination.account,
        ],
      });
      if (
        steps.length !== 2 ||
        steps[0].kind !== "approval" ||
        steps[1].kind !== "funding" ||
        !steps.every(isEvmStep)
      ) {
        throw new Error("The Rail SDK returned an unexpected wallet-step sequence.");
      }

      const chainId = source.chain.numericChainId as 1 | 8453;
      await switchChain(config, { chainId });

      let approvalTxId: string | null = null;
      let fundingReference: TransactionReference | null = null;
      for (const step of steps) {
        if (step.request.namespace !== "evm" || step.request.numericChainId !== chainId) {
          throw new Error("The Rail SDK requested a transaction on an unexpected chain.");
        }
        setState((current) => ({
          ...current,
          phase: step.kind === "approval" ? "approval" : "funding",
          error: null,
        }));

        const hash = await sendTransaction(config, {
          account: input.sourceAddress as Address,
          chainId,
          to: step.request.to,
          data: step.request.data,
          value: BigInt(step.request.value),
        });

        if (step.kind === "approval") {
          approvalTxId = hash;
          savePendingCctpFunding(window.localStorage, {
            version: 1,
            sourceId: input.sourceId,
            quote,
            approvalTxId,
            reference: null,
          });
          setState((current) => ({ ...current, approvalTxId }));
        } else {
          fundingReference = {
            chainId: source.chain.chainId,
            txId: hash,
            submittedAt: new Date().toISOString(),
          };
          fundingBroadcast = fundingReference;
          savePendingCctpFunding(window.localStorage, {
            version: 1,
            sourceId: input.sourceId,
            quote,
            approvalTxId,
            reference: fundingReference,
          });
          setState((current) => ({ ...current, reference: fundingReference }));
        }

        const receipt = await waitForTransactionReceipt(config, {
          chainId,
          hash: hash as Hash,
          confirmations: 1,
        });
        if (receipt.status !== "success") {
          if (step.kind === "funding") {
            clearPendingCctpFunding(window.localStorage);
            fundingBroadcast = null;
          }
          throw new Error(`${step.label} reverted on ${source.label}.`);
        }
      }

      if (!fundingReference) {
        throw new Error("The CCTP funding transaction was not submitted.");
      }
      setState((current) => ({
        ...current,
        phase: "confirming",
        reference: fundingReference,
      }));
    } catch (error) {
      setState((current) => fundingBroadcast
        ? {
            ...current,
            phase: "confirming",
            reference: fundingBroadcast,
            error: `Source confirmation check delayed: ${errorMessage(error)}`,
          }
        : {
            ...current,
            phase: "failed",
            error: errorMessage(error),
          });
    }
  }, [config, input.allowNewFunding, input.destinationAddress, input.sourceAddress, input.sourceId, state.quote]);

  const reset = useCallback(() => {
    clearPendingCctpFunding(window.localStorage);
    setState(initialState);
  }, []);

  useEffect(() => {
    const pending = readPendingCctpFunding(window.localStorage);
    if (!pending) {
      setHydrated(true);
      return;
    }
    const quote = pending.quote;
    if (pending.sourceId !== input.sourceId) {
      setState({
        ...initialState,
        phase: "failed",
        error: `A pending ${CCTP_SOURCES[pending.sourceId].label} delivery must be resumed before starting another funding transfer.`,
      });
      setHydrated(true);
      return;
    }
    const accountsMatch =
      quote.intent.source.account.address.toLowerCase() === input.sourceAddress.toLowerCase() &&
      quote.intent.destination.account.address === input.destinationAddress;
    if (!accountsMatch) {
      setState({
        ...initialState,
        phase: "failed",
        quote,
        approvalTxId: pending.approvalTxId,
        reference: pending.reference,
        error: "Connect the EVM source and Solana destination wallets used by this pending transfer to resume verification.",
      });
      setHydrated(true);
      return;
    }

    if (pending.reference) {
      setState({
        ...initialState,
        phase: "confirming",
        quote,
        approvalTxId: pending.approvalTxId,
        reference: pending.reference,
      });
    } else if (pending.approvalTxId) {
      setState({
        ...initialState,
        phase: "failed",
        quote,
        approvalTxId: pending.approvalTxId,
        error:
          "An exact USDC approval was submitted, but no CCTP burn was recorded. Build a fresh quote before continuing.",
      });
    }
    setHydrated(true);
  }, [input.destinationAddress, input.sourceAddress, input.sourceId]);

  useEffect(() => {
    if (state.phase !== "confirming" || !state.quote || !state.reference) return;
    let active = true;

    const check = async () => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      try {
        const status = await getCctpRailClient().getFundingStatus(
          state.quote!,
          state.reference!,
        );
        if (!active) return;
        if (status.state === "completed") {
          clearPendingCctpFunding(window.localStorage);
          setState((current) => ({ ...current, phase: "completed", status, error: null }));
        } else if (status.state === "failed" || status.state === "refunded") {
          clearPendingCctpFunding(window.localStorage);
          setState((current) => ({
            ...current,
            phase: "failed",
            status,
            error: status.detail,
          }));
        } else {
          setState((current) => ({ ...current, status }));
        }
      } catch (error) {
        if (active) {
          setState((current) => ({
            ...current,
            error: `Delivery check delayed: ${errorMessage(error)}`,
          }));
        }
      } finally {
        pollInFlight.current = false;
      }
    };

    void check();
    const interval = window.setInterval(() => void check(), STATUS_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [state.phase, state.quote, state.reference]);

  return {
    state,
    hydrated,
    quoteFunding,
    executeFunding,
    reset,
  };
}
