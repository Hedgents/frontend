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

const STORAGE_KEY = "hedgents:cctp-funding:v1";
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

interface PersistedCctpFunding {
  version: 1;
  sourceId: CctpSourceId;
  quote: IntentQuote;
  approvalTxId: string | null;
  reference: TransactionReference | null;
}

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

function savePending(value: PersistedCctpFunding) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function clearPending() {
  window.localStorage.removeItem(STORAGE_KEY);
}

function readPending(): PersistedCctpFunding | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedCctpFunding>;
    if (
      value.version !== 1 ||
      (value.sourceId !== "ethereum" && value.sourceId !== "base") ||
      !value.quote ||
      typeof value.quote !== "object"
    ) {
      clearPending();
      return null;
    }
    return value as PersistedCctpFunding;
  } catch {
    clearPending();
    return null;
  }
}

export function useCctpFunding(input: {
  sourceId: CctpSourceId;
  amountUsd: string;
  sourceAddress: string;
  destinationAddress: string;
}) {
  const config = useConfig();
  const [state, setState] = useState<CctpFundingState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const pollInFlight = useRef(false);

  const quoteFunding = useCallback(async () => {
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
  }, [input.amountUsd, input.destinationAddress, input.sourceAddress, input.sourceId]);

  const executeFunding = useCallback(async () => {
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
          savePending({
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
          savePending({
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
            clearPending();
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
  }, [config, input.destinationAddress, input.sourceAddress, input.sourceId, state.quote]);

  const reset = useCallback(() => {
    clearPending();
    setState(initialState);
  }, []);

  useEffect(() => {
    const pending = readPending();
    if (!pending) {
      setHydrated(true);
      return;
    }
    const quote = pending.quote;
    const matches =
      pending.sourceId === input.sourceId &&
      quote.intent.source.account.address.toLowerCase() === input.sourceAddress.toLowerCase() &&
      quote.intent.destination.account.address === input.destinationAddress;
    if (!matches) {
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
          clearPending();
          setState((current) => ({ ...current, phase: "completed", status, error: null }));
        } else if (status.state === "failed" || status.state === "refunded") {
          clearPending();
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
