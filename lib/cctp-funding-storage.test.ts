import assert from "node:assert/strict";
import test from "node:test";
import {
  CCTP_FUNDING_STORAGE_KEY,
  readPendingCctpFunding,
} from "./cctp-funding-storage";

function memoryStorage(initial: string | null) {
  let value = initial;
  return {
    getItem: (key: string) => key === CCTP_FUNDING_STORAGE_KEY ? value : null,
    setItem: (_key: string, next: string) => { value = next; },
    removeItem: (key: string) => { if (key === CCTP_FUNDING_STORAGE_KEY) value = null; },
    value: () => value,
  };
}

const hash = `0x${"ab".repeat(32)}`;
const sourceAsset = {
  chainId: "eip155:1",
  assetId: "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  symbol: "USDC",
  decimals: 6,
};
const destinationAsset = {
  chainId: "solana:mainnet",
  assetId: "solana:mainnet/spl:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  symbol: "USDC",
  decimals: 6,
};

function validPending() {
  return {
    version: 1,
    sourceId: "ethereum",
    quote: {
      id: "quote-1",
      intent: {
        id: "intent-1",
        source: {
          account: { chainId: "eip155:1", address: "0x1111111111111111111111111111111111111111" },
          asset: sourceAsset,
        },
        destination: {
          account: { chainId: "solana:mainnet", address: "5GgRAEmv8ZxF2PR5hY72Qs5x1bnQ6UK2RbTPoqJ3wSwW" },
          settlementAsset: destinationAsset,
        },
        inputAmountBaseUnits: "25000000",
        slippageBps: 10,
      },
      funding: {
        providerId: "circle-cctp-v2-solana",
        minimumOutput: { asset: destinationAsset, amountBaseUnits: "24900000" },
        fees: [{ amount: { asset: destinationAsset, amountBaseUnits: "100000" } }],
      },
      expiresAt: "2026-08-10T00:10:00.000Z",
      totalEtaSeconds: 60,
    },
    approvalTxId: hash,
    reference: { chainId: "eip155:1", txId: hash, submittedAt: "2026-08-10T00:00:00.000Z" },
  };
}

test("pending CCTP recovery identifies its source without enabling new funding", () => {
  const storage = memoryStorage(JSON.stringify(validPending()));
  assert.equal(readPendingCctpFunding(storage as unknown as Storage)?.sourceId, "ethereum");
});

test("malformed pending CCTP recovery is removed", () => {
  const storage = memoryStorage(JSON.stringify({ version: 2, sourceId: "tron" }));
  assert.equal(readPendingCctpFunding(storage as unknown as Storage), null);
  assert.equal(storage.value(), null);
});

test("malformed nested CCTP quote data is cleared before the hook can dereference it", () => {
  const malformed = validPending();
  malformed.quote.intent.destination.account.address = "not-a-solana-address";
  const storage = memoryStorage(JSON.stringify(malformed));
  assert.equal(readPendingCctpFunding(storage as unknown as Storage), null);
  assert.equal(storage.value(), null);
});

test("pending source id must match the quote and transaction reference chain", () => {
  const mismatched = validPending();
  mismatched.sourceId = "base";
  const storage = memoryStorage(JSON.stringify(mismatched));
  assert.equal(readPendingCctpFunding(storage as unknown as Storage), null);
  assert.equal(storage.value(), null);
});
