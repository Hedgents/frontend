import { createHash } from "node:crypto";
import {
  address,
  getBase58Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { ExecutionValidationError } from "@/lib/execution-validation";
import { bindSolanaTransaction } from "@/lib/solana-transaction-binding";

export const TRANSACTION_GUARD_SCHEMA = "hedgents.solana-transaction-guard.v1" as const;

const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const SUPPORTED_TOKEN_PROGRAMS = new Set([SPL_TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);
const base58Encoder = getBase58Encoder();

interface SimulationTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
  };
}

interface ParsedInnerInstruction {
  programId?: unknown;
  programIdIndex?: unknown;
  accounts?: unknown;
  data?: unknown;
  parsed?: unknown;
  program?: unknown;
  stackHeight?: unknown;
}

interface SimulationInnerInstructions {
  index: number;
  instructions: ParsedInnerInstruction[];
}

export interface SolanaSimulationValue {
  err?: unknown;
  fee?: number | null;
  logs?: string[] | null;
  unitsConsumed?: number | null;
  preBalances?: number[] | null;
  postBalances?: number[] | null;
  preTokenBalances?: SimulationTokenBalance[] | null;
  postTokenBalances?: SimulationTokenBalance[] | null;
  loadedAddresses?: {
    writable?: string[];
    readonly?: string[];
  } | null;
  innerInstructions?: SimulationInnerInstructions[] | null;
}

export interface TransactionGuardExpectation {
  taker: string;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  minimumOutputAmount: string;
  maximumSolDebitLamports: string;
}

export interface TransactionGuardCommitment {
  schema: typeof TRANSACTION_GUARD_SCHEMA;
  reportDigest: string;
  programFingerprint: string;
  takerSolDebitLamports: string;
  networkFeeLamports: string;
}

export interface TransactionGuardReport extends TransactionGuardCommitment {
  transactionMessageDigest: string;
  inputDebitAmount: string;
  outputCreditAmount: string;
  programIds: string[];
  unitsConsumed: number | null;
}

interface NormalizedTokenBalance {
  accountIndex: number;
  address: string;
  mint: string;
  owner: string;
  programId: string;
  decimals: number;
  amount: bigint;
}

interface TakerTokenAccounts {
  /** Taker-owned token accounts that already existed before this transaction. */
  preExisting: Set<string>;
  /** Every taker-owned token account, including any the route creates in flight. */
  owned: Set<string>;
}

function guardFailure(message: string, status = 502): never {
  throw new ExecutionValidationError(`Unsafe Solana transaction: ${message}`, status);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalAmount(value: unknown, label: string) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    guardFailure(`${label} is missing or malformed.`);
  }
  return BigInt(value);
}

function safeLamports(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    guardFailure(`${label} is not a safe lamport value.`);
  }
  return BigInt(value as number);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function canonicalAddress(value: unknown, label: string) {
  const candidate = stringField(value);
  if (!candidate) guardFailure(`${label} is missing or malformed.`);
  try {
    return String(address(candidate));
  } catch {
    return guardFailure(`${label} is not a canonical Solana address.`);
  }
}

function parsedTokenPrimaryAccount(info: Record<string, unknown> | null, normalizedType: string) {
  if (normalizedType === "initializemultisig" || normalizedType === "initializemultisig2") {
    return stringField(info?.multisig);
  }
  if (
    normalizedType === "initializemint"
    || normalizedType === "initializemint2"
    || normalizedType === "mintto"
    || normalizedType === "minttochecked"
    || normalizedType === "getaccountdatasize"
    || normalizedType === "amounttouiamount"
    || normalizedType === "uiamounttoamount"
  ) {
    return stringField(info?.mint);
  }
  return stringField(info?.account) ?? stringField(info?.source);
}

function decodeInstructionData(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (typeof value !== "string" || value.length === 0) {
    guardFailure("an instruction payload is missing or malformed.");
  }
  try {
    return Uint8Array.from(base58Encoder.encode(value));
  } catch {
    return guardFailure("an instruction payload is not canonical base58.");
  }
}

function littleEndianU32(data: Uint8Array) {
  if (data.length < 4) guardFailure("a System Program instruction is truncated.");
  return data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
}

