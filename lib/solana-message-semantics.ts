import { createHash } from "node:crypto";
import { getAddressDecoder } from "@solana/kit";
import { ExecutionValidationError } from "@/lib/execution-validation";

/**
 * What a Solana transaction message *means*, independent of the bytes it is written in.
 *
 * The server authorises one route and must be certain the wallet signed that route. Comparing the
 * message bytes proves it, but proves too much: the wallet standard's `signTransaction` is a
 * modifying signer, and Phantom and others routinely insert a ComputeBudget instruction to set
 * their own priority fee. Byte equality rejects those users for doing nothing wrong, and telling
 * people to disable their wallet's fee settings to buy gold is not a product.
 *
 * So the commitment is over meaning instead. Every account is resolved from its table INDEX to its
 * address before hashing, because inserting an instruction appends a program key and shifts every
 * index after it; addresses are stable where indices are not. ComputeBudget instructions are then
 * dropped from both sides, since that is precisely the edit being tolerated.
 *
 * Nothing else is tolerated. The fee payer, the blockhash, the address lookup tables, and the
 * ordered list of every remaining instruction with its program, its accounts and its data must all
 * be identical. A wallet that reorders instructions, retargets an account, edits an amount or swaps
 * a program produces a different digest and is refused. The compute limit and price it may set are
 * bounded separately by the simulation guard, which measures the debit that actually results.
 */

/** ComputeBudget111111111111111111111111111111 */
export const COMPUTE_BUDGET_PROGRAM_ADDRESS = "ComputeBudget111111111111111111111111111111";

const addressDecoder = getAddressDecoder();

export interface ParsedMessageInstruction {
  programAddress: string;
  /** Addresses where resolvable, `lut:<table>:<index>` for accounts sourced from a lookup table. */
  accounts: string[];
  dataHex: string;
}

export interface ParsedSolanaMessage {
  version: "legacy" | 0;
  feePayer: string;
  recentBlockhash: string;
  staticAccountCount: number;
  lookups: Array<{ key: string; writable: number[]; readonly: number[] }>;
  instructions: ParsedMessageInstruction[];
}

function fail(reason: string): never {
  throw new ExecutionValidationError(`The Solana transaction message is ${reason}.`, 502);
}

