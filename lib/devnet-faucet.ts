import "server-only";
import {
  AccountRole,
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
  type Address,
  type Instruction,
} from "@solana/kit";
import { ApiSecurityError } from "@/lib/api-security";
import { loadScarcityDeployment, scarcityRpcUrls } from "@/lib/scarcity-deployment";
import {
  deriveAssociatedTokenAddress,
  getCreateAssociatedTokenIdempotentInstruction,
  SYSTEM_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "@/lib/scarcity-exchange";
import { solanaRpcRequestFrom } from "@/lib/solana-rpc";

/**
 * Devnet test funds, handed out on request.
 *
 * Every devnet market settles in an operator-issued test token, so a tester arriving with an empty
 * wallet cannot take a side anywhere. They also cannot pay the transaction fee: the public devnet
 * faucet is unreliable and third-party ones cap at a fraction of a SOL. So this grants both.
 *
 * There is no cooldown and no record of who asked, because the grant is capped by BALANCE rather
 * than by frequency: it tops a wallet up to a ceiling and refuses a wallet already at it. That is
 * self-limiting without storing anything, and the worst case for someone hammering it is that they
 * keep a wallet topped up to a ceiling they could have reached with one call.
 *
 * It signs with a key that can do exactly two things, mint a worthless devnet token and spend its
 * own devnet SOL. It is deliberately not the exchange admin, which is also the resolver and the
 * pause authority.
 */
export const FAUCET_TOKEN_CEILING = 500_000_000n; // 500 test units, six decimals
export const FAUCET_SOL_CEILING = 50_000_000n; // 0.05 SOL, comfortably many transactions
const FAUCET_SOL_MINIMUM_GRANT = 10_000_000n; // do not bother with dust top-ups

export interface FaucetGrant {
  wallet: string;
  cluster: "devnet";
  mint: string;
  tokensGranted: string;
  lamportsGranted: string;
  tokenBalance: string;
  lamportBalance: string;
  signature: string | null;
  note: string;
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

/** Token program `MintTo` (7). The mint authority signs as the fee payer. */
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

async function loadFaucetSigner() {
  const raw = process.env.HEDGENTS_DEVNET_FAUCET_KEYPAIR?.trim();
  if (!raw) throw new ApiSecurityError("The devnet faucet is not configured.", 503);
  let bytes: number[];
  try {
    bytes = JSON.parse(raw) as number[];
  } catch {
    throw new ApiSecurityError("The devnet faucet key is malformed.", 503);
  }
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new ApiSecurityError("The devnet faucet key is malformed.", 503);
  }
  return createKeyPairSignerFromBytes(Uint8Array.from(bytes));
}

/** Reject anything that is not a real ed25519 address before it reaches an RPC. */
function parseWallet(value: unknown): Address {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    throw new ApiSecurityError("A Solana wallet address is required.", 400);
  }
  try {
    return address(value);
  } catch {
    throw new ApiSecurityError("A Solana wallet address is required.", 400);
  }
}