function assertTokenAuthorityInstructionSafe(
  name: string,
  target: string | null,
  destination: string | null,
  taker: string,
  takerAccounts: TakerTokenAccounts,
) {
  if (!target) {
    guardFailure(`the route can ${name} an unresolved token account.`);
  }
  if (name === "closeAccount") {
    // A route may close a token account it created inside the same transaction — that is how
    // wrapped SOL is unwrapped. It may never close an account the taker already held, and the
    // reclaimed rent must return to the taker rather than to a route-controlled address.
    if (takerAccounts.preExisting.has(target)) {
      guardFailure("the route can closeAccount a pre-existing taker token account.");
    }
    if (takerAccounts.owned.has(target) && destination !== taker) {
      guardFailure("the route closes a taker token account to a destination other than the taker.");
    }
    return;
  }
  // approve/setAuthority/freeze/thaw against any taker-owned account is rejected whether or not
  // that account existed before this transaction. A token account created for the taker inside
  // the route still holds the taker's metal once the swap settles, so delegating or seizing
  // authority over it is a post-settlement drain even though every balance delta looks correct.
  if (takerAccounts.owned.has(target)) {
    guardFailure(`the route can ${name} a taker token account.`);
  }
}

function analyzeTokenInstruction(
  data: Uint8Array,
  accounts: string[],
  taker: string,
  takerAccounts: TakerTokenAccounts,
) {
  if (data.length === 0) guardFailure("a token instruction is truncated.");
  const opcode = data[0];
  const target = accounts[0] ?? null;
  const dangerous = new Map<number, string>([
    [4, "approve"],
    [6, "setAuthority"],
    [8, "burn"],
    [9, "closeAccount"],
    [10, "freezeAccount"],
    [11, "thawAccount"],
    [13, "approveChecked"],
    [15, "burnChecked"],
  ]);
  const safeOpcodes = new Set([0, 1, 2, 3, 5, 7, 12, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  const dangerousName = dangerous.get(opcode);
  if (dangerousName) {
    if (dangerousName.includes("burn")) {
      guardFailure(`the route contains a ${dangerousName} token instruction.`);
    }
    assertTokenAuthorityInstructionSafe(
      dangerousName,
      target,
      accounts[1] ?? null,
      taker,
      takerAccounts,
    );
    return `token:opcode-${opcode}:transient:${target}`;
  }
  if (!safeOpcodes.has(opcode)) {
    guardFailure(`token instruction opcode ${opcode} is not supported by the beta guard.`);
  }
  return `token:opcode-${opcode}:${target ?? "none"}`;
}

function analyzeParsedTokenInstruction(
  parsed: Record<string, unknown>,
  taker: string,
  takerAccounts: TakerTokenAccounts,
) {
  const type = stringField(parsed.type);
  const info = record(parsed.info);
  if (!type) guardFailure("a parsed token instruction has no type.");
  const normalized = type.toLowerCase();
  const rawTarget = parsedTokenPrimaryAccount(info, normalized);
  const target = rawTarget ? canonicalAddress(rawTarget, `parsed token ${type} target`) : null;
  const dangerous = new Set([
    "approve",
    "approvechecked",
    "setauthority",
    "closeaccount",
    "freezeaccount",
    "thawaccount",
  ]);
  const opcodeByType = new Map<string, number>([
    ["initializemint", 0],
    ["initializeaccount", 1],
    ["initializemultisig", 2],
    ["transfer", 3],
    ["approve", 4],
    ["revoke", 5],
    ["setauthority", 6],
    ["mintto", 7],
    ["burn", 8],
    ["closeaccount", 9],
    ["freezeaccount", 10],
    ["thawaccount", 11],
    ["transferchecked", 12],
    ["approvechecked", 13],
    ["minttochecked", 14],
    ["burnchecked", 15],
    ["initializeaccount2", 16],
    ["syncnative", 17],
    ["initializeaccount3", 18],
    ["initializemultisig2", 19],
    ["initializemint2", 20],
    ["getaccountdatasize", 21],
    ["initializeimmutableowner", 22],
    ["amounttouiamount", 23],
    ["uiamounttoamount", 24],
  ]);
  const opcode = opcodeByType.get(normalized);
  if (opcode === undefined) {
    guardFailure(`parsed token instruction ${type} is not supported by the beta guard.`);
  }
  if (normalized === "burn" || normalized === "burnchecked") {
    guardFailure(`the route contains a ${type} token instruction.`);
  }
  if (dangerous.has(normalized)) {
    const rawDestination = stringField(info?.destination);
    assertTokenAuthorityInstructionSafe(
      normalized === "closeaccount" ? "closeAccount" : type,
      target,
      rawDestination ? canonicalAddress(rawDestination, `parsed token ${type} destination`) : null,
      taker,
      takerAccounts,
    );
    return `token:opcode-${opcode}:transient:${target}`;
  }
  const safe = new Set([
    "transfer",
    "transferchecked",
    "revoke",
    "mintto",
    "minttochecked",
    "initializeaccount",
    "initializeaccount2",
    "initializeaccount3",
    "initializemint",
    "initializemint2",
    "initializemultisig",
    "initializemultisig2",
    "initializeimmutableowner",
    "getaccountdatasize",
    "syncnative",
    "amounttouiamount",
    "uiamounttoamount",
  ]);
  if (!safe.has(normalized)) guardFailure(`parsed token instruction ${type} is not supported by the beta guard.`);
  return `token:opcode-${opcode}:${target ?? "none"}`;
}

function analyzeSystemInstruction(data: Uint8Array, accounts: string[], taker: string) {
  const opcode = littleEndianU32(data);
  const targetOrSource = accounts[0] ?? null;
  // AllocateWithSeed (9), AssignWithSeed (10), and TransferWithSeed (11) address the derived
  // account at index 0 and the signing base at index 1. Checking index 0 alone would miss a
  // seed-derived account funded from the taker's own key.
  const seedBase = opcode === 9 || opcode === 10 || opcode === 11 ? accounts[1] ?? null : null;
  if ((opcode === 2 || opcode === 11) && (targetOrSource === taker || seedBase === taker)) {
    guardFailure("the route contains an arbitrary System Program transfer from the taker.");
  }
  if (
    (opcode === 1 || opcode === 8 || opcode === 9 || opcode === 10)
    && (targetOrSource === taker || seedBase === taker)
  ) {
    guardFailure("the route can assign or allocate the taker's wallet account.");
  }
  const safe = new Set([0, 1, 2, 3, 8, 9, 10, 11]);
  if (!safe.has(opcode)) {
    guardFailure(`System Program instruction opcode ${opcode} is not supported by the beta guard.`);
  }
  return `system:opcode-${opcode}:${targetOrSource ?? "none"}`;
}

function analyzeParsedSystemInstruction(parsed: Record<string, unknown>, taker: string) {
  const type = stringField(parsed.type);
  const info = record(parsed.info);
  if (!type) guardFailure("a parsed System Program instruction has no type.");
  const normalized = type.toLowerCase();
  const rawSource = stringField(info?.source) ?? stringField(info?.fromPubkey);
  const rawTarget = stringField(info?.account) ?? rawSource;
  // The seed variants report the derived account in source/account and the signing key that
  // authorizes it in sourceBase/base. Only the base identifies the taker.
  const rawBase = stringField(info?.sourceBase) ?? stringField(info?.base);
  const source = rawSource ? canonicalAddress(rawSource, `parsed System ${type} source`) : null;
  const target = rawTarget ? canonicalAddress(rawTarget, `parsed System ${type} target`) : null;
  const base = rawBase ? canonicalAddress(rawBase, `parsed System ${type} base`) : null;
  if ((normalized === "transfer" || normalized === "transferwithseed") && (source === taker || base === taker)) {
    guardFailure("the route contains an arbitrary System Program transfer from the taker.");
  }
  if (
    (normalized === "assign" || normalized === "assignwithseed" || normalized === "allocate" || normalized === "allocatewithseed")
    && (target === taker || base === taker)
  ) {
    guardFailure("the route can assign or allocate the taker's wallet account.");
  }
  const safe = new Set([
    "createaccount",
    "createaccountwithseed",
    "allocate",
    "allocatewithseed",
    "assign",
    "assignwithseed",
    "transfer",
    "transferwithseed",
  ]);
  if (!safe.has(normalized)) {
    guardFailure(`parsed System Program instruction ${type} is not supported by the beta guard.`);
  }
  const opcode = new Map<string, number>([
    ["createaccount", 0],
    ["assign", 1],
    ["transfer", 2],
    ["createaccountwithseed", 3],
    ["allocate", 8],
    ["allocatewithseed", 9],
    ["assignwithseed", 10],
    ["transferwithseed", 11],
  ]).get(normalized);
  if (opcode === undefined) guardFailure(`parsed System Program instruction ${type} is not supported by the beta guard.`);
  const subject = normalized === "assign"
    || normalized === "assignwithseed"
    || normalized === "allocate"
    || normalized === "allocatewithseed"
    ? target
    : source;
  return `system:opcode-${opcode}:${subject ?? "none"}`;
}

function analyzeInstruction(
  programId: string,
  accounts: string[],
  data: unknown,
  parsed: unknown,
  taker: string,
  takerAccounts: TakerTokenAccounts,
) {
  const parsedRecord = record(parsed);
  if (SUPPORTED_TOKEN_PROGRAMS.has(programId)) {
    return parsedRecord
      ? analyzeParsedTokenInstruction(parsedRecord, taker, takerAccounts)
      : analyzeTokenInstruction(decodeInstructionData(data), accounts, taker, takerAccounts);
  }
  if (programId === SYSTEM_PROGRAM) {
    return parsedRecord
      ? analyzeParsedSystemInstruction(parsedRecord, taker)
      : analyzeSystemInstruction(decodeInstructionData(data), accounts, taker);
  }
  return `program:${programId}`;
}

function normalizeTokenBalances(
  balances: SimulationTokenBalance[],
  resolvedAccounts: string[],
  label: string,
) {
  const normalized = new Map<number, NormalizedTokenBalance>();
  for (const balance of balances) {
    if (!Number.isSafeInteger(balance.accountIndex) || balance.accountIndex < 0 || balance.accountIndex >= resolvedAccounts.length) {
      guardFailure(`${label} contains an invalid token account index.`);
    }
    if (normalized.has(balance.accountIndex)) {
      guardFailure(`${label} contains a duplicate token account index.`);
    }
    const mint = canonicalAddress(balance.mint, `${label} token mint`);
    const owner = canonicalAddress(balance.owner, `${label} token owner`);
    const programId = canonicalAddress(balance.programId, `${label} token program`);
    if (!SUPPORTED_TOKEN_PROGRAMS.has(programId)) {
      guardFailure(`${label} omits a token owner or uses an unsupported token program.`);
    }
    if (!Number.isSafeInteger(balance.uiTokenAmount?.decimals) || balance.uiTokenAmount.decimals < 0) {
      guardFailure(`${label} contains malformed token metadata.`);
    }
    normalized.set(balance.accountIndex, {
      accountIndex: balance.accountIndex,
      address: resolvedAccounts[balance.accountIndex],
      mint,
      owner,
      programId,
      decimals: balance.uiTokenAmount.decimals,
      amount: canonicalAmount(balance.uiTokenAmount.amount, `${label} token amount`),
    });
  }
  return normalized;
}

function tokenDeltas(
  before: Map<number, NormalizedTokenBalance>,
  after: Map<number, NormalizedTokenBalance>,
  taker: string,
) {
  const deltas = new Map<string, bigint>();
  const preExisting = new Set<string>();
  const owned = new Set<string>();
  const indexes = new Set([...before.keys(), ...after.keys()]);
  for (const index of indexes) {
    const pre = before.get(index);
    const post = after.get(index);
    if (pre && post && (
      pre.address !== post.address ||
      pre.mint !== post.mint ||
      pre.owner !== post.owner ||
      pre.programId !== post.programId ||
      pre.decimals !== post.decimals
    )) {
      guardFailure("a token account changes identity, owner, mint, program, or decimals during simulation.");
    }
    const metadata = pre ?? post;
    if (!metadata) continue;
    if (pre?.owner === taker) preExisting.add(pre.address);
    // An account the route creates for the taker inside this transaction appears only in the
    // post set. It still belongs to the taker afterwards, so it must be protected too.
    if (post?.owner === taker) owned.add(post.address);
    if (metadata.owner !== taker) continue;
    owned.add(metadata.address);
    const delta = (post?.amount ?? 0n) - (pre?.amount ?? 0n);
    deltas.set(metadata.mint, (deltas.get(metadata.mint) ?? 0n) + delta);
  }
  return { deltas, takerAccounts: { preExisting, owned } satisfies TakerTokenAccounts };
}

function requireStringArray(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    guardFailure(`${label} is missing or malformed.`);
  }
  return value.map((entry, index) => canonicalAddress(entry, `${label}[${index}]`));
}

export function configuredMaximumSolDebitLamports() {
  const value = process.env.HEDGENTS_MAX_SOL_DEBIT_LAMPORTS?.trim();
  if (!value) {
    throw new ExecutionValidationError(
      "Set HEDGENTS_MAX_SOL_DEBIT_LAMPORTS before enabling metal execution.",
      503,
    );
  }
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new ExecutionValidationError("HEDGENTS_MAX_SOL_DEBIT_LAMPORTS is malformed.", 503);
  }
  const amount = BigInt(value);
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ExecutionValidationError("HEDGENTS_MAX_SOL_DEBIT_LAMPORTS is outside the supported range.", 503);
  }
  return amount.toString();
}

