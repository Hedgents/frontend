import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionRecord, PortfolioAssetBalance } from "./execution-types";
import { calculatePortfolioAccounting } from "./portfolio-accounting";

function fill(overrides: Partial<ExecutionRecord>): ExecutionRecord {
  return {
    id: "fill",
    productId: "gold-paxg",
    metal: "Gold",
    ticker: "PAXG",
    side: "buy",
    settlementAssetId: "usdc",
    inputUsd: 100,
    inputAmount: "100000000",
    inputDecimals: 6,
    outputAmount: "100000000",
    outputDecimals: 6,
    source: "Solana",
    destination: "PAXG · Solana",
    status: "Success",
    signature: "signature",
    timestamp: "2026-01-01T00:00:00.000Z",
    settlement: {
      status: "verified",
      receivedAmount: "100000000",
      expectedMinimumAmount: "99000000",
      verifiedAt: "2026-01-01T00:00:01.000Z",
      error: null,
    },
    ...overrides,
  };
}

const balance: PortfolioAssetBalance = {
  kind: "metal",
  productId: "gold-paxg",
  mint: "mint",
  symbol: "PAXG",
  name: "PAX Gold",
  decimals: 6,
  tokenProgram: "SPL Token",
  rawAmount: "150000000",
  amount: "150",
};

test("calculates FIFO basis, realized P&L, and remaining unrealized P&L", () => {
  const records = [
    fill({ id: "one", inputUsd: 100, outputAmount: "101000000" }),
    fill({ id: "two", inputUsd: 120, outputAmount: "102000000", timestamp: "2026-01-02T00:00:00.000Z" }),
    fill({
      id: "sell",
      side: "sell",
      inputUsd: undefined,
      inputAmount: "50000000",
      outputAmount: "76000000",
      settlement: {
        status: "verified",
        receivedAmount: "75000000",
        expectedMinimumAmount: "74000000",
        verifiedAt: "2026-01-03T00:00:01.000Z",
        error: null,
      },
      timestamp: "2026-01-03T00:00:00.000Z",
    }),
  ];
  const [position] = calculatePortfolioAccounting(records, [balance], { "gold-paxg": 2 });
  assert.equal(position.coverage, "complete");
  assert.equal(position.costBasisUsd, 170);
  assert.equal(position.realizedPnlUsd, 25);
  assert.equal(position.marketValueUsd, 300);
  assert.equal(position.unrealizedPnlUsd, 130);
});

test("ignores failed and unverified fills and reports partial history coverage", () => {
  const records = [
    fill({
      outputAmount: "51000000",
      inputUsd: 50,
      settlement: {
        status: "verified",
        receivedAmount: "50000000",
        expectedMinimumAmount: "49000000",
        verifiedAt: "2026-01-01T00:00:01.000Z",
        error: null,
      },
    }),
    fill({ id: "pending", status: "Pending", outputAmount: "100000000" }),
    fill({ id: "not-verified", settlement: { ...fill({}).settlement!, status: "pending" } }),
  ];
  const [position] = calculatePortfolioAccounting(records, [balance], { "gold-paxg": 2 });
  assert.equal(position.coverage, "partial");
  assert.equal(position.coveredUnits, 50);
  assert.equal(position.costBasisUsd, 50);
});