export async function grantDevnetTestFunds(input: { wallet: unknown }): Promise<FaucetGrant> {
  const wallet = parseWallet(input.wallet);
  const deployment = await loadScarcityDeployment();
  if (!deployment) throw new ApiSecurityError("No scarcity deployment is configured.", 503);
  // Hard gate. A mainnet deployment must never be able to reach a mint-authority key.
  if (deployment.cluster !== "devnet") {
    throw new ApiSecurityError("Test funds are only available on devnet.", 400);
  }

  const faucet = await loadFaucetSigner();
  const collateralMint = address(deployment.collateralMint);
  const [walletToken] = await deriveAssociatedTokenAddress(wallet, collateralMint);
  const endpoints = scarcityRpcUrls("devnet");

  const [lamportBalance, tokenBalance] = await Promise.all([
    solanaRpcRequestFrom<{ value: number }>(endpoints, "getBalance", [String(wallet), { commitment: "confirmed" }])
      .then((response) => BigInt(response.value ?? 0))
      .catch(() => 0n),
    solanaRpcRequestFrom<{ value: { amount: string } }>(
      endpoints, "getTokenAccountBalance", [String(walletToken), { commitment: "confirmed" }],
    ).then((response) => BigInt(response.value?.amount ?? "0")).catch(() => 0n),
  ]);

  const tokensGranted = tokenBalance >= FAUCET_TOKEN_CEILING ? 0n : FAUCET_TOKEN_CEILING - tokenBalance;
  const solShortfall = lamportBalance >= FAUCET_SOL_CEILING ? 0n : FAUCET_SOL_CEILING - lamportBalance;
  const lamportsGranted = solShortfall >= FAUCET_SOL_MINIMUM_GRANT ? solShortfall : 0n;

  if (tokensGranted === 0n && lamportsGranted === 0n) {
    return {
      wallet: String(wallet), cluster: "devnet", mint: String(collateralMint),
      tokensGranted: "0", lamportsGranted: "0",
      tokenBalance: tokenBalance.toString(), lamportBalance: lamportBalance.toString(),
      signature: null,
      note: "This wallet is already topped up. Spend some before asking again.",
    };
  }

  const instructions: Instruction[] = [];
  if (lamportsGranted > 0n) {
    instructions.push(transferSol({
      source: faucet.address, destination: wallet, lamports: lamportsGranted,
    }));
  }
  if (tokensGranted > 0n) {
    // The token account may not exist yet, and the faucet pays its rent so a first-time tester needs
    // nothing at all to get started.
    instructions.push(getCreateAssociatedTokenIdempotentInstruction({
      payer: faucet.address, owner: wallet, mint: collateralMint, associatedToken: walletToken,
    }));
    instructions.push(mintTo({
      mint: collateralMint, destination: walletToken, authority: faucet.address, amount: tokensGranted,
    }));
  }

  const rpc = createSolanaRpc(endpoints[0]);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions: createSolanaRpcSubscriptions(
      process.env.HEDGENTS_SCARCITY_DEVNET_WS_URL?.trim() || "wss://api.devnet.solana.com",
    ),
  });
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const signed = await signTransactionMessageWithSigners(pipe(
    createTransactionMessage({ version: 0 }),
    (draft) => setTransactionMessageFeePayerSigner(faucet, draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash(blockhash, draft),
    (draft) => appendTransactionMessageInstructions(instructions, draft),
  ));
  await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
    commitment: "confirmed", skipPreflight: false,
  });

  return {
    wallet: String(wallet),
    cluster: "devnet",
    mint: String(collateralMint),
    tokensGranted: tokensGranted.toString(),
    lamportsGranted: lamportsGranted.toString(),
    tokenBalance: (tokenBalance + tokensGranted).toString(),
    lamportBalance: (lamportBalance + lamportsGranted).toString(),
    signature: getSignatureFromTransaction(signed),
    note: "Devnet test funds. The token has no value and exists only so devnet markets can settle.",
  };
}

/**
 * What a wallet holds now, so the button can say whether asking would do anything.
 *
 * The wallet is optional because the button has to decide whether to render at all before anyone
 * connects, and that decision depends only on the cluster.
 */
export async function readDevnetTestBalances(input: { wallet?: unknown }) {
  const deployment = await loadScarcityDeployment();
  if (!deployment || deployment.cluster !== "devnet") return null;
  const collateralMint = address(deployment.collateralMint);
  if (input.wallet === undefined || input.wallet === null || input.wallet === "") {
    return {
      cluster: "devnet" as const,
      mint: String(collateralMint),
      tokenBalance: null,
      lamportBalance: null,
      toppedUp: false,
    };
  }
  const wallet = parseWallet(input.wallet);
  const [walletToken] = await deriveAssociatedTokenAddress(wallet, collateralMint);
  const endpoints = scarcityRpcUrls("devnet");
  const [lamportBalance, tokenBalance] = await Promise.all([
    solanaRpcRequestFrom<{ value: number }>(endpoints, "getBalance", [String(wallet), { commitment: "confirmed" }])
      .then((response) => BigInt(response.value ?? 0)).catch(() => 0n),
    solanaRpcRequestFrom<{ value: { amount: string } }>(
      endpoints, "getTokenAccountBalance", [String(walletToken), { commitment: "confirmed" }],
    ).then((response) => BigInt(response.value?.amount ?? "0")).catch(() => 0n),
  ]);
  return {
    cluster: "devnet" as const,
    mint: String(collateralMint),
    tokenBalance: tokenBalance.toString(),
    lamportBalance: lamportBalance.toString(),
    toppedUp: tokenBalance >= FAUCET_TOKEN_CEILING && lamportBalance >= FAUCET_SOL_CEILING,
  };
}
