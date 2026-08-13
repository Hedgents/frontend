import assert from "node:assert/strict";
import test from "node:test";
import { getAddressEncoder, address } from "@solana/kit";
import {
  addedInstructionPrograms,
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  parseSolanaMessage,
  solanaMessageSemanticDigest,
} from "./solana-message-semantics";

const encoder = getAddressEncoder();
const TAKER = "HBvV7YqSRSPW4YEBsDvpvF2PrUWFubqVbTNYafkddTsy";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MINT = "2oir5epneSn3g5s9q8PF8kkjaZfZHcj598VcCxm1TEXP";
const BLOCKHASH = "11111111111111111111111111111111";

interface Instruction { program: number; accounts: number[]; data: number[] }

/** Assemble a v0 message payload: the bytes after a wire transaction's signature block. */
function message(input: {
  accounts: string[];
  instructions: Instruction[];
  blockhash?: string;
  lookups?: Array<{ key: string; writable: number[]; readonly: number[] }>;
}) {
  const bytes: number[] = [0x80, 1, 0, 1];
  bytes.push(input.accounts.length);
  for (const account of input.accounts) bytes.push(...encoder.encode(address(account)));
  bytes.push(...encoder.encode(address(input.blockhash ?? BLOCKHASH)));
  bytes.push(input.instructions.length);
  for (const instruction of input.instructions) {
    bytes.push(instruction.program, instruction.accounts.length, ...instruction.accounts);
    bytes.push(instruction.data.length, ...instruction.data);
  }
  const lookups = input.lookups ?? [];
  bytes.push(lookups.length);
  for (const lookup of lookups) {
    bytes.push(...encoder.encode(address(lookup.key)));
    bytes.push(lookup.writable.length, ...lookup.writable);
    bytes.push(lookup.readonly.length, ...lookup.readonly);
  }
  return Uint8Array.from(bytes);
}

/** The route the server authorises: one Jupiter swap touching the taker and a mint. */
const ROUTE = {
  accounts: [TAKER, MINT, JUPITER],
  instructions: [{ program: 2, accounts: [0, 1], data: [1, 2, 3, 4] }],
};

test("a message parses into resolved addresses rather than table indices", () => {
  const parsed = parseSolanaMessage(message(ROUTE));
  assert.equal(parsed.version, 0);
  assert.equal(parsed.feePayer, TAKER);
  assert.equal(parsed.instructions.length, 1);
  assert.equal(parsed.instructions[0].programAddress, JUPITER);
  assert.deepEqual(parsed.instructions[0].accounts, [TAKER, MINT]);
  assert.equal(parsed.instructions[0].dataHex, "01020304");
});

test("a wallet-added priority fee does not change the commitment", () => {
  // Phantom's edit: the ComputeBudget program is appended to the table and two instructions are
  // prepended, which shifts every later account index. Addresses are what get hashed, so it holds.
  const withFee = message({
    accounts: [TAKER, MINT, JUPITER, COMPUTE_BUDGET_PROGRAM_ADDRESS],
    instructions: [
      { program: 3, accounts: [], data: [2, 0x40, 0x42, 0x0f, 0x00] }, // set compute unit limit
      { program: 3, accounts: [], data: [3, 0x10, 0x27, 0, 0, 0, 0, 0, 0] }, // set price
      { program: 2, accounts: [0, 1], data: [1, 2, 3, 4] },
    ],
  });
  assert.equal(solanaMessageSemanticDigest(message(ROUTE)), solanaMessageSemanticDigest(withFee));
  assert.deepEqual(
    addedInstructionPrograms({ before: message(ROUTE), after: withFee }),
    [COMPUTE_BUDGET_PROGRAM_ADDRESS],
  );
});

test("a changed amount is refused", () => {
  const tampered = message({
    ...ROUTE,
    instructions: [{ program: 2, accounts: [0, 1], data: [1, 2, 3, 9] }],
  });
  assert.notEqual(solanaMessageSemanticDigest(message(ROUTE)), solanaMessageSemanticDigest(tampered));
});

