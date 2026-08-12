/**
 * Create Gold 15 rounds on devnet so testers can actually take a side.
 *
 *   SCARCITY_ADMIN_KEYPAIR=~/.config/solana/id.json \
 *   SCARCITY_COLLATERAL_MINT=... \
 *   npx tsx scripts/create-pulse-rounds-devnet.ts [roundsAhead]
 *
 * A round is an ordinary binary market whose id is a pure function of its 15-minute boundary and
 * the collateral mint, so this needs no registry: run it on a schedule and it keeps the next few
 * rounds open. Already-created rounds are skipped, so re-running is safe.
 *
 * Trading opens a full interval before the round starts and freezes 15 seconds before it, which is
 * what stops a taker entering once the opening price is effectively known.
 */
import { readFileSync } from "node:fs";
import {
  address,
  appendTransactionMessageInstruction,
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
  type KeyPairSigner,
} from "@solana/kit";
import { METAL_PULSE_INTERVAL_SECONDS, pulseRoundStart } from "@/lib/metal-pulse";
import { buildMetalPulseCreatePacket } from "@/lib/metal-pulse-market";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const rpcUrl = process.env.SCARCITY_RPC_URL?.trim() || "https://api.devnet.solana.com";
const wsUrl = process.env.SCARCITY_WS_URL?.trim() || "wss://api.devnet.solana.com";
const roundsAhead = Number(process.argv[2] ?? "4");
if (!Number.isInteger(roundsAhead) || roundsAhead < 1 || roundsAhead > 96) {
  throw new Error("Pass how many upcoming rounds to open, 1 through 96.");
}

async function main() {
  const rpc = createSolanaRpc(rpcUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions: createSolanaRpcSubscriptions(wsUrl),
  });
  const keypairPath = required("SCARCITY_ADMIN_KEYPAIR").replace("~", process.env.HOME ?? "");
  const admin = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]),
  );
  const collateralMint = address(required("SCARCITY_COLLATERAL_MINT"));

  const nowUnix = Math.floor(Date.now() / 1_000);
  const current = pulseRoundStart(nowUnix);
  const created: string[] = [];
  const skipped: string[] = [];

  for (let index = 0; index < roundsAhead; index += 1) {
    const startsAtUnix = current + (index + 1) * METAL_PULSE_INTERVAL_SECONDS;
    const packet = await buildMetalPulseCreatePacket({ startsAtUnix, admin: admin.address, collateralMint });
    const existing = await rpc
      .getAccountInfo(packet.addresses.market, { encoding: "base64", commitment: "confirmed" })
      .send();
    if (existing.value) {
      skipped.push(packet.market.question.roundId);
      continue;
    }
    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const signed = await signTransactionMessageWithSigners(pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayerSigner(admin as KeyPairSigner, draft),
      (draft) => setTransactionMessageLifetimeUsingBlockhash(blockhash, draft),
      (draft) => appendTransactionMessageInstruction(packet.createInstruction, draft),
    ));
    await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
      commitment: "confirmed",
      skipPreflight: false,
    });
    created.push(packet.market.question.roundId);
    process.stderr.write(`  ${packet.market.question.roundId} ${getSignatureFromTransaction(signed)}\n`);
  }

  console.log(JSON.stringify({
    cluster: "devnet",
    admin: String(admin.address),
    collateralMint: String(collateralMint),
    created,
    skipped,
    note: "Round ids and every account address derive from the 15-minute boundary, so nothing needs "
      + "recording here. Re-run on a schedule to keep the next rounds open.",
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
