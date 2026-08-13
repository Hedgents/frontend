/**
 * Did the wallet change the transaction it was asked to sign?
 *
 * The Solana wallet standard's `signTransaction` is a MODIFYING signer: a wallet is free to return
 * something other than what it was handed, and several do, injecting or replacing a compute-budget
 * instruction to set a priority fee. The server authorises one exact message and compares its hash
 * on submission, so any such edit is refused with "the signed transaction does not match the
 * authenticated executable quote" and no explanation of what moved.
 *
 * The client holds both transactions, so it can say. This is diagnosis only: it decides nothing and
 * relaxes nothing. The server's byte comparison remains the authority on whether a transaction may
 * execute.
 *
 * Both inputs are full wire transactions: a short-vec signature count, that many 64-byte
 * signatures, then the message. Only the message is compared, because signatures are expected to
 * differ; that is the point of signing.
 */

/** Solana's ComputeBudget111111111111111111111111111111 program, base58. */
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";

export interface WalletTamperReport {
  changed: boolean;
  /** True when the only difference is the message length, i.e. instructions were added or removed. */
  lengthChanged: boolean;
  originalMessageBytes: number;
  signedMessageBytes: number;
  /** A short, plain description suitable for showing someone mid-checkout. */
  summary: string | null;
}

function readShortVec(bytes: Uint8Array, offset: number) {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  for (let index = 0; index < 3; index += 1) {
    const byte = bytes[cursor];
    if (byte === undefined) throw new Error("Transaction is truncated.");
    cursor += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value, offset: cursor };
}

/** The message portion of a wire transaction, with the signature block removed. */
function messageOf(transaction: Uint8Array) {
  const signatures = readShortVec(transaction, 0);
  const start = signatures.offset + signatures.value * 64;
  if (start > transaction.length) throw new Error("Transaction is truncated.");
  return transaction.slice(start);
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function describeWalletTampering(input: {
  original: Uint8Array;
  signed: Uint8Array;
}): WalletTamperReport {
  let original: Uint8Array;
  let signed: Uint8Array;
  try {
    original = messageOf(input.original);
    signed = messageOf(input.signed);
  } catch {
    // Undecodable means something is wrong, but not something this function can characterise.
    return {
      changed: true, lengthChanged: false,
      originalMessageBytes: 0, signedMessageBytes: 0,
      summary: "The signed transaction could not be read back.",
    };
  }

  if (sameBytes(original, signed)) {
    return {
      changed: false, lengthChanged: false,
      originalMessageBytes: original.length, signedMessageBytes: signed.length,
      summary: null,
    };
  }

  const lengthChanged = original.length !== signed.length;
  const summary = lengthChanged
    ? "Your wallet added or removed an instruction before signing, which is usually an automatic "
      + "priority fee. Turn that setting off and build a fresh quote."
    : "Your wallet altered the transaction before signing without changing its size, so the route "
      + "or its amounts were edited. Build a fresh quote and do not approve if it happens again.";

  return {
    changed: true,
    lengthChanged,
    originalMessageBytes: original.length,
    signedMessageBytes: signed.length,
    summary,
  };
}