test("a retargeted account is refused even though the data is identical", () => {
  const tampered = message({
    accounts: [TAKER, MINT, JUPITER, TOKEN],
    instructions: [{ program: 2, accounts: [0, 3], data: [1, 2, 3, 4] }],
  });
  assert.notEqual(solanaMessageSemanticDigest(message(ROUTE)), solanaMessageSemanticDigest(tampered));
});

test("a swapped program is refused", () => {
  const tampered = message({
    accounts: [TAKER, MINT, TOKEN],
    instructions: [{ program: 2, accounts: [0, 1], data: [1, 2, 3, 4] }],
  });
  assert.notEqual(solanaMessageSemanticDigest(message(ROUTE)), solanaMessageSemanticDigest(tampered));
});

test("an extra non-compute-budget instruction is both a digest change and a reported addition", () => {
  const drain = message({
    accounts: [TAKER, MINT, JUPITER, TOKEN],
    instructions: [
      { program: 2, accounts: [0, 1], data: [1, 2, 3, 4] },
      { program: 3, accounts: [0, 1], data: [3, 255] }, // an unauthorised token transfer
    ],
  });
  assert.notEqual(solanaMessageSemanticDigest(message(ROUTE)), solanaMessageSemanticDigest(drain));
  assert.deepEqual(addedInstructionPrograms({ before: message(ROUTE), after: drain }), [TOKEN]);
});

test("reordering the authorised instructions is refused", () => {
  const two = {
    accounts: [TAKER, MINT, JUPITER, TOKEN],
    instructions: [
      { program: 2, accounts: [0, 1], data: [1] },
      { program: 3, accounts: [0, 1], data: [2] },
    ],
  };
  const reordered = {
    ...two,
    instructions: [two.instructions[1], two.instructions[0]],
  };
  assert.notEqual(solanaMessageSemanticDigest(message(two)), solanaMessageSemanticDigest(message(reordered)));
});

test("a changed blockhash is refused, since expiry was committed with it", () => {
  const moved = message({ ...ROUTE, blockhash: MINT });
  assert.notEqual(solanaMessageSemanticDigest(message(ROUTE)), solanaMessageSemanticDigest(moved));
});

test("changed address lookup tables are refused", () => {
  const base = { ...ROUTE, lookups: [{ key: TOKEN, writable: [1], readonly: [2] }] };
  const swapped = { ...ROUTE, lookups: [{ key: TOKEN, writable: [4], readonly: [2] }] };
  assert.notEqual(solanaMessageSemanticDigest(message(base)), solanaMessageSemanticDigest(message(swapped)));
});

test("accounts sourced from a lookup table are pinned positionally", () => {
  const parsed = parseSolanaMessage(message({
    ...ROUTE,
    instructions: [{ program: 2, accounts: [0, 3], data: [1] }],
    lookups: [{ key: TOKEN, writable: [7], readonly: [] }],
  }));
  assert.deepEqual(parsed.instructions[0].accounts, [TAKER, "lut:0"]);
});

test("a truncated or over-long message is rejected rather than parsed loosely", () => {
  assert.throws(() => parseSolanaMessage(Uint8Array.from([0x80, 1, 0, 1, 2])), /truncated|malformed/i);
  const trailing = Uint8Array.from([...message(ROUTE), 0]);
  assert.throws(() => parseSolanaMessage(trailing), /longer than its declared contents/i);
});

test("a legacy message parses too", () => {
  const versioned = message(ROUTE);
  // Same payload without the version byte and without the lookup section.
  const legacy = Uint8Array.from([...versioned.slice(1, versioned.length - 1)]);
  const parsed = parseSolanaMessage(legacy);
  assert.equal(parsed.version, "legacy");
  assert.equal(parsed.feePayer, TAKER);
  assert.equal(parsed.instructions[0].programAddress, JUPITER);
});
