/**
 * Open a few catalog event markets on devnet so the event instrument is actually testable.
 *
 *   SCARCITY_ADMIN_KEYPAIR=~/.config/solana/id.json \
 *   SCARCITY_COLLATERAL_MINT=... \
 *   npx tsx --conditions=react-server scripts/deploy-devnet-test-markets.ts [slug ...]
 *
 * The only thing changed from the published specification is `opens_at`, which is set to now. The
 * market id, question hash and rules hash are the catalog's own, and the close and resolution times
 * come from the catalog's lifecycle, so a tester reads the real question and trades the real
 * contract. The single deployed market today does not open for another eighteen days, which is why
 * the instrument reads "trading disabled" no matter what else works.
 *
 * Creating a market requires the exchange admin, so this cannot run anywhere but an operator
 * machine.
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
} from "@solana/kit";
import { getStoredScarcityMarket } from "@/lib/scarcity-market-store";
import {
  deriveMarketAddresses,
  getCreateMarketInstruction,
  hexToBytes,
} from "@/lib/scarcity-exchange";

const DEFAULT_SLUGS = [
  "gold-tightness-62-2026",
  "silver-tightness-72-2026",
  "copper-tightness-70-2026",
];

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const rpcUrl = process.env.SCARCITY_RPC_URL?.trim() || "https://api.devnet.solana.com";
const wsUrl = process.env.SCARCITY_WS_URL?.trim() || "wss://api.devnet.solana.com";
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SLUGS;

function unixFrom(value: unknown, fallback: number) {
  if (typeof value !== "string") return fallback;
  const parsed = Math.floor(Date.parse(value) / 1_000);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
  const rpc = createSolanaRpc(rpcUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc, rpcSubscriptions: createSolanaRpcSubscriptions(wsUrl),
  });
  const admin = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(
      required("SCARCITY_ADMIN_KEYPAIR").replace("~", process.env.HOME ?? ""), "utf8",
    ) as string) as number[]),
  );
  const collateralMint = address(required("SCARCITY_COLLATERAL_MINT"));
  const nowUnix = Math.floor(Date.now() / 1_000);

  const deployed: unknown[] = [];
  const skipped: unknown[] = [];

  for (const slug of slugs) {
    const catalog = await getStoredScarcityMarket(slug) as Record<string, any> | null;
    if (!catalog?.marketId) { skipped.push({ slug, reason: "not in the catalog" }); continue; }
    const marketId = hexToBytes(catalog.marketId);
    const addresses = await deriveMarketAddresses(marketId);
    const existing = await rpc
      .getAccountInfo(addresses.market, { encoding: "base64", commitment: "confirmed" }).send();
    if (existing.value) { skipped.push({ slug, reason: "already on chain" }); continue; }

    // The catalog's own close and resolution times; only the open is brought forward to now, so a
    // tester reads the published question and trades against the published schedule.
    const schedule = catalog.rules?.schedule ?? {};
    const closesAt = unixFrom(schedule.closesAt, nowUnix + 120 * 24 * 3600);
    const resolveAfter = unixFrom(schedule.resolveAfter, closesAt + 24 * 3600);
    if (closesAt <= nowUnix) { skipped.push({ slug, reason: "its published close has already passed" }); continue; }

    const instruction = await getCreateMarketInstruction({
      admin: admin.address,
      collateralMint,
      marketId,
      questionHash: hexToBytes(catalog.questionHash),
      rulesHash: hexToBytes(catalog.rulesHash),
      opensAt: BigInt(nowUnix),
      closesAt: BigInt(closesAt),
      resolveAfter: BigInt(resolveAfter),
    });

    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const signed = await signTransactionMessageWithSigners(pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayerSigner(admin, draft),
      (draft) => setTransactionMessageLifetimeUsingBlockhash(blockhash, draft),
      (draft) => appendTransactionMessageInstruction(instruction, draft),
    ));
    await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
      commitment: "confirmed", skipPreflight: false,
    });
    const signature = getSignatureFromTransaction(signed);
    deployed.push({
      slug, market: String(addresses.market), opensAt: nowUnix, closesAt, resolveAfter, signature,
    });
    process.stderr.write(`  ${slug} ${signature}\n`);
  }

  console.log(JSON.stringify({ cluster: "devnet", admin: String(admin.address), deployed, skipped }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  const logs = (error as { context?: { logs?: string[] } })?.context?.logs;
  if (logs?.length) console.error(logs.join("\n"));
  process.exitCode = 1;
});
