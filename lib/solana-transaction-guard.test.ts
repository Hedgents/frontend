import assert from "node:assert/strict";
import test from "node:test";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
} from "@solana/kit";
import {
  assertProgramFingerprintAllowed,
  assertTransactionGuardCompatible,
  configuredMaximumSolDebitLamports,
  configuredProgramFingerprintAllowlist,
  guardSolanaTransaction,
  type SolanaSimulationValue,
  type TransactionGuardExpectation,
} from "./solana-transaction-guard";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const addressDecoder = getAddressDecoder();
const addressEncoder = getAddressEncoder();
const base58Decoder = getBase58Decoder();

function generatedAddress(byte: number) {
  return String(addressDecoder.decode(Uint8Array.from({ length: 32 }, () => byte)));
}

const taker = generatedAddress(7);
const inputAccount = generatedAddress(8);
const outputAccount = generatedAddress(9);
const unrelatedAccount = generatedAddress(10);
const inputMint = generatedAddress(11);
const outputMint = generatedAddress(12);
const unrelatedMint = generatedAddress(13);
const lookupTable = generatedAddress(14);

function encodedAddress(value: string) {
  return [...addressEncoder.encode(address(value))];
}

function fixture(options: {
  version?: "legacy" | 0;
  programId?: string;
  instructionData?: number[];
  instructionAccounts?: number[];
  loadedOutput?: boolean;
  signed?: boolean;
} = {}) {
  const version = options.version ?? 0;
  const programId = options.programId ?? TOKEN_PROGRAM;
  const loadedOutput = options.loadedOutput ?? false;
  const staticAccounts = loadedOutput
    ? [taker, inputAccount, unrelatedAccount, programId]
    : [taker, inputAccount, outputAccount, unrelatedAccount, programId];
  const outputIndex = loadedOutput ? staticAccounts.length : 2;
  const programIndex = staticAccounts.indexOf(programId);
  const instructionData = options.instructionData ?? [3];
  const instructionAccounts = options.instructionAccounts ?? [1, outputIndex, 0];
  const message = [
    ...(version === 0 ? [0x80] : []),
    1,
    0,
    1,
    staticAccounts.length,
    ...staticAccounts.flatMap(encodedAddress),
    ...Array.from({ length: 32 }, () => 15),
    1,
    programIndex,
    instructionAccounts.length,
    ...instructionAccounts,
    instructionData.length,
    ...instructionData,
    ...(version === 0
      ? loadedOutput
        ? [1, ...encodedAddress(lookupTable), 1, 0, 0]
        : [0]
      : []),
  ];
  return {
    encoded: Buffer.from([
      1,
      ...Array.from({ length: 64 }, () => options.signed ? 4 : 0),
      ...message,
    ]).toString("base64"),
    resolvedAccounts: loadedOutput
      ? [...staticAccounts, outputAccount]
      : staticAccounts,
    outputIndex,
    loadedAddresses: loadedOutput
      ? { writable: [outputAccount], readonly: [] }
      : { writable: [], readonly: [] },
  };
}

function tokenBalance(
  accountIndex: number,
  mint: string,
  amount: string,
  owner = taker,
) {
  return {
    accountIndex,
    mint,
    owner,
    programId: TOKEN_PROGRAM,
    uiTokenAmount: { amount, decimals: 6 },
  };
}

function scenario(options: {
  version?: "legacy" | 0;
  loadedOutput?: boolean;
  programId?: string;
  instructionData?: number[];
  instructionAccounts?: number[];
  preInput?: string;
  postInput?: string;
  preOutput?: string;
  postOutput?: string;
  preUnrelated?: string;
  postUnrelated?: string;
  preTakerLamports?: number;
  postTakerLamports?: number;
  fee?: number | null;
  innerInstructions?: SolanaSimulationValue["innerInstructions"];
}) {
  const built = fixture(options);
  const inputIndex = 1;
  const unrelatedIndex = options.loadedOutput ? 2 : 3;
  const preBalances = built.resolvedAccounts.map(() => 2_039_280);
  const postBalances = built.resolvedAccounts.map(() => 2_039_280);
  preBalances[0] = options.preTakerLamports ?? 20_000_000;
  postBalances[0] = options.postTakerLamports ?? 19_995_000;
  const simulation: SolanaSimulationValue = {
    err: null,
    fee: options.fee === undefined ? 5_000 : options.fee,
    logs: [],
    unitsConsumed: 80_000,
    preBalances,
    postBalances,
    preTokenBalances: [
      tokenBalance(inputIndex, inputMint, options.preInput ?? "1000"),
      tokenBalance(built.outputIndex, outputMint, options.preOutput ?? "0"),
      tokenBalance(unrelatedIndex, unrelatedMint, options.preUnrelated ?? "10"),
    ],
    postTokenBalances: [
      tokenBalance(inputIndex, inputMint, options.postInput ?? "900"),
      tokenBalance(built.outputIndex, outputMint, options.postOutput ?? "50"),
      tokenBalance(unrelatedIndex, unrelatedMint, options.postUnrelated ?? "10"),
    ],
    loadedAddresses: built.loadedAddresses,
    innerInstructions: options.innerInstructions ?? [],
  };
  const expectation: TransactionGuardExpectation = {
    taker,
    inputMint,
    outputMint,
    inputAmount: "100",
    minimumOutputAmount: "40",
    maximumSolDebitLamports: "10000000",
  };
  return { ...built, simulation, expectation };
}

