import type {
  ExecutionRecord,
  PortfolioAccountingPosition,
  PortfolioAssetBalance,
} from "@/lib/execution-types";
import { verifiedExecutionOutput } from "@/lib/execution-records";

interface CostLot {
  units: number;
  costPerUnitUsd: number;
}

interface ProductLedger {
  lots: CostLot[];
  realizedPnlUsd: number;
}

function units(rawAmount: string | null | undefined, decimals = 6) {
  if (!rawAmount || !/^\d+$/.test(rawAmount)) return 0;
  const value = Number(rawAmount) / 10 ** decimals;
  return Number.isFinite(value) ? value : 0;
}

function isVerifiedFill(record: ExecutionRecord) {
  return record.status === "Success" && record.settlement?.status === "verified";
}

function consumeLots(lots: CostLot[], requestedUnits: number) {
  let remaining = requestedUnits;
  let costUsd = 0;
  while (remaining > 0 && lots.length > 0) {
    const lot = lots[0];
    const consumed = Math.min(remaining, lot.units);
    costUsd += consumed * lot.costPerUnitUsd;
    lot.units -= consumed;
    remaining -= consumed;
    if (lot.units <= 1e-12) lots.shift();
  }
  return { costUsd, coveredUnits: requestedUnits - remaining };
}

export function calculatePortfolioAccounting(
  records: ExecutionRecord[],
  balances: PortfolioAssetBalance[],
  priceByProduct: Record<string, number | null | undefined>,
): PortfolioAccountingPosition[] {
  const ledgers = new Map<string, ProductLedger>();
  const ledgerFor = (productId: string) => {
    const existing = ledgers.get(productId);
    if (existing) return existing;
    const next = { lots: [], realizedPnlUsd: 0 };
    ledgers.set(productId, next);
    return next;
  };

  for (const record of [...records].sort((left, right) =>
    Date.parse(left.timestamp) - Date.parse(right.timestamp))) {
    if (!isVerifiedFill(record)) continue;
    const ledger = ledgerFor(record.productId);
    if ((record.side ?? "buy") === "buy") {
      const acquired = units(verifiedExecutionOutput(record), record.outputDecimals);
      const paidUsd = record.inputUsd ?? units(record.inputAmount, record.inputDecimals);
      if (acquired > 0 && paidUsd > 0) {
        ledger.lots.push({ units: acquired, costPerUnitUsd: paidUsd / acquired });
      }
      continue;
    }

    const sold = units(record.inputAmount, record.inputDecimals);
    const proceedsUsd = units(verifiedExecutionOutput(record), record.outputDecimals);
    if (sold <= 0 || proceedsUsd < 0) continue;
    const consumed = consumeLots(ledger.lots, sold);
    if (consumed.coveredUnits > 0) {
      const coveredProceeds = proceedsUsd * (consumed.coveredUnits / sold);
      ledger.realizedPnlUsd += coveredProceeds - consumed.costUsd;
    }
  }

  return balances
    .filter((balance) => balance.kind === "metal" && balance.productId)
    .map((balance) => {
      const productId = balance.productId!;
      const walletUnits = Number(balance.amount);
      const ledger = ledgers.get(productId) ?? { lots: [], realizedPnlUsd: 0 };
      const trackedUnits = ledger.lots.reduce((total, lot) => total + lot.units, 0);
      const trackedCost = ledger.lots.reduce(
        (total, lot) => total + lot.units * lot.costPerUnitUsd,
        0,
      );
      const averageCostUsd = trackedUnits > 0 ? trackedCost / trackedUnits : null;
      const coveredUnits = Math.min(Math.max(0, walletUnits), trackedUnits);
      const costBasisUsd = averageCostUsd == null ? 0 : coveredUnits * averageCostUsd;
      const mark = priceByProduct[productId];
      const marketValueUsd = mark != null && Number.isFinite(mark)
        ? coveredUnits * mark
        : null;
      const tolerance = Math.max(1e-9, Math.abs(walletUnits) * 1e-8);
      const coverage = coveredUnits <= tolerance
        ? "none" as const
        : Math.abs(walletUnits - coveredUnits) <= tolerance
          ? "complete" as const
          : "partial" as const;
      return {
        productId,
        coveredUnits,
        walletUnits,
        averageCostUsd,
        costBasisUsd,
        marketValueUsd,
        unrealizedPnlUsd: marketValueUsd == null ? null : marketValueUsd - costBasisUsd,
        realizedPnlUsd: ledger.realizedPnlUsd,
        coverage,
      };
    });
}
