import assert from "node:assert/strict";
import test from "node:test";
import { SOLANA_USDC_MINT } from "./product-registry";
import {
  buildCctpFundingIntent,
  CCTP_SOURCES,
  formatUsdcBaseUnits,
  totalCctpFeesBaseUnits,
} from "./rail-cctp";
import type { IntentQuote } from "@hedgents/stablecoin-rail";

const sourceAddress = "0x1111111111111111111111111111111111111111";
const destinationAddress = "5GgRAEmv8ZxF2PR5hY72Qs5x1bnQ6UK2RbTPoqJ3wSwW";

test("builds a pinned native-USDC CCTP intent from Ethereum to Solana", () => {
  const intent = buildCctpFundingIntent({
    id: "intent-1",
    sourceId: "ethereum",
    sourceAddress,
    destinationAddress,
    amountUsd: "25.123456",
  });

  assert.equal(intent.source.account.chainId, "eip155:1");
  assert.equal(
    intent.source.asset.assetId,
    `eip155:1/erc20:${CCTP_SOURCES.ethereum.chain.usdcAddress.toLowerCase()}`,
  );
  assert.equal(intent.destination.account.chainId, "solana:mainnet");
  assert.equal(intent.destination.settlementAsset.assetId, `solana:mainnet/spl:${SOLANA_USDC_MINT}`);
  assert.equal(intent.inputAmountBaseUnits, "25123456");
  assert.equal(intent.action, undefined);
});

test("rejects invalid source wallets and unsupported-sized requests", () => {
  assert.throws(() => buildCctpFundingIntent({
    id: "intent-2",
    sourceId: "base",
    sourceAddress: "not-an-address",
    destinationAddress,
    amountUsd: "25",
  }));
  assert.throws(() => buildCctpFundingIntent({
    id: "intent-3",
    sourceId: "base",
    sourceAddress,
    destinationAddress,
    amountUsd: "9.99",
  }));
});

test("formats exact USDC amounts and totals fee rows without floating point", () => {
  assert.equal(formatUsdcBaseUnits("2500123456"), "2500.123456");
  assert.equal(formatUsdcBaseUnits("2500000000"), "2500");

  const quote = {
    funding: {
      fees: [
        { amount: { amountBaseUnits: "1200" } },
        { amount: { amountBaseUnits: "34" } },
      ],
    },
  } as IntentQuote;
  assert.equal(totalCctpFeesBaseUnits(quote), "1234");
});