function readShortVec(bytes: Uint8Array, start: number) {
  let value = 0;
  let shift = 0;
  let offset = start;
  for (let index = 0; index < 3; index += 1) {
    if (offset >= bytes.length) fail("truncated");
    const byte = bytes[offset];
    value |= (byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7;
  }
  fail("malformed");
}

function take(bytes: Uint8Array, offset: number, length: number) {
  if (offset + length > bytes.length) fail("truncated");
  return { slice: bytes.slice(offset, offset + length), offset: offset + length };
}

/**
 * Parse a message payload: the part of a wire transaction after its signature block.
 *
 * Handles legacy and v0 messages. v0 carries address lookup tables, whose accounts cannot be
 * resolved to addresses without fetching the tables, so those are recorded positionally and the
 * tables themselves are compared verbatim, which pins them just as firmly.
 */
export function parseSolanaMessage(message: Uint8Array): ParsedSolanaMessage {
  if (message.length < 36) fail("truncated");
  const versioned = (message[0] & 0x80) !== 0;
  if (versioned && (message[0] & 0x7f) !== 0) fail("an unsupported version");
  let offset = versioned ? 1 : 0;

  const header = take(message, offset, 3);
  offset = header.offset;
  const requiredSignatures = header.slice[0];
  if (requiredSignatures < 1) fail("missing a fee payer");

  const accountCount = readShortVec(message, offset);
  offset = accountCount.offset;
  if (accountCount.value < 1) fail("missing its account table");
  const staticAccounts: string[] = [];
  for (let index = 0; index < accountCount.value; index += 1) {
    const account = take(message, offset, 32);
    offset = account.offset;
    staticAccounts.push(addressDecoder.decode(account.slice));
  }

  const blockhash = take(message, offset, 32);
  offset = blockhash.offset;

  const instructionCount = readShortVec(message, offset);
  offset = instructionCount.offset;
  const instructions: ParsedMessageInstruction[] = [];
  const indexes: number[][] = [];
  const programIndexes: number[] = [];
  const datas: Uint8Array[] = [];
  for (let index = 0; index < instructionCount.value; index += 1) {
    const programIndex = take(message, offset, 1);
    offset = programIndex.offset;
    const accounts = readShortVec(message, offset);
    offset = accounts.offset;
    const accountIndexes = take(message, offset, accounts.value);
    offset = accountIndexes.offset;
    const dataLength = readShortVec(message, offset);
    offset = dataLength.offset;
    const data = take(message, offset, dataLength.value);
    offset = data.offset;
    programIndexes.push(programIndex.slice[0]);
    indexes.push([...accountIndexes.slice]);
    datas.push(data.slice);
  }

  const lookups: ParsedSolanaMessage["lookups"] = [];
  if (versioned) {
    const lookupCount = readShortVec(message, offset);
    offset = lookupCount.offset;
    for (let index = 0; index < lookupCount.value; index += 1) {
      const key = take(message, offset, 32);
      offset = key.offset;
      const writableCount = readShortVec(message, offset);
      offset = writableCount.offset;
      const writable = take(message, offset, writableCount.value);
      offset = writable.offset;
      const readonlyCount = readShortVec(message, offset);
      offset = readonlyCount.offset;
      const readonly = take(message, offset, readonlyCount.value);
      offset = readonly.offset;
      lookups.push({
        key: addressDecoder.decode(key.slice),
        writable: [...writable.slice],
        readonly: [...readonly.slice],
      });
    }
  }
  if (offset !== message.length) fail("longer than its declared contents");

  // Resolve indices to addresses. Anything past the static table came from a lookup table, and is
  // recorded by position; the tables are pinned separately so the position is meaningful.
  const resolve = (index: number) => {
    if (index < staticAccounts.length) return staticAccounts[index];
    const dynamic = index - staticAccounts.length;
    return `lut:${dynamic}`;
  };
  for (let index = 0; index < programIndexes.length; index += 1) {
    instructions.push({
      programAddress: resolve(programIndexes[index]),
      accounts: indexes[index].map(resolve),
      dataHex: Buffer.from(datas[index]).toString("hex"),
    });
  }

  return {
    version: versioned ? 0 : "legacy",
    feePayer: staticAccounts[0],
    recentBlockhash: addressDecoder.decode(blockhash.slice),
    staticAccountCount: staticAccounts.length,
    lookups,
    instructions,
  };
}

/**
 * The part of a message that a wallet may not change, as a stable string.
 *
 * `staticAccountCount` is deliberately excluded: adding a ComputeBudget instruction appends its
 * program key to the table, and that is the whole edit being allowed for.
 */
export function canonicalMessageSemantics(parsed: ParsedSolanaMessage) {
  return JSON.stringify({
    version: parsed.version,
    feePayer: parsed.feePayer,
    recentBlockhash: parsed.recentBlockhash,
    lookups: parsed.lookups,
    instructions: parsed.instructions.filter(
      (instruction) => instruction.programAddress !== COMPUTE_BUDGET_PROGRAM_ADDRESS,
    ),
  });
}

/** The commitment the server stores at quote time and re-derives on submission. */
export function solanaMessageSemanticDigest(message: Uint8Array) {
  return createHash("sha256")
    .update(canonicalMessageSemantics(parseSolanaMessage(message)))
    .digest("hex");
}

/**
 * Which programs the wallet added instructions for, beyond the authorised route.
 *
 * Used to refuse anything that is not a compute-budget edit, so the tolerance stays narrow even
 * though the digest above would already reject a changed route.
 */
export function addedInstructionPrograms(input: { before: Uint8Array; after: Uint8Array }) {
  const before = parseSolanaMessage(input.before).instructions;
  const after = parseSolanaMessage(input.after).instructions;
  const counts = new Map<string, number>();
  for (const instruction of before) {
    counts.set(instruction.programAddress, (counts.get(instruction.programAddress) ?? 0) + 1);
  }
  const added: string[] = [];
  for (const instruction of after) {
    const remaining = counts.get(instruction.programAddress) ?? 0;
    if (remaining > 0) counts.set(instruction.programAddress, remaining - 1);
    else added.push(instruction.programAddress);
  }
  return [...new Set(added)];
}
