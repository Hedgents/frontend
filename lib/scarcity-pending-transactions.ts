export const SCARCITY_PENDING_STORAGE_KEY = "hedgents:scarcity-pending-transactions:v1";
export const SCARCITY_PENDING_EVENT = "hedgents:scarcity-pending-change";

export interface ScarcityPendingTransaction {
  schemaVersion: "1.0.0";
  signature: string;
  cluster: "devnet" | "mainnet-beta";
  wallet: string;
  label: string;
  submittedAt: string;
  state: "pending" | "failed";
  lastCheckedAt: string | null;
  error: string | null;
}

const MAX_PENDING_RECORDS = 50;

function validRecord(value: unknown): value is ScarcityPendingTransaction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ScarcityPendingTransaction>;
  return record.schemaVersion === "1.0.0"
    && typeof record.signature === "string"
    && /^[1-9A-HJ-NP-Za-km-z]{32,100}$/.test(record.signature)
    && (record.cluster === "devnet" || record.cluster === "mainnet-beta")
    && typeof record.wallet === "string"
    && record.wallet.length >= 32
    && typeof record.label === "string"
    && record.label.length > 0
    && record.label.length <= 140
    && typeof record.submittedAt === "string"
    && Number.isFinite(Date.parse(record.submittedAt))
    && (record.state === "pending" || record.state === "failed")
    && (record.lastCheckedAt === null || (typeof record.lastCheckedAt === "string" && Number.isFinite(Date.parse(record.lastCheckedAt))))
    && (record.error === null || typeof record.error === "string");
}

export function parseScarcityPendingTransactions(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validRecord).slice(0, MAX_PENDING_RECORDS);
  } catch {
    return [];
  }
}

export function upsertScarcityPendingTransaction(
  records: ScarcityPendingTransaction[],
  record: ScarcityPendingTransaction,
) {
  if (!validRecord(record)) throw new Error("Pending scarcity transaction record is invalid.");
  return [record, ...records.filter((entry) => entry.signature !== record.signature)]
    .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))
    .slice(0, MAX_PENDING_RECORDS);
}

export function removeScarcityPendingTransaction(records: ScarcityPendingTransaction[], signature: string) {
  return records.filter((record) => record.signature !== signature);
}
