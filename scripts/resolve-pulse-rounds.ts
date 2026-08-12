/**
 * Settle Gold 15 rounds whose observation window has closed.
 *
 *   SCARCITY_ADMIN_KEYPAIR=~/.config/solana/id.json \
 *   SCARCITY_COLLATERAL_MINT=... PYTH_API_KEY=... \
 *   npx tsx scripts/resolve-pulse-rounds.ts [lookbackRounds]
 *
 * An unresolved round holding someone's stake is worse than a round they could not enter, so this
 * is the piece that has to run reliably rather than the one that has to be clever. It walks back
 * over recent rounds, settles any that are on chain, past their resolution time and still open, and
 * leaves everything else alone.
 *
 * The outcome is never chosen here. `buildMetalPulseResolutionPacket` compares the committed
 * opening and closing Pyth observations and produces the outcome plus a hash of the canonical
 * report; a missing observation or an exact tie settles invalid, which refunds. This script only
 * decides WHICH rounds to act on.
 *
 * Idempotent: a round that is already resolved is skipped, so re-running after a partial failure is
 * safe and is the intended recovery.
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
import {
  buildMetalPulseResolutionPacket,
  compileMetalPulseMarket,
} from "@/lib/metal-pulse-market";
import { fetchMetalPulseRound } from "@/lib/metal-pulse-source";
import { decodeScarcityMarketAccount, deriveMarketAddresses } from "@/lib/scarcity-exchange";
import { hexToBytes } from "@/lib/scarcity-markets";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const rpcUrl = process.env.SCARCITY_RPC_URL?.trim() || "https://api.devnet.solana.com";
const wsUrl = process.env.SCARCITY_WS_URL?.trim() || "wss://api.devnet.solana.com";
const lookback = Number(process.argv[2] ?? "8");
if (!Number.isInteger(lookback) || lookback < 1 || lookback > 192) {
  throw new Error("Pass how many recent rounds to inspect, 1 through 192.");
}

async function main() {
  const rpc = createSolanaRpc(rpcUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions: createSolanaRpcSubscriptions(wsUrl),
  });
  const keypairPath = required("SCARCITY_ADMIN_KEYPAIR").replace("~", process.env.HOME ?? "");
  const resolver = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]),
  );
  const collateralMint = address(required("SCARCITY_COLLATERAL_MINT"));

  const nowUnix = Math.floor(Date.now() / 1_000);
  const current = pulseRoundStart(nowUnix);
  const resolved: Array<{ roundId: string; outcome: string; signature: string }> = [];
  const skipped: Array<{ roundId: string; reason: string }> = [];

  for (let index = 1; index <= lookback; index += 1) {
    const startsAtUnix = current - index * METAL_PULSE_INTERVAL_SECONDS;
    const compiled = compileMetalPulseMarket({ startsAtUnix, collateralMint });
    const roundId = compiled.question.roundId;

    if (nowUnix < Number(compiled.onchainSchedule.resolveAfter)) {
      skipped.push({ roundId, reason: "resolution time has not passed" });
      continue;
    }

    const addresses = await deriveMarketAddresses(hexToBytes(compiled.marketId));
    const account = await rpc
      .getAccountInfo(addresses.market, { encoding: "base64", commitment: "confirmed" })
      .send();
    if (!account.value) {
      skipped.push({ roundId, reason: "round was never created on chain" });
      continue;
    }
    const decoded = decodeScarcityMarketAccount(
      new Uint8Array(Buffer.from(account.value.data[0], "base64")),
    ) as { status: string };
    if (decoded.status !== "unresolved") {
      skipped.push({ roundId, reason: `already ${decoded.status}` });
      continue;
    }

    // The committed observations, fetched from the same feed the question names.
    const observed = await fetchMetalPulseRound({ startsAtUnix, apiKey: process.env.PYTH_API_KEY });
    if (observed.providerState === "degraded") {
      // Settling on a degraded feed would turn a provider outage into an invalid round and a refund
      // for people who were right. Leave it unresolved and let the next run try again.
      skipped.push({ roundId, reason: `price feed degraded: ${observed.providerMessage ?? "unknown"}` });
      continue;
    }
    const packet = await buildMetalPulseResolutionPacket({
      market: compiled,
      resolver: resolver.address,
      opening: observed.round.opening,
      closing: observed.round.closing,
      // The report pins a whole-second timestamp that must round-trip through toISOString(), so
      // the milliseconds field stays and is zeroed rather than stripped.
      generatedAt: new Date(Math.floor(Date.now() / 1_000) * 1_000).toISOString(),
    });

    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const signed = await signTransactionMessageWithSigners(pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayerSigner(resolver as KeyPairSigner, draft),
      (draft) => setTransactionMessageLifetimeUsingBlockhash(blockhash, draft),
      (draft) => appendTransactionMessageInstruction(packet.resolveInstruction, draft),
    ));
    await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
      commitment: "confirmed",
      skipPreflight: false,
    });
    const signature = getSignatureFromTransaction(signed);
    resolved.push({ roundId, outcome: packet.report.outcome, signature });
    process.stderr.write(`  ${roundId} → ${packet.report.outcome} ${signature}\n`);
    if (packet.report.invalidReason) {
      process.stderr.write(`     invalid: ${packet.report.invalidReason}\n`);
    }
  }

  console.log(JSON.stringify({
    cluster: "devnet",
    resolver: String(resolver.address),
    inspectedRounds: lookback,
    resolved,
    skipped,
    note: "Outcomes come from the committed Pyth observations, never from this script. A missing "
      + "observation or an exact tie settles invalid, which refunds one for one.",
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
