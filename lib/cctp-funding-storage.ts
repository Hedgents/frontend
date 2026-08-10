import type { IntentQuote, TransactionReference } from "@hedgents/stablecoin-rail";
import type { CctpSourceId } from "./rail-cctp";

export const CCTP_FUNDING_STORAGE_KEY = "hedgents:cctp-funding:v1";

export interface PersistedCctpFunding {
  version: 1;
  sourceId: CctpSourceId;
  quote: IntentQuote;
  approvalTxId: string | null;
  reference: TransactionReference | null;
}

type FundingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const SOURCE_CHAIN_IDS: Record<CctpSourceId, string> = {
  ethereum: "eip155:1",
  base: "eip155:8453",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAccount(
  value: unknown,
  chainId: string,
  addressPattern: RegExp,
) {
  return isRecord(value)
    && value.chainId === chainId
    && typeof value.address === "string"
    && addressPattern.test(value.address);
}

function isAsset(value: unknown, chainId: string) {
  return isRecord(value)
    && value.chainId === chainId
    && typeof value.assetId === "string"
    && value.assetId.startsWith(`${chainId}/`)
    && typeof value.symbol === "string"
    && Number.isSafeInteger(value.decimals)
    && Number(value.decimals) >= 0;
}

function isAssetAmount(value: unknown, chainId: string) {
  return isRecord(value)
    && /^\d+$/.test(String(value.amountBaseUnits ?? ""))
    && isAsset(value.asset, chainId);
}

function isTransactionReference(value: unknown, chainId: string) {
  return isRecord(value)
    && value.chainId === chainId
    && typeof value.txId === "string"
    && /^0x[0-9a-fA-F]{64}$/.test(value.txId)
    && typeof value.submittedAt === "string"
    && Number.isFinite(Date.parse(value.submittedAt));
}

function isRecoverableQuote(value: unknown, sourceId: CctpSourceId) {
  if (!isRecord(value) || !isRecord(value.intent) || !isRecord(value.funding)) return false;
  const sourceChainId = SOURCE_CHAIN_IDS[sourceId];
  const source = value.intent.source;
  const destination = value.intent.destination;
  const minimumOutput = value.funding.minimumOutput;
  const fees = value.funding.fees;
  return typeof value.id === "string"
    && isRecord(source)
    && isAccount(source.account, sourceChainId, /^0x[0-9a-fA-F]{40}$/)
    && isAsset(source.asset, sourceChainId)
    && isRecord(destination)
    && isAccount(destination.account, "solana:mainnet", /^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    && isAsset(destination.settlementAsset, "solana:mainnet")
    && /^\d+$/.test(String(value.intent.inputAmountBaseUnits ?? ""))
    && Number.isSafeInteger(value.intent.slippageBps)
    && value.funding.providerId === "circle-cctp-v2-solana"
    && isAssetAmount(minimumOutput, "solana:mainnet")
    && Array.isArray(fees)
    && fees.every((fee) => isRecord(fee) && isAssetAmount(fee.amount, "solana:mainnet"))
    && typeof value.expiresAt === "string"
    && Number.isFinite(Date.parse(value.expiresAt))
    && typeof value.totalEtaSeconds === "number"
    && Number.isFinite(value.totalEtaSeconds)
    && value.totalEtaSeconds >= 0;
}

export function savePendingCctpFunding(
  storage: FundingStorage,
  value: PersistedCctpFunding,
) {
  storage.setItem(CCTP_FUNDING_STORAGE_KEY, JSON.stringify(value));
}

export function clearPendingCctpFunding(storage: FundingStorage) {
  storage.removeItem(CCTP_FUNDING_STORAGE_KEY);
}

export function readPendingCctpFunding(
  storage: FundingStorage,
): PersistedCctpFunding | null {
  try {
    const raw = storage.getItem(CCTP_FUNDING_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedCctpFunding>;
    const sourceId = value.sourceId;
    if (value.version !== 1 || (sourceId !== "ethereum" && sourceId !== "base")) {
      clearPendingCctpFunding(storage);
      return null;
    }
    const chainId = SOURCE_CHAIN_IDS[sourceId];
    if (
      !isRecoverableQuote(value.quote, sourceId) ||
      (value.approvalTxId !== null && (
        typeof value.approvalTxId !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(value.approvalTxId)
      )) ||
      (value.reference !== null && !isTransactionReference(value.reference, chainId))
    ) {
      clearPendingCctpFunding(storage);
      return null;
    }
    return value as PersistedCctpFunding;
  } catch {
    clearPendingCctpFunding(storage);
    return null;
  }
}
