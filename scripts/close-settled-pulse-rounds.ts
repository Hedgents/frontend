/**
 * Reclaim rent from settled Gold 15 rounds, and from orders that expired unfilled.
 *
 *   SCARCITY_ADMIN_KEYPAIR=~/.config/solana/id.json \
 *   SCARCITY_COLLATERAL_MINT=... \
 *   npx tsx --conditions=react-server scripts/close-settled-pulse-rounds.ts [lookbackRounds]
 *
 * A round costs about 0.0087 SOL to create and none of it used to come back, which at ninety-six
 * rounds a day was the dominant running cost of the price market. Closing recovers the market
 * account and its vault; the two outcome mints cannot be closed by the SPL token program, so about
 * a third stays spent.
 *
 * Order accounts are separate and fully recoverable: `cancel_order` closes them to the maker.
 *
 * Nothing here can strand a claim. The program refuses to close a market whose vault still owes
 * anything, so a round where someone holds unredeemed winnings simply stays open. The operator's own
 * winnings are redeemed first, since its unredeemed position would otherwise block its own cleanup.
 */
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
import { METAL_PULSE_INTERVAL_SECONDS, pulseRoundStart } from "@/lib/metal-pulse";
import { compileMetalPulseMarket } from "@/lib/metal-pulse-market";
import {
  decodeLimitOrderAccount,
  decodeScarcityMarketAccount,
  deriveAssociatedTokenAddress,
  deriveMarketAddresses,
  getCancelOrderInstruction,
  getCloseMarketInstruction,
  getRedeemInstruction,
  hexToBytes,
  limitOrderDiscriminatorBase64,
  SCARCITY_EXCHANGE_PROGRAM_ADDRESS,
  SCARCITY_ORDER_ACCOUNT_SIZE,
  SCARCITY_ORDER_MARKET_OFFSET,
  TOKEN_PROGRAM_ADDRESS,
} from "@/lib/scarcity-exchange";
import { AccountRole, getAddressEncoder } from "@solana/kit";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const rpcUrl = process.env.SCARCITY_RPC_URL?.trim() || "https://api.devnet.solana.com";
const wsUrl = process.env.SCARCITY_WS_URL?.trim() || "wss://api.devnet.solana.com";
const lookback = Number(process.argv[2] ?? "96");

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

  const submit = async (instructions: Instruction[]) => {
    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const signed = await signTransactionMessageWithSigners(pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayerSigner(admin, draft),
      (draft) => setTransactionMessageLifetimeUsingBlockhash(blockhash, draft),
      (draft) => appendTransactionMessageInstructions(instructions, draft),
    ));
    await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
      commitment: "confirmed", skipPreflight: false,
    });
    return getSignatureFromTransaction(signed);
  };

  // A missing token account is a real zero. Any other failure is not, and must not be read as one:
  // treating a failed read as an empty balance skips the redeem and then blames the close.
  const balanceOf = async (account: string) => {
    try {
      const response = await rpc.getTokenAccountBalance(account as never, { commitment: "confirmed" }).send();
      return BigInt(response.value.amount);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/could not find account|not found/i.test(message)) return 0n;
      throw new Error(`Could not read ${account}: ${message}`);
    }
  };

  // getProgramAccounts is expensive and not every provider serves it; the public devnet endpoint
  // does, so it is always tried as a fallback.
  const orderEndpoints = [...new Set([rpcUrl, "https://api.devnet.solana.com"])];
  const readOrders = async (market: unknown) => {
    let lastError: unknown = null;
    for (const endpoint of orderEndpoints) {
      try {
        const payload = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: "orders", method: "getProgramAccounts",
            params: [String(SCARCITY_EXCHANGE_PROGRAM_ADDRESS), {
              encoding: "base64", commitment: "confirmed",
              filters: [
                { dataSize: SCARCITY_ORDER_ACCOUNT_SIZE },
                { memcmp: { offset: 0, bytes: limitOrderDiscriminatorBase64(), encoding: "base64" } },
                {
                  memcmp: {
                    offset: SCARCITY_ORDER_MARKET_OFFSET,
                    bytes: Buffer.from(getAddressEncoder().encode(market as never)).toString("base64"),
                    encoding: "base64",
                  },
                },
              ],
            }],
          }),
        }).then((response) => response.json() as Promise<{
          result?: Array<{ account: { data: [string, string] } }>;
          error?: { message?: string };
        }>);
        if (payload.error) throw new Error(payload.error.message ?? "getProgramAccounts failed");
        return payload.result ?? [];
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("No endpoint could read the order book.");
  };

  const startLamports = BigInt((await rpc.getBalance(admin.address, { commitment: "confirmed" }).send()).value);
  const current = pulseRoundStart(Math.floor(Date.now() / 1_000));
  const closed: string[] = [];
  const blocked: Array<{ roundId: string; reason: string }> = [];
  const redeemFailures: Array<Record<string, string>> = [];
  let cancelled = 0;

  for (let index = 1; index <= lookback; index += 1) {
    const startsAtUnix = current - index * METAL_PULSE_INTERVAL_SECONDS;
    const compiled = compileMetalPulseMarket({ startsAtUnix, collateralMint });
    const marketId = hexToBytes(compiled.marketId);
    const addresses = await deriveMarketAddresses(marketId);
    const account = await rpc
      .getAccountInfo(addresses.market, { encoding: "base64", commitment: "confirmed" }).send();
    if (!account.value) continue;
    const market = decodeScarcityMarketAccount(
      Uint8Array.from(Buffer.from(account.value.data[0], "base64")),
    );
    if (market.status === "unresolved") continue;

    // Cancel the operator's resting orders first. `place_order` escrows the outcome tokens into the
    // order's own vault, so an ask leaves the maker's account empty and there is nothing to redeem
    // until the order is cancelled. Cancelling also closes the order account back to the maker,
    // which is where most of the recoverable rent per round actually is.
    // Plain JSON-RPC: kit's typed getProgramAccounts rejects these filters with a 400. It also
    // walks endpoints, because Alchemy's free tier refuses getProgramAccounts outright and a single
    // provider that will not serve the method would otherwise look like "this market has no orders".
    const orderAccounts = await readOrders(addresses.market);

    for (const entry of orderAccounts as Array<{ account: { data: [string, string] } }>) {
      const order = decodeLimitOrderAccount(Uint8Array.from(Buffer.from(entry.account.data[0], "base64")));
      if (String(order.maker) !== String(admin.address)) continue;
      const escrowMint = order.side === "ask" ? order.outcomeMint : collateralMint;
      const [makerRefund] = await deriveAssociatedTokenAddress(admin.address, escrowMint);
      try {
        await submit([await getCancelOrderInstruction({
          maker: admin.address, marketId, orderId: hexToBytes(order.orderId),
          escrowMint, makerRefund,
        })]);
        cancelled += 1;
      } catch (error) {
        redeemFailures.push({
          roundId: compiled.question.roundId, stage: "cancel",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Redeem the operator's own winnings; they would otherwise block the close.
    const winningMint = market.status === "resolved-yes" ? addresses.yesMint
      : market.status === "resolved-no" ? addresses.noMint : null;
    const claimMints = winningMint ? [winningMint] : [addresses.yesMint, addresses.noMint];
    const [adminCollateral] = await deriveAssociatedTokenAddress(admin.address, collateralMint);
    for (const claimMint of claimMints) {
      const [adminClaim] = await deriveAssociatedTokenAddress(admin.address, claimMint);
      const held = await balanceOf(String(adminClaim));
      if (held === 0n) continue;
      try {
        await submit([await getRedeemInstruction({
          owner: admin.address, marketId, amount: held, collateralMint,
          ownerCollateral: adminCollateral, claimMint, ownerClaim: adminClaim,
        })]);
      } catch (error) {
        // Worth surfacing: an unredeemed operator position is the usual reason a close is refused.
        redeemFailures.push({
          roundId: compiled.question.roundId,
          claimMint: String(claimMint),
          held: held.toString(),
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // The operator's own outcome accounts are empty once orders are cancelled and winnings
    // redeemed, and each round mints fresh ones, so leaving them behind leaks rent every round.
    // Only the two mints are then unrecoverable, the SPL token program having no way to close them.
    const closeAtas: Instruction[] = [];
    for (const mint of [addresses.yesMint, addresses.noMint]) {
      const [ata] = await deriveAssociatedTokenAddress(admin.address, mint);
      if ((await balanceOf(String(ata))) !== 0n) continue;
      const exists = await rpc.getAccountInfo(ata, { encoding: "base64", commitment: "confirmed" }).send();
      if (!exists.value) continue;
      closeAtas.push({
        programAddress: TOKEN_PROGRAM_ADDRESS,
        accounts: [
          { address: ata, role: AccountRole.WRITABLE },
          { address: admin.address, role: AccountRole.WRITABLE },
          { address: admin.address, role: AccountRole.READONLY_SIGNER },
        ],
        data: Uint8Array.of(9), // SPL Token CloseAccount
      });
    }
    if (closeAtas.length) await submit(closeAtas).catch(() => null);

    try {
      const signature = await submit([await getCloseMarketInstruction({
        admin: admin.address, marketId,
      })]);
      closed.push(compiled.question.roundId);
      process.stderr.write(`  closed ${compiled.question.roundId} ${signature}\n`);
    } catch (error) {
      // Expected whenever somebody else still holds unredeemed winnings.
      blocked.push({
        roundId: compiled.question.roundId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const endLamports = BigInt((await rpc.getBalance(admin.address, { commitment: "confirmed" }).send()).value);
  console.log(JSON.stringify({
    cluster: "devnet",
    inspectedRounds: lookback,
    ordersCancelled: cancelled,
    closed: closed.length,
    blocked: blocked.length,
    reclaimedSol: Number(endLamports - startLamports) / 1e9,
    blockedDetail: blocked.slice(0, 5),
    redeemFailures: redeemFailures.slice(0, 5),
    note: "A blocked round has unredeemed winnings outstanding. The program refuses to close it, "
      + "which is the guard working rather than a failure.",
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  const logs = (error as { context?: { logs?: string[] } })?.context?.logs;
  if (logs?.length) console.error(logs.join("\n"));
  process.exitCode = 1;
});
