/**
 * Post both sides of the open devnet event markets so a tester can take a directional view.
 *
 *   SCARCITY_ADMIN_KEYPAIR=~/.config/solana/id.json \
 *   SCARCITY_COLLATERAL_MINT=... SCARCITY_FEE_RECIPIENT=... \
 *   npx tsx --conditions=react-server scripts/quote-devnet-event-markets.ts [slug ...]
 *
 * A complete-set market cannot give anybody a position on its own: minting hands you YES and NO
 * together, which nets to nothing. Somebody has to sell a side. On devnet with no participants that
 * is us.
 *
 * Unlike the Gold 15 rounds these markets run until the end of 2026, so the orders can rest for the
 * whole beta and this only needs running once per market rather than every fifteen minutes.
 *
 * Both sides are quoted at the same price so the operator takes no view. If both fill, the mint cost
 * comes back exactly; if only one fills, the operator holds the other side.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
} from "@solana/kit";
import { getStoredScarcityMarket } from "@/lib/scarcity-market-store";
import {
  decodeScarcityMarketAccount,
  deriveAssociatedTokenAddress,
  deriveMarketAddresses,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintCompleteSetInstruction,
  getPlaceOrderInstruction,
  hexToBytes,
} from "@/lib/scarcity-exchange";

const DEFAULT_SLUGS = [
  "gold-tightness-62-2026",
  "silver-tightness-72-2026",
  "copper-tightness-70-2026",
];

const PRICE_MICRO_USDC = 500_000n; // 0.50 a side, no view taken

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const rpcUrl = process.env.SCARCITY_RPC_URL?.trim() || "https://api.devnet.solana.com";
const wsUrl = process.env.SCARCITY_WS_URL?.trim() || "wss://api.devnet.solana.com";
const args = process.argv.slice(2);
const contracts = BigInt(process.env.SCARCITY_QUOTE_CONTRACTS ?? "200");
const slugs = args.length ? args : DEFAULT_SLUGS;

async function main() {
  const rpc = createSolanaRpc(rpcUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc, rpcSubscriptions: createSolanaRpcSubscriptions(wsUrl),
  });
  const maker = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(
      required("SCARCITY_ADMIN_KEYPAIR").replace("~", process.env.HOME ?? ""), "utf8",
    ) as string) as number[]),
  );
  const collateralMint = address(required("SCARCITY_COLLATERAL_MINT"));
  const feeRecipient = address(required("SCARCITY_FEE_RECIPIENT"));
  const quantity = contracts * 1_000_000n;

  const submit = async (instructions: Instruction[], label: string) => {
    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const signed = await signTransactionMessageWithSigners(pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayerSigner(maker, draft),
      (draft) => setTransactionMessageLifetimeUsingBlockhash(blockhash, draft),
      (draft) => appendTransactionMessageInstructions(instructions, draft),
    ));
    await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
      commitment: "confirmed", skipPreflight: false,
    });
    process.stderr.write(`  ${label}: ${getSignatureFromTransaction(signed)}\n`);
  };

  const quoted: string[] = [];
  const skipped: unknown[] = [];

  for (const slug of slugs) {
    const catalog = await getStoredScarcityMarket(slug) as Record<string, any> | null;
    if (!catalog?.marketId) { skipped.push({ slug, reason: "not in the catalog" }); continue; }
    const marketId = hexToBytes(catalog.marketId);
    const addresses = await deriveMarketAddresses(marketId);
    const account = await rpc
      .getAccountInfo(addresses.market, { encoding: "base64", commitment: "confirmed" }).send();
    if (!account.value) { skipped.push({ slug, reason: "not on chain" }); continue; }
    const decoded = decodeScarcityMarketAccount(
      Uint8Array.from(Buffer.from(account.value.data[0], "base64")),
    ) as { status: string; closesAt: bigint };
    if (decoded.status !== "unresolved") { skipped.push({ slug, reason: `already ${decoded.status}` }); continue; }

    const [makerCollateral] = await deriveAssociatedTokenAddress(maker.address, collateralMint);
    const [makerYes] = await deriveAssociatedTokenAddress(maker.address, addresses.yesMint);
    const [makerNo] = await deriveAssociatedTokenAddress(maker.address, addresses.noMint);

    // Each market has its own outcome mints, so these accounts never exist on a first run.
    await submit([
      getCreateAssociatedTokenIdempotentInstruction({
        payer: maker.address, owner: maker.address, mint: addresses.yesMint, associatedToken: makerYes,
      }),
      getCreateAssociatedTokenIdempotentInstruction({
        payer: maker.address, owner: maker.address, mint: addresses.noMint, associatedToken: makerNo,
      }),
      await getMintCompleteSetInstruction({
        owner: maker.address, marketId, amount: quantity,
        ownerCollateral: makerCollateral, ownerYes: makerYes, ownerNo: makerNo, collateralMint,
      }),
    ], `${slug} mint`);

    for (const [label, outcomeMint, source] of [
      ["yes", addresses.yesMint, makerYes] as const,
      ["no", addresses.noMint, makerNo] as const,
    ]) {
      await submit([await getPlaceOrderInstruction({
        maker: maker.address, collateralMint, feeRecipient, marketId,
        orderId: new Uint8Array(randomBytes(32)),
        outcomeMint, makerSource: source, side: "ask",
        priceMicroUsdc: PRICE_MICRO_USDC, quantity,
        // Rest until the market itself closes.
        expiresAt: decoded.closesAt,
      })], `${slug} ask ${label}`);
    }
    quoted.push(slug);
  }

  console.log(JSON.stringify({
    cluster: "devnet", maker: String(maker.address),
    priceMicroUsdc: String(PRICE_MICRO_USDC), contractsPerSide: String(contracts),
    quoted, skipped,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  const logs = (error as { context?: { logs?: string[] } })?.context?.logs;
  if (logs?.length) console.error(logs.join("\n"));
  process.exitCode = 1;
});
