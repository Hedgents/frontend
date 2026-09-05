/**
 * Retire the superseded devnet curve market: invalidate it after resolve_after,
 * then claim the admin position one-for-one.
 *
 *   SCARCITY_RPC_URL=... SCARCITY_WS_URL=... SCARCITY_ADMIN_KEYPAIR=~/.config/solana/id.json \
 *   SCARCITY_COLLATERAL_MINT=... npm run scarcity:retire-superseded
 *
 * Safe to run at any time: before resolve_after it reports the unlock
 * timestamp and exits without sending anything. The signing key must be the
 * market's snapshotted resolver (for the devnet deployment this is the same
 * key as the admin). See ../scarcity-exchange/AUTHORITY_RUNBOOK.md step 4.
 *
 * After completion, annotate SCARCITY_DEVNET_DEPLOYMENT.json's supersededMarkets
 * entry with the printed transaction signatures.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import {
  CURVE_MARKET_ACCOUNT_SIZE,
  CURVE_POSITION_ACCOUNT_SIZE,
  decodeCurveMarketAccount,
  decodeCurvePositionAccount,
  deriveCurvePositionAddress,
  deriveAssociatedTokenAddress,
  getClaimCurvePositionInstruction,
  getInvalidateCurveMarketInstruction,
} from "@/lib/scarcity-exchange";
import { hexToBytes } from "@/lib/scarcity-markets";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

// The superseded market recorded in SCARCITY_DEVNET_DEPLOYMENT.json. Overridable so the
// script can retire any future superseded market without a code change.
const SUPERSEDED_MARKET = process.env.SCARCITY_SUPERSEDED_MARKET?.trim()
  || "C1Q5Bko58kvrUq2zjpHdCFxW5u5d1EDtTw5ZDW5NC9B5";
const SUPERSEDED_MARKET_ID = process.env.SCARCITY_SUPERSEDED_MARKET_ID?.trim()
  || "cef14ed322b2be1fe6cfdf5579ad929636c261990c233e9e0736b6d3dbc371f1";

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
  await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
    commitment: "confirmed",
    skipPreflight: false,
  });
  const signature = getSignatureFromTransaction(signed);
  process.stderr.write(`  ${label}: ${signature}\n`);
  return signature;
}

function decodeAccount(value: { data: unknown } | null, size: number, label: string): Uint8Array {
  if (!value) throw new Error(`${label} does not exist on-chain.`);
  const data = value.data as unknown as Array<string>;
  const [encoding, bytes] = data[0] === "base64" ? [data[0], data[1]] : ["base64", data[0]];
  void encoding;
  const decoded = Uint8Array.from(Buffer.from(bytes, "base64"));
  if (decoded.length !== size) throw new Error(`${label} has unexpected size ${decoded.length}.`);
  return decoded;
}

async function main() {
  const signer = await loadSigner(required("SCARCITY_ADMIN_KEYPAIR"));
  const collateralMint = address(required("SCARCITY_COLLATERAL_MINT"));
  const marketAddress = address(SUPERSEDED_MARKET);
  const marketId = hexToBytes(SUPERSEDED_MARKET_ID);

  const response = await rpc.getAccountInfo(marketAddress, { encoding: "base64", commitment: "confirmed" }).send();
  const market = decodeCurveMarketAccount(decodeAccount(response.value, CURVE_MARKET_ACCOUNT_SIZE, `Market ${SUPERSEDED_MARKET}`));
  if (market.marketId !== SUPERSEDED_MARKET_ID) {
    throw new Error(`On-chain marketId ${market.marketId} does not match ${SUPERSEDED_MARKET_ID}.`);
  }

  const unlock = Number(market.resolveAfter) * 1000;
  process.stderr.write(`market   ${SUPERSEDED_MARKET}\nstatus   ${market.status}\n`
    + `staked   ${market.totalStaked}\nresolve  after ${new Date(unlock).toISOString()}\n`);

  if (market.status === "invalid") {
    process.stderr.write("already invalidated; proceeding to claims.\n");
  } else if (market.status !== "unresolved") {
    throw new Error(`Unexpected market status ${market.status}; this script only retires unresolved markets.`);
  } else if (Date.now() < unlock) {
    process.stderr.write(`\nNot yet invalidatable. Run again after ${new Date(unlock).toISOString()}.\n`);
    console.log(JSON.stringify({ action: "waiting", unlockAt: new Date(unlock).toISOString() }, null, 2));
    return;
  }

  const result: Record<string, unknown> = {
    market: SUPERSEDED_MARKET,
    marketId: SUPERSEDED_MARKET_ID,
    statusBefore: market.status,
  };

  if (market.status === "unresolved") {
    // Content-addressed record of why the market is being invalidated.
    const reportHash = Uint8Array.from(createHash("sha256")
      .update(`supersede:${SUPERSEDED_MARKET_ID}:collateral-shape-mismatch`)
      .digest());
    result.invalidateSignature = await submit(signer, await getInvalidateCurveMarketInstruction({
      resolver: signer.address,
      marketId,
      resolutionReportHash: reportHash,
    }), "invalidate_curve_market");
  }

  // Locate the signer's funded positions: derive the canonical PDA per bucket.
  const [ownerCollateral] = await deriveAssociatedTokenAddress(signer.address, collateralMint);
  const claims: Array<{ bucket: number; stake: string; signature: string }> = [];
  for (let bucket = 0; bucket < market.bucketCount; bucket++) {
    const [positionAddress] = await deriveCurvePositionAddress({
      market: marketAddress,
      owner: signer.address,
      bucket,
    });
    const positionResponse = await rpc
      .getAccountInfo(positionAddress, { encoding: "base64", commitment: "confirmed" })
      .send();
    if (!positionResponse.value) continue;
    const position = decodeCurvePositionAccount(
      decodeAccount(positionResponse.value, CURVE_POSITION_ACCOUNT_SIZE, `Position ${positionAddress}`),
    );
    if (position.stake === 0n || position.claimed) continue;
    claims.push({
      bucket,
      stake: position.stake.toString(),
      signature: await submit(signer, await getClaimCurvePositionInstruction({
        owner: signer.address,
        collateralMint,
        ownerCollateral,
        marketId,
        bucket,
      }), `claim_curve_position bucket ${bucket}`),
    });
  }
  result.claims = claims;
  result.refunded = claims.reduce((total, claim) => total + BigInt(claim.stake), 0n).toString();

  process.stderr.write(`\nrefunded ${result.refunded} base units across ${claims.length} position(s).\n`
    + "Annotate SCARCITY_DEVNET_DEPLOYMENT.json's supersededMarkets entry with these signatures.\n");
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
