/**
 * Prove a devnet tester can actually take a side on Gold 15.
 *
 *   SCARCITY_ADMIN_KEYPAIR=~/.config/solana/id.json \
 *   SCARCITY_COLLATERAL_MINT=... SCARCITY_FEE_RECIPIENT=... \
 *   HEDGENTS_SCARCITY_DEVNET_RPC_URLS=https://api.devnet.solana.com \
 *   npx tsx scripts/verify-pulse-fill-devnet.ts [stakeUnits]
 *
 * The screen quotes a cost before the wallet opens, so the thing worth verifying is not "does a fill
 * succeed" but "does the wallet debit exactly what the screen promised". This funds a throwaway
 * taker, prices a ticket through the same module the browser uses, submits the same instruction list
 * the browser builds, and then compares the real balance change against the quote.
 *
 * A fresh keypair each run is deliberate: it exercises the first-time path, where neither the
 * taker's outcome account nor the maker's collateral account is guaranteed to exist.
 */
import { readFileSync } from "node:fs";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@/lib/scarcity-exchange";
import { METAL_PULSE_INTERVAL_SECONDS, pulseRoundStart } from "@/lib/metal-pulse";
import { deriveMetalPulseRound, readMetalPulseBook } from "@/lib/metal-pulse-chain";
import {
  formatPulseAmount,
  priceMetalPulseTicket,
  PULSE_TOKEN_SCALE,
} from "@/lib/metal-pulse-ticket";
import {
  deriveAssociatedTokenAddress,
  getCreateAssociatedTokenIdempotentInstruction,
  getFillAskInstruction,
  hexToBytes,
} from "@/lib/scarcity-exchange";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function u64(value: bigint) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

/** System program `Transfer`: a u32 variant tag followed by the lamport amount. */
function transferSol(input: { source: Address; destination: Address; lamports: bigint }): Instruction {
  return {
    programAddress: SYSTEM_PROGRAM_ADDRESS,
    accounts: [
      { address: input.source, role: AccountRole.WRITABLE_SIGNER },
      { address: input.destination, role: AccountRole.WRITABLE },
    ],
    data: Uint8Array.from([2, 0, 0, 0, ...u64(input.lamports)]),
  };
}

/** Token program `MintTo`, instruction 7. The authority signs as the fee payer here. */
function mintTo(input: { mint: Address; destination: Address; authority: Address; amount: bigint }): Instruction {
  return {
    programAddress: TOKEN_PROGRAM_ADDRESS,
    accounts: [
      { address: input.mint, role: AccountRole.WRITABLE },
      { address: input.destination, role: AccountRole.WRITABLE },
      { address: input.authority, role: AccountRole.READONLY_SIGNER },
    ],
    data: Uint8Array.from([7, ...u64(input.amount)]),
  };
}

const rpcUrl = process.env.SCARCITY_RPC_URL?.trim() || "https://api.devnet.solana.com";
const wsUrl = process.env.SCARCITY_WS_URL?.trim() || "wss://api.devnet.solana.com";
const stakeUnits = BigInt(process.argv[2] ?? "5");
const side = (process.argv[3] ?? "yes") as "yes" | "no";
if (side !== "yes" && side !== "no") throw new Error("Pass yes or no as the side.");

