/**
 * Bootstrap the lithium tightness curve market on devnet.
 *
 *   SCARCITY_RPC_URL=... SCARCITY_WS_URL=... SCARCITY_ADMIN_KEYPAIR=~/.config/solana/id.json \
 *   SCARCITY_COLLATERAL_MINT=... SCARCITY_FEE_RECIPIENT=... \
 *   npx tsx scripts/deploy-lithium-curve-devnet.ts
 *
 * Initialises the exchange config if it does not exist, then creates one curve round whose
 * marketId, metricHash and rulesHash come from `compileLithiumRound`, not from a synthetic label.
 * Those three are immutable after creation and `verifyCurveCommitments` requires an exact match, so
 * a market created against a placeholder hash can never be repaired, only abandoned.
 *
 * Idempotent: an existing config or market is reported and left alone.
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
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import {
  deriveConfigAddress,
  deriveCurveMarketAddresses,
  getCreateCurveMarketInstruction,
  getInitializeConfigInstruction,
} from "@/lib/scarcity-exchange";
import { compileLithiumRound, type LithiumRoundWindow } from "@/lib/scarcity/lithium-market";
import { hexToBytes } from "@/lib/scarcity-markets";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const rpcUrl = required("SCARCITY_RPC_URL");
const wsUrl = required("SCARCITY_WS_URL");
const rpc = createSolanaRpc(rpcUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

async function loadSigner(path: string) {
  const expanded = path.startsWith("~") ? path.replace("~", process.env.HOME ?? "") : path;
  const bytes = Uint8Array.from(JSON.parse(readFileSync(expanded, "utf8")) as number[]);
  return createKeyPairSignerFromBytes(bytes);
}

async function submit(signer: KeyPairSigner, instruction: Instruction, label: string) {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (draft) => setTransactionMessageFeePayerSigner(signer, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash(blockhash, draft),
    (draft) => appendTransactionMessageInstruction(instruction, draft),
  );
  const signed = await signTransactionMessageWithSigners(message);
  // The signed transaction's lifetime is a union of blockhash and durable-nonce; the factory only
  // accepts the blockhash arm. Same narrowing the localnet harness uses.
  await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
    commitment: "confirmed",
    skipPreflight: false,
  });
  const signature = getSignatureFromTransaction(signed);
  process.stderr.write(`  ${label}: ${signature}\n`);
  return signature;
}

async function accountExists(target: Address) {
  const response = await rpc.getAccountInfo(target, { encoding: "base64", commitment: "confirmed" }).send();
  return response.value !== null;
}

/**
 * The first round. Staking locks a clear span before the observation date so no part of the
 * trailing median window is visible at close.
 */
function firstRound(): LithiumRoundWindow {
  const opens = new Date(required("SCARCITY_ROUND_OPENS_AT"));
  const closes = new Date(required("SCARCITY_ROUND_CLOSES_AT"));
  const observed = new Date(required("SCARCITY_ROUND_OBSERVED_AT"));
  const resolveAfter = new Date(required("SCARCITY_ROUND_RESOLVE_AFTER"));
  if (!(opens < closes && closes < observed && observed <= resolveAfter)) {
    throw new Error("Round window must satisfy opensAt < closesAt < observedAt <= resolveAfter.");
  }
  return {
    round: required("SCARCITY_ROUND_LABEL"),
    opensAt: opens.toISOString(),
    closesAt: closes.toISOString(),
    observedAt: observed.toISOString(),
    resolveAfter: resolveAfter.toISOString(),
  };
}

async function main() {
  const admin = await loadSigner(required("SCARCITY_ADMIN_KEYPAIR"));
  const collateralMint = address(required("SCARCITY_COLLATERAL_MINT"));
  const feeRecipient = address(required("SCARCITY_FEE_RECIPIENT"));
  const resolver = address(process.env.SCARCITY_RESOLVER?.trim() || String(admin.address));
  const tradingFeeBps = Number(process.env.SCARCITY_TRADING_FEE_BPS ?? "25");

  const [config] = await deriveConfigAddress();
  const configExists = await accountExists(config);
  process.stderr.write(`admin ${admin.address}\nconfig ${config} ${configExists ? "(exists)" : "(creating)"}\n`);
  if (!configExists) {
    await submit(admin, await getInitializeConfigInstruction({
      admin: admin.address,
      resolver,
      collateralMint,
      feeRecipient,
      tradingFeeBps,
    }), "initialize_config");
  }

  const round = firstRound();
  const compiled = compileLithiumRound(round);
  const marketIdBytes = hexToBytes(compiled.marketId);
  const { market, vault } = await deriveCurveMarketAddresses(marketIdBytes);
  const marketExists = await accountExists(market);

  process.stderr.write(`\nround ${round.round}\n  slug        ${compiled.slug}\n`
    + `  marketId    ${compiled.marketId}\n  metricHash  ${compiled.metricHash}\n`
    + `  rulesHash   ${compiled.rulesHash}\n  market      ${market} ${marketExists ? "(exists)" : "(creating)"}\n`);

  if (!marketExists) {
    await submit(admin, await getCreateCurveMarketInstruction({
      admin: admin.address,
      collateralMint,
      feeRecipient,
      marketId: marketIdBytes,
      metricHash: hexToBytes(compiled.metricHash),
      rulesHash: hexToBytes(compiled.rulesHash),
      opensAt: BigInt(Math.floor(Date.parse(round.opensAt) / 1000)),
      closesAt: BigInt(Math.floor(Date.parse(round.closesAt) / 1000)),
      resolveAfter: BigInt(Math.floor(Date.parse(round.resolveAfter) / 1000)),
      bucketCount: 41,
      jackpotBps: 2_000,
    }), "create_curve_market");
  }

  console.log(JSON.stringify({
    cluster: "devnet",
    admin: String(admin.address),
    resolver: String(resolver),
    config: String(config),
    collateralMint: String(collateralMint),
    feeRecipient: String(feeRecipient),
    tradingFeeBps,
    round: {
      ...round,
      slug: compiled.slug,
      marketId: compiled.marketId,
      metricHash: compiled.metricHash,
      rulesHash: compiled.rulesHash,
      market: String(market),
      vault: String(vault),
      bucketCount: 41,
      jackpotBps: 2_000,
    },
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
