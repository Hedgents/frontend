/**
 * One-time: create the devnet faucet identity and hand it the test-token mint authority.
 *
 *   SCARCITY_ADMIN_KEYPAIR=~/.config/solana/id.json \
 *   SCARCITY_COLLATERAL_MINT=... \
 *   npx tsx scripts/setup-devnet-faucet.ts [solToFund]
 *
 * The faucet signs in production, so it deliberately is not the exchange admin. The admin key is
 * also the resolver and the pause authority; a key that can settle markets has no business sitting
 * in a web server's environment to hand out play money. This one can do exactly two things: mint a
 * worthless devnet token, and spend its own devnet SOL.
 *
 * An SPL mint has a single mint authority, so this MOVES it rather than adding one. The admin keeps
 * its existing balance and no longer needs to mint, and the faucet key is written to disk here so
 * the operator still holds it.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  createKeyPairSignerFromPrivateKeyBytes,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  getAddressEncoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@/lib/scarcity-exchange";

const FAUCET_KEY_PATH = `${process.env.HOME}/.config/solana/hedgents-devnet-faucet.json`;

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

/** Token program `SetAuthority` (6), authority type 0 = MintTokens, with a new authority present. */
function setMintAuthority(input: { mint: Address; current: Address; next: Address }): Instruction {
  return {
    programAddress: TOKEN_PROGRAM_ADDRESS,
    accounts: [
      { address: input.mint, role: AccountRole.WRITABLE },
      { address: input.current, role: AccountRole.READONLY_SIGNER },
    ],
    data: Uint8Array.from([6, 0, 1, ...getAddressEncoder().encode(input.next)]),
  };
}

const rpcUrl = process.env.SCARCITY_RPC_URL?.trim() || "https://api.devnet.solana.com";
const wsUrl = process.env.SCARCITY_WS_URL?.trim() || "wss://api.devnet.solana.com";
const solToFund = Number(process.argv[2] ?? "4");

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

  // Reuse the key if this has run before, so re-running cannot orphan a funded faucet.
  let secret: Uint8Array;
  if (existsSync(FAUCET_KEY_PATH)) {
    secret = Uint8Array.from(JSON.parse(readFileSync(FAUCET_KEY_PATH, "utf8")) as number[]);
  } else {
    // Generate the seed ourselves: kit's generateKeyPairSigner produces a non-extractable key, and
    // a key we cannot export is a key we cannot put in the server's environment.
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const generated = await createKeyPairSignerFromPrivateKeyBytes(seed);
    secret = new Uint8Array(64);
    secret.set(seed, 0);
    secret.set(getAddressEncoder().encode(generated.address), 32);
    writeFileSync(FAUCET_KEY_PATH, JSON.stringify([...secret]), { mode: 0o600 });
  }
  const faucet = await createKeyPairSignerFromBytes(secret);

  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const signed = await signTransactionMessageWithSigners(pipe(
    createTransactionMessage({ version: 0 }),
    (draft) => setTransactionMessageFeePayerSigner(admin, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash(blockhash, draft),
    (draft) => appendTransactionMessageInstructions([
      transferSol({
        source: admin.address, destination: faucet.address,
        lamports: BigInt(Math.round(solToFund * 1_000_000_000)),
      }),
      setMintAuthority({ mint: collateralMint, current: admin.address, next: faucet.address }),
    ], draft),
  ));
  await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
    commitment: "confirmed", skipPreflight: false,
  });

  console.log(JSON.stringify({
    cluster: "devnet",
    faucet: String(faucet.address),
    keypairPath: FAUCET_KEY_PATH,
    mint: String(collateralMint),
    fundedSol: solToFund,
    signature: getSignatureFromTransaction(signed),
    next: "Set HEDGENTS_DEVNET_FAUCET_KEYPAIR in Vercel to the contents of the keypair file.",
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  const logs = (error as { context?: { logs?: string[] } })?.context?.logs;
  if (logs?.length) console.error(logs.join("\n"));
  process.exitCode = 1;
});