async function main() {
  const rpc = createSolanaRpc(rpcUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions: createSolanaRpcSubscriptions(wsUrl),
  });
  const admin = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(
      required("SCARCITY_ADMIN_KEYPAIR").replace("~", process.env.HOME ?? ""), "utf8",
    ) as string) as number[]),
  );
  const collateralMint = address(required("SCARCITY_COLLATERAL_MINT"));

  const submit = async (signer: KeyPairSigner, instructions: Instruction[], label: string) => {
    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const signed = await signTransactionMessageWithSigners(pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayerSigner(signer, draft),
      (draft) => setTransactionMessageLifetimeUsingBlockhash(blockhash, draft),
      (draft) => appendTransactionMessageInstructions(instructions, draft),
    ));
    await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
      commitment: "confirmed", skipPreflight: false,
    });
    const signature = getSignatureFromTransaction(signed);
    process.stderr.write(`  ${label}: ${signature}\n`);
    return signature;
  };

  const balanceOf = async (tokenAccount: Address) => {
    const response = await rpc.getTokenAccountBalance(tokenAccount, { commitment: "confirmed" }).send()
      .catch(() => null);
    return response ? BigInt(response.value.amount) : 0n;
  };

  // The round currently open for entry, which is the one the screen offers.
  const nowUnix = Math.floor(Date.now() / 1_000);
  const round = await deriveMetalPulseRound({
    startsAtUnix: pulseRoundStart(nowUnix) + METAL_PULSE_INTERVAL_SECONDS,
    collateralMint,
  });
  const book = await readMetalPulseBook({ ...round, nowUnix });
  if (!book.onChain) throw new Error(`${round.roundId} is not on chain. Run the creator script first.`);
  if (book.paused) throw new Error("The exchange is paused.");
  const offer = book.offers[side];
  if (!offer) throw new Error(`No resting ask on the ${side} side. Run the maker script first.`);

  // Exactly what the screen would quote.
  const ticket = priceMetalPulseTicket({ offer, stake: stakeUnits * PULSE_TOKEN_SCALE });
  if (!ticket) throw new Error("The offer could not price this stake.");

  const taker = await generateKeyPairSigner();
  const [takerCollateral] = await deriveAssociatedTokenAddress(taker.address, collateralMint);
  const outcomeMint = address(side === "yes" ? round.yesMint : round.noMint);
  const [takerOutcome] = await deriveAssociatedTokenAddress(taker.address, outcomeMint);
  const maker = address(offer.maker);
  const [makerCollateral] = await deriveAssociatedTokenAddress(maker, collateralMint);

  // Fund the throwaway taker: SOL for fees and rent, and enough test collateral to cover the bet.
  const funding = (stakeUnits + 5n) * PULSE_TOKEN_SCALE;
  await submit(admin, [
    transferSol({ source: admin.address, destination: taker.address, lamports: 30_000_000n }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer: admin.address, owner: taker.address, mint: collateralMint, associatedToken: takerCollateral,
    }),
    mintTo({
      mint: collateralMint, destination: takerCollateral, authority: admin.address, amount: funding,
    }),
  ], "fund taker");

  // `fee_recipient` is a token account, not a wallet. On devnet it happens to be the operator's own
  // associated account, which is also where the maker is paid, so the two credits land together and
  // have to be checked as a sum rather than separately.
  const feeRecipient = address(required("SCARCITY_FEE_RECIPIENT"));
  const feeSharesMakerAccount = String(feeRecipient) === String(makerCollateral);
  const collateralBefore = await balanceOf(takerCollateral);
  const makerBefore = await balanceOf(makerCollateral);
  const feeBefore = feeSharesMakerAccount ? makerBefore : await balanceOf(feeRecipient);

  // The browser's instruction list, built from the same helpers the component calls.
  const signature = await submit(taker, [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: taker.address, owner: maker, mint: collateralMint, associatedToken: makerCollateral,
    }),
    getCreateAssociatedTokenIdempotentInstruction({
      payer: taker.address, owner: taker.address, mint: outcomeMint, associatedToken: takerOutcome,
    }),
    await getFillAskInstruction({
      maker,
      taker: taker.address,
      collateralMint,
      feeRecipient,
      marketId: hexToBytes(round.marketId),
      orderId: hexToBytes(offer.orderId),
      outcomeMint,
      makerCollateral,
      takerCollateral,
      takerOutcome,
      quantity: ticket.quantity,
    }),
  ], `fill ${side}`);

  const collateralAfter = await balanceOf(takerCollateral);
  const contracts = await balanceOf(takerOutcome);
  const debited = collateralBefore - collateralAfter;
  const makerAfter = await balanceOf(makerCollateral);
  const makerReceived = makerAfter - makerBefore;
  const feeReceived = (feeSharesMakerAccount ? makerAfter : await balanceOf(feeRecipient)) - feeBefore;

  const quoteMatches = debited === ticket.cost;
  const contractsMatch = contracts === ticket.quantity;
  // Nothing may go missing: every base unit the taker paid must land on the maker or the fee
  // account, and the split must be the one the screen showed.
  const creditsMatch = feeSharesMakerAccount
    ? makerReceived === ticket.gross + ticket.fee
    : makerReceived === ticket.gross && feeReceived === ticket.fee;

  console.log(JSON.stringify({
    cluster: "devnet",
    round: round.roundId,
    side,
    taker: String(taker.address),
    signature,
    quoted: {
      contracts: formatPulseAmount(ticket.quantity),
      toMaker: formatPulseAmount(ticket.gross),
      fee: formatPulseAmount(ticket.fee),
      cost: formatPulseAmount(ticket.cost),
      paysIfRight: formatPulseAmount(ticket.payout),
    },
    observed: {
      debited: formatPulseAmount(debited),
      contracts: formatPulseAmount(contracts),
      makerReceived: formatPulseAmount(makerReceived),
      feeAccountReceived: formatPulseAmount(feeReceived),
      feeSharesMakerAccount,
    },
    checks: { quoteMatches, contractsMatch, creditsMatch },
    verdict: quoteMatches && contractsMatch && creditsMatch
      ? "The wallet debited exactly what the screen quoted."
      : "MISMATCH between the quoted ticket and the on-chain result.",
  }, null, 2));

  if (!quoteMatches || !contractsMatch || !creditsMatch) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  const logs = (error as { context?: { logs?: string[] } })?.context?.logs
    ?? (error as { cause?: { context?: { logs?: string[] } } })?.cause?.context?.logs;
  if (logs?.length) console.error(logs.join("\n"));
  process.exitCode = 1;
});
