/**
 * Post both sides of upcoming Gold 15 rounds so a devnet tester has something to buy.
 *
 *   SCARCITY_ADMIN_KEYPAIR=~/.config/solana/id.json \
 *   SCARCITY_COLLATERAL_MINT=... SCARCITY_FEE_RECIPIENT=... \
 *   npx tsx scripts/run-pulse-maker-devnet.ts [roundsAhead] [contracts]
 *
 * A binary market with complete sets cannot give anyone a directional position on its own: minting
 * hands you both YES and NO, which nets to nothing. Someone has to be willing to sell a side. On a
 * live market that is a maker taking real risk; on devnet with no participants it is us, so this
 * mints complete sets and posts a YES ask and a NO ask at the same price.
 *
 * Pricing both sides at 0.50 is deliberate. The maker is not forecasting, it is providing the other
 * side so the tester's own choice is the only judgement in the round. If both sides fill, the mint
 * cost is recovered exactly and the operator is flat.
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
  type KeyPairSigner,
} from "@solana/kit";
import { METAL_PULSE_INTERVAL_SECONDS, pulseRoundStart } from "@/lib/metal-pulse";
import { compileMetalPulseMarket } from "@/lib/metal-pulse-market";
import {
  deriveAssociatedTokenAddress,
  deriveMarketAddresses,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintCompleteSetInstruction,
  getPlaceOrderInstruction,
} from "@/lib/scarcity-exchange";
import { hexToBytes } from "@/lib/scarcity-markets";

const PRICE_MICRO_USDC = 500_000n; // 0.50 per contract, both sides

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const rpcUrl = process.env.SCARCITY_RPC_URL?.trim() || "https://api.devnet.solana.com";
const wsUrl = process.env.SCARCITY_WS_URL?.trim() || "wss://api.devnet.solana.com";
const roundsAhead = Number(process.argv[2] ?? "2");
const contracts = BigInt(process.argv[3] ?? "50");

async function main() {
  const rpc = createSolanaRpc(rpcUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions: createSolanaRpcSubscriptions(wsUrl),
  });
  const keypairPath = required("SCARCITY_ADMIN_KEYPAIR").replace("~", process.env.HOME ?? "");
  const maker = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]),
  );
  const collateralMint = address(required("SCARCITY_COLLATERAL_MINT"));
  const feeRecipient = address(required("SCARCITY_FEE_RECIPIENT"));
  const quantity = contracts * 1_000_000n;

  const submit = async (instructions: Instruction | Instruction[], label: string) => {
    const list = Array.isArray(instructions) ? instructions : [instructions];
    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const signed = await signTransactionMessageWithSigners(pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayerSigner(maker as KeyPairSigner, draft),
      (draft) => setTransactionMessageLifetimeUsingBlockhash(blockhash, draft),
      (draft) => appendTransactionMessageInstructions(list, draft),
    ));
    await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
      commitment: "confirmed", skipPreflight: false,
    });
    process.stderr.write(`  ${label}: ${getSignatureFromTransaction(signed)}\n`);
  };

  const current = pulseRoundStart(Math.floor(Date.now() / 1_000));
  const quoted: string[] = [];

  for (let index = 0; index < roundsAhead; index += 1) {
    const startsAtUnix = current + (index + 1) * METAL_PULSE_INTERVAL_SECONDS;
    const compiled = compileMetalPulseMarket({ startsAtUnix, collateralMint });
    const marketId = hexToBytes(compiled.marketId);
    const addresses = await deriveMarketAddresses(marketId);

    const exists = await rpc.getAccountInfo(addresses.market, { encoding: "base64", commitment: "confirmed" }).send();
    if (!exists.value) {
      process.stderr.write(`  ${compiled.question.roundId}: not created yet, skipping\n`);
      continue;
    }

    const [makerCollateral] = await deriveAssociatedTokenAddress(maker.address, collateralMint);
    const [makerYes] = await deriveAssociatedTokenAddress(maker.address, addresses.yesMint);
    const [makerNo] = await deriveAssociatedTokenAddress(maker.address, addresses.noMint);

    // Every round mints its own YES and NO tokens, so the maker's outcome accounts never exist yet.
    // Creating them idempotently in the same transaction is what makes this safe to run on a cron:
    // without it the mint fails with AccountNotInitialized on every single round.
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
    ], `${compiled.question.roundId} mint`);

    // Trading closes fifteen seconds before the round opens, so the orders must expire with it.
    const expiresAt = BigInt(compiled.onchainSchedule.closesAt);
    for (const [label, outcomeMint, source] of [
      ["yes", addresses.yesMint, makerYes] as const,
      ["no", addresses.noMint, makerNo] as const,
    ]) {
      await submit(await getPlaceOrderInstruction({
        maker: maker.address, collateralMint, feeRecipient, marketId,
        orderId: new Uint8Array(randomBytes(32)),
        outcomeMint, makerSource: source, side: "ask",
        priceMicroUsdc: PRICE_MICRO_USDC, quantity, expiresAt,
      }), `${compiled.question.roundId} ask ${label}`);
    }
    quoted.push(compiled.question.roundId);
  }

  console.log(JSON.stringify({
    cluster: "devnet",
    maker: String(maker.address),
    priceMicroUsdc: String(PRICE_MICRO_USDC),
    contractsPerSide: String(contracts),
    quoted,
    note: "Both sides are quoted at 0.50 so the maker takes no view. If both fill, the mint cost is "
      + "recovered exactly. If only one fills, the maker holds the other side and carries that risk.",
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  // "Transaction simulation failed" on its own is not actionable on a cron run, so surface whatever
  // the RPC attached: the program logs are the only thing that says which require! rejected it.
  const logs = (error as { context?: { logs?: string[] } })?.context?.logs
    ?? (error as { cause?: { context?: { logs?: string[] } } })?.cause?.context?.logs;
  if (logs?.length) console.error(logs.join("\n"));
  process.exitCode = 1;
});