export function configuredProgramFingerprintAllowlist() {
  const configured = process.env.HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new ExecutionValidationError(
        "Set HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST to reviewed route fingerprints before enabling metal execution.",
        503,
      );
    }
    return null;
  }
  const fingerprints = configured.split(",").map((value) => value.trim()).filter(Boolean);
  if (!fingerprints.length || fingerprints.some((value) => !/^[a-f0-9]{64}$/.test(value))) {
    throw new ExecutionValidationError(
      "HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST must contain comma-separated lowercase SHA-256 fingerprints.",
      503,
    );
  }
  return new Set(fingerprints);
}

export function assertProgramFingerprintAllowed(report: Pick<TransactionGuardReport, "programFingerprint">) {
  const allowlist = configuredProgramFingerprintAllowlist();
  if (allowlist && !allowlist.has(report.programFingerprint)) {
    throw new ExecutionValidationError(
      `The route program fingerprint ${report.programFingerprint} has not passed the operator canary review.`,
      503,
    );
  }
}

export function guardSolanaTransaction(
  transactionBase64: string,
  simulation: SolanaSimulationValue,
  expectation: TransactionGuardExpectation,
): TransactionGuardReport {
  const expectedTaker = canonicalAddress(expectation.taker, "the expected taker");
  const expectedInputMint = canonicalAddress(expectation.inputMint, "the expected input mint");
  const expectedOutputMint = canonicalAddress(expectation.outputMint, "the expected output mint");
  if (expectedInputMint === expectedOutputMint) {
    guardFailure("input and output mints must be different.");
  }
  const expectedInputAmount = canonicalAmount(expectation.inputAmount, "the authorized input amount");
  const minimumOutputAmount = canonicalAmount(expectation.minimumOutputAmount, "the protected output amount");
  const maximumSolDebit = canonicalAmount(expectation.maximumSolDebitLamports, "the authorized SOL debit cap");
  if (expectedInputAmount <= 0n || minimumOutputAmount <= 0n || maximumSolDebit <= 0n) {
    guardFailure("authorized amounts must be positive.");
  }
  if (simulation.err !== null) guardFailure("the exact transaction did not simulate successfully.", 400);
  if (!Array.isArray(simulation.logs)) guardFailure("simulation logs are unavailable.");
  if (!Array.isArray(simulation.preBalances) || !Array.isArray(simulation.postBalances)) {
    guardFailure("pre/post lamport balances are unavailable.");
  }
  if (!Array.isArray(simulation.preTokenBalances) || !Array.isArray(simulation.postTokenBalances)) {
    guardFailure("pre/post token balances are unavailable.");
  }
  if (!simulation.loadedAddresses) guardFailure("resolved lookup-table addresses are unavailable.");
  if (!Array.isArray(simulation.innerInstructions)) {
    guardFailure("parsed inner instructions are unavailable.");
  }

  const binding = bindSolanaTransaction(transactionBase64, expectedTaker);
  let compiledMessage: ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>;
  try {
    const bytes = Uint8Array.from(Buffer.from(transactionBase64, "base64"));
    const transaction = getTransactionDecoder().decode(bytes);
    compiledMessage = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  } catch {
    return guardFailure("the transaction message cannot be decoded with @solana/kit.");
  }
  if (compiledMessage.version !== "legacy" && compiledMessage.version !== 0) {
    guardFailure("only legacy and v0 transaction messages are supported.");
  }
  if (
    compiledMessage.header.numSignerAccounts !== 1 ||
    compiledMessage.header.numReadonlySignerAccounts !== 0
  ) {
    guardFailure("the beta route must require only the writable taker signature.");
  }
  if (String(compiledMessage.staticAccounts[0]) !== expectedTaker) {
    guardFailure("the taker is not the first static account and fee payer.");
  }

  const loadedWritable = requireStringArray(simulation.loadedAddresses.writable, "loaded writable addresses");
  const loadedReadonly = requireStringArray(simulation.loadedAddresses.readonly, "loaded readonly addresses");
  if (compiledMessage.version === "legacy" && (loadedWritable.length || loadedReadonly.length)) {
    guardFailure("a legacy transaction unexpectedly resolved lookup-table accounts.");
  }
  if (compiledMessage.version === 0) {
    const lookups = compiledMessage.addressTableLookups ?? [];
    const expectedWritable = lookups.reduce((sum, lookup) => sum + lookup.writableIndexes.length, 0);
    const expectedReadonly = lookups.reduce((sum, lookup) => sum + lookup.readonlyIndexes.length, 0);
    if (loadedWritable.length !== expectedWritable || loadedReadonly.length !== expectedReadonly) {
      guardFailure("resolved lookup-table account counts do not match the signed message.");
    }
  }
  const resolvedAccounts = [
    ...compiledMessage.staticAccounts.map(String),
    ...loadedWritable,
    ...loadedReadonly,
  ].map((entry, index) => canonicalAddress(entry, `resolved transaction account[${index}]`));
  if (new Set(resolvedAccounts).size !== resolvedAccounts.length) {
    guardFailure("the resolved transaction account list contains duplicates.");
  }
  if (
    simulation.preBalances.length !== resolvedAccounts.length ||
    simulation.postBalances.length !== resolvedAccounts.length
  ) {
    guardFailure("lamport balances do not align with the resolved transaction accounts.");
  }

  const before = normalizeTokenBalances(simulation.preTokenBalances, resolvedAccounts, "preTokenBalances");
  const after = normalizeTokenBalances(simulation.postTokenBalances, resolvedAccounts, "postTokenBalances");
  const { deltas, takerAccounts } = tokenDeltas(before, after, expectedTaker);
  const inputDelta = deltas.get(expectedInputMint) ?? 0n;
  const outputDelta = deltas.get(expectedOutputMint) ?? 0n;
  const inputDebit = inputDelta < 0n ? -inputDelta : 0n;
  if (inputDebit !== expectedInputAmount) {
    guardFailure("the simulated taker input debit does not exactly match the authorized amount.");
  }
  if (outputDelta < minimumOutputAmount) {
    guardFailure("the simulated taker output credit is below the protected minimum.");
  }
  for (const [mint, delta] of deltas) {
    if (mint !== expectedInputMint && delta < 0n) {
      guardFailure(`the route debits an unrelated taker token mint (${mint}).`);
    }
  }

  const takerIndex = resolvedAccounts.indexOf(expectedTaker);
  if (takerIndex !== 0 || resolvedAccounts.lastIndexOf(expectedTaker) !== 0) {
    guardFailure("the taker account is missing, duplicated, or not the fee payer.");
  }
  const preLamports = safeLamports(simulation.preBalances[takerIndex], "the taker pre-balance");
  const postLamports = safeLamports(simulation.postBalances[takerIndex], "the taker post-balance");
  const takerSolDebit = preLamports > postLamports ? preLamports - postLamports : 0n;
  const networkFee = safeLamports(simulation.fee, "the simulated network fee");
  if (takerSolDebit > maximumSolDebit || networkFee > maximumSolDebit) {
    guardFailure("the simulated SOL debit or network fee exceeds the operator cap.", 400);
  }

  const programIds: string[] = [];
  const effects: string[] = [];
  for (const instruction of compiledMessage.instructions) {
    const programId = resolvedAccounts[instruction.programAddressIndex];
    if (!programId) guardFailure("an outer instruction references an unresolved program.");
    const accounts = (instruction.accountIndices ?? []).map((index) => {
      const account = resolvedAccounts[index];
      if (!account) guardFailure("an outer instruction references an unresolved account.");
      return account;
    });
    programIds.push(programId);
    effects.push(analyzeInstruction(
      programId,
      accounts,
      instruction.data,
      null,
      expectedTaker,
      takerAccounts,
    ));
  }
  const seenInnerGroups = new Set<number>();
  for (const group of simulation.innerInstructions) {
    if (
      !Number.isSafeInteger(group.index)
      || group.index < 0
      || group.index >= compiledMessage.instructions.length
      || seenInnerGroups.has(group.index)
      || !Array.isArray(group.instructions)
    ) {
      guardFailure("the inner-instruction response is malformed.");
    }
    seenInnerGroups.add(group.index);
    for (const instruction of group.instructions) {
      let programId: string;
      let accounts: string[];
      if (instruction.programIdIndex !== undefined) {
        if (
          !Number.isSafeInteger(instruction.programIdIndex)
          || Number(instruction.programIdIndex) < 0
          || Number(instruction.programIdIndex) >= resolvedAccounts.length
          || instruction.programId !== undefined
          || !Array.isArray(instruction.accounts)
        ) {
          guardFailure("a compiled inner instruction is malformed.");
        }
        programId = resolvedAccounts[Number(instruction.programIdIndex)];
        accounts = instruction.accounts.map((index) => {
          if (!Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= resolvedAccounts.length) {
            guardFailure("a compiled inner instruction references an unresolved account.");
          }
          return resolvedAccounts[Number(index)];
        });
      } else {
        programId = canonicalAddress(instruction.programId, "inner-instruction program ID");
        accounts = instruction.accounts === undefined
          ? []
          : requireStringArray(instruction.accounts, "inner-instruction accounts");
      }
      programIds.push(programId);
      effects.push(analyzeInstruction(
        programId,
        accounts,
        instruction.data,
        instruction.parsed,
        expectedTaker,
        takerAccounts,
      ));
    }
  }

  const uniqueProgramIds = [...new Set(programIds)].sort();
  const programFingerprint = sha256(JSON.stringify(uniqueProgramIds));
  const effectFingerprint = sha256(JSON.stringify(effects));
  const commitmentPayload = {
    schema: TRANSACTION_GUARD_SCHEMA,
    transactionMessageDigest: binding.messageDigest,
    taker: expectedTaker,
    inputMint: expectedInputMint,
    outputMint: expectedOutputMint,
    inputDebitAmount: inputDebit.toString(),
    minimumOutputAmount: minimumOutputAmount.toString(),
    outputMinimumSatisfied: true,
    takerSolDebitLamports: takerSolDebit.toString(),
    networkFeeLamports: networkFee.toString(),
    programFingerprint,
    effectFingerprint,
  };
  return {
    schema: TRANSACTION_GUARD_SCHEMA,
    reportDigest: sha256(JSON.stringify(commitmentPayload)),
    programFingerprint,
    transactionMessageDigest: binding.messageDigest,
    takerSolDebitLamports: takerSolDebit.toString(),
    networkFeeLamports: networkFee.toString(),
    inputDebitAmount: inputDebit.toString(),
    outputCreditAmount: outputDelta.toString(),
    programIds: uniqueProgramIds,
    unitsConsumed: Number.isSafeInteger(simulation.unitsConsumed) ? simulation.unitsConsumed! : null,
  };
}

export function transactionGuardCommitment(report: TransactionGuardReport): TransactionGuardCommitment {
  return {
    schema: report.schema,
    reportDigest: report.reportDigest,
    programFingerprint: report.programFingerprint,
    takerSolDebitLamports: report.takerSolDebitLamports,
    networkFeeLamports: report.networkFeeLamports,
  };
}

export function assertTransactionGuardCompatible(
  expected: TransactionGuardCommitment,
  observed: TransactionGuardReport,
) {
  if (
    expected.schema !== TRANSACTION_GUARD_SCHEMA ||
    expected.reportDigest !== observed.reportDigest ||
    expected.programFingerprint !== observed.programFingerprint ||
    expected.takerSolDebitLamports !== observed.takerSolDebitLamports ||
    expected.networkFeeLamports !== observed.networkFeeLamports
  ) {
    guardFailure("the signed transaction no longer matches its authenticated safety report.", 400);
  }
}