test("accepts exact-debit legacy and v0 transactions, including resolved lookup-table accounts", () => {
  for (const options of [
    { version: "legacy" as const },
    { version: 0 as const },
    { version: 0 as const, loadedOutput: true },
  ]) {
    const input = scenario(options);
    const report = guardSolanaTransaction(input.encoded, input.simulation, input.expectation);
    assert.equal(report.inputDebitAmount, "100");
    assert.equal(report.outputCreditAmount, "50");
    assert.equal(report.takerSolDebitLamports, "5000");
    assert.equal(report.networkFeeLamports, "5000");
    assert.match(report.reportDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual(report.programIds, [TOKEN_PROGRAM]);
  }
});

test("rejects input over-debit, insufficient output, and unrelated taker-mint debit", () => {
  for (const input of [
    scenario({ postInput: "899" }),
    scenario({ postOutput: "39" }),
    scenario({ postUnrelated: "9" }),
  ]) {
    assert.throws(
      () => guardSolanaTransaction(input.encoded, input.simulation, input.expectation),
      /Unsafe Solana transaction/,
    );
  }
});

test("fails closed when required simulation accounting fields are missing", () => {
  for (const field of [
    "fee",
    "preBalances",
    "postBalances",
    "preTokenBalances",
    "postTokenBalances",
    "loadedAddresses",
    "innerInstructions",
  ] as const) {
    const input = scenario({});
    delete input.simulation[field];
    assert.throws(
      () => guardSolanaTransaction(input.encoded, input.simulation, input.expectation),
      /Unsafe Solana transaction/,
      field,
    );
  }
});

test("rejects excess SOL loss and unsafe lamport precision", () => {
  const excessive = scenario({ preTakerLamports: 20_000_000, postTakerLamports: 9_000_000 });
  assert.throws(
    () => guardSolanaTransaction(excessive.encoded, excessive.simulation, excessive.expectation),
    /exceeds the operator cap/,
  );
  const unsafe = scenario({});
  unsafe.simulation.preBalances![0] = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(
    () => guardSolanaTransaction(unsafe.encoded, unsafe.simulation, unsafe.expectation),
    /safe lamport value/,
  );
});

test("rejects mismatched or duplicate lookup-table resolution", () => {
  const missing = scenario({ loadedOutput: true });
  missing.simulation.loadedAddresses = { writable: [], readonly: [] };
  assert.throws(
    () => guardSolanaTransaction(missing.encoded, missing.simulation, missing.expectation),
    /lookup-table account counts/,
  );

  const duplicate = scenario({ loadedOutput: true });
  duplicate.simulation.loadedAddresses = { writable: [inputAccount], readonly: [] };
  assert.throws(
    () => guardSolanaTransaction(duplicate.encoded, duplicate.simulation, duplicate.expectation),
    /contains duplicates/,
  );
});

test("rejects dangerous token authority, approval, burn, and close instructions", () => {
  for (const opcode of [4, 6, 8, 9, 10, 13, 15]) {
    const input = scenario({ instructionData: [opcode] });
    assert.throws(
      () => guardSolanaTransaction(input.encoded, input.simulation, input.expectation),
      /Unsafe Solana transaction/,
      `token opcode ${opcode}`,
    );
  }
});

test("rejects parsed dangerous token CPIs and arbitrary System transfers from the taker", () => {
  const authority = scenario({
    innerInstructions: [{
      index: 0,
      instructions: [{
        programId: TOKEN_PROGRAM,
        program: "spl-token",
        parsed: { type: "setAuthority", info: { account: inputAccount } },
      }],
    }],
  });
  assert.throws(
    () => guardSolanaTransaction(authority.encoded, authority.simulation, authority.expectation),
    /setAuthority/,
  );

  const systemTransferData = [2, 0, 0, 0, ...Array.from({ length: 8 }, () => 0)];
  const transfer = scenario({
    programId: SYSTEM_PROGRAM,
    instructionData: systemTransferData,
    instructionAccounts: [0, 2],
  });
  assert.throws(
    () => guardSolanaTransaction(transfer.encoded, transfer.simulation, transfer.expectation),
    /arbitrary System Program transfer/,
  );
});

test("safely resolves the standard compiled inner-instruction RPC shape", () => {
  const input = scenario({
    innerInstructions: [{
      index: 0,
      instructions: [{
        programIdIndex: 4,
        accounts: [1, 2, 0],
        data: base58Decoder.decode(Uint8Array.of(3)),
      }],
    }],
  });
  const report = guardSolanaTransaction(input.encoded, input.simulation, input.expectation);
  assert.deepEqual(report.programIds, [TOKEN_PROGRAM]);

  const parsed = scenario({
    innerInstructions: [{
      index: 0,
      instructions: [{
        programId: TOKEN_PROGRAM,
        program: "spl-token",
        parsed: {
          type: "transfer",
          info: { source: inputAccount, destination: outputAccount, authority: taker, amount: "100" },
        },
      }],
    }],
  });
  const parsedReport = guardSolanaTransaction(parsed.encoded, parsed.simulation, parsed.expectation);
  assert.equal(
    parsedReport.reportDigest,
    report.reportDigest,
    "equivalent parsed and compiled RPC presentations must commit identically",
  );
});

test("rejects out-of-range compiled inner programs, accounts, and outer-group indexes", () => {
  for (const innerInstructions of [
    [{ index: 0, instructions: [{ programIdIndex: 99, accounts: [1], data: "4" }] }],
    [{ index: 0, instructions: [{ programIdIndex: 4, accounts: [99], data: "4" }] }],
    [{ index: 1, instructions: [{ programIdIndex: 4, accounts: [1], data: "4" }] }],
  ]) {
    const input = scenario({ innerInstructions });
    assert.throws(
      () => guardSolanaTransaction(input.encoded, input.simulation, input.expectation),
      /Unsafe Solana transaction/,
    );
  }
});

test("rejects System assign/allocate mutations of the taker wallet", () => {
  for (const opcode of [1, 8, 9, 10]) {
    const input = scenario({
      programId: SYSTEM_PROGRAM,
      instructionData: [opcode, 0, 0, 0],
      instructionAccounts: [0],
    });
    assert.throws(
      () => guardSolanaTransaction(input.encoded, input.simulation, input.expectation),
      /assign or allocate/,
    );
  }
  const parsed = scenario({
    innerInstructions: [{
      index: 0,
      instructions: [{
        programId: SYSTEM_PROGRAM,
        program: "system",
        parsed: { type: "allocateWithSeed", info: { account: taker, base: unrelatedAccount } },
      }],
    }],
  });
  assert.throws(
    () => guardSolanaTransaction(parsed.encoded, parsed.simulation, parsed.expectation),
    /assign or allocate/,
  );
});

test("rejects malformed loaded addresses and token metadata addresses", () => {
  const loaded = scenario({ loadedOutput: true });
  loaded.simulation.loadedAddresses = { writable: ["not-a-solana-address"], readonly: [] };
  assert.throws(
    () => guardSolanaTransaction(loaded.encoded, loaded.simulation, loaded.expectation),
    /canonical Solana address/,
  );

  const metadata = scenario({});
  metadata.simulation.preTokenBalances![0].owner = "not-a-solana-address";
  assert.throws(
    () => guardSolanaTransaction(metadata.encoded, metadata.simulation, metadata.expectation),
    /canonical Solana address/,
  );
});

test("requires the pre-submit safety report to match the signed order report", () => {
  const input = scenario({});
  const report = guardSolanaTransaction(input.encoded, input.simulation, input.expectation);
  assert.doesNotThrow(() => assertTransactionGuardCompatible(report, report));
  assert.throws(
    () => assertTransactionGuardCompatible(
      { ...report, networkFeeLamports: "6000" },
      report,
    ),
    /authenticated safety report/,
  );
});

test("an explicit program-fingerprint allowlist rejects every unreviewed route", () => {
  const previous = process.env.HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST;
  try {
    process.env.HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST = "0".repeat(64);
    const input = scenario({});
    const report = guardSolanaTransaction(input.encoded, input.simulation, input.expectation);
    assert.throws(() => assertProgramFingerprintAllowed(report), /has not passed the operator canary review/);
    process.env.HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST = report.programFingerprint;
    assert.doesNotThrow(() => assertProgramFingerprintAllowed(report));
  } finally {
    if (previous === undefined) delete process.env.HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST;
    else process.env.HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST = previous;
  }
});

test("operator SOL cap and production fingerprint policy fail closed when unconfigured", () => {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const previousCap = process.env.HEDGENTS_MAX_SOL_DEBIT_LAMPORTS;
  const previousFingerprints = process.env.HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST;
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    delete process.env.HEDGENTS_MAX_SOL_DEBIT_LAMPORTS;
    assert.throws(() => configuredMaximumSolDebitLamports(), /Set HEDGENTS_MAX_SOL_DEBIT_LAMPORTS/);
    process.env.HEDGENTS_MAX_SOL_DEBIT_LAMPORTS = "10000000";
    assert.equal(configuredMaximumSolDebitLamports(), "10000000");

    mutableEnv.NODE_ENV = "production";
    delete process.env.HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST;
    assert.throws(
      () => configuredProgramFingerprintAllowlist(),
      /Set HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST/,
    );
  } finally {
    if (previousCap === undefined) delete process.env.HEDGENTS_MAX_SOL_DEBIT_LAMPORTS;
    else process.env.HEDGENTS_MAX_SOL_DEBIT_LAMPORTS = previousCap;
    if (previousFingerprints === undefined) delete process.env.HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST;
    else process.env.HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST = previousFingerprints;
    if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previousNodeEnv;
  }
});
