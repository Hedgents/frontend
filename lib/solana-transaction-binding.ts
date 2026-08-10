import { createHash } from "node:crypto";
import {
  address,
  getAddressEncoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
} from "@solana/kit";
import { ExecutionValidationError } from "@/lib/execution-validation";

const addressEncoder = getAddressEncoder();

function decodeShortVec(bytes: Uint8Array, start: number) {
  let value = 0;
  let shift = 0;
  let offset = start;
  for (let index = 0; index < 3; index += 1) {
    if (offset >= bytes.length) throw new ExecutionValidationError("The Solana transaction header is truncated.", 502);
    const byte = bytes[offset];
    value |= (byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7;
  }
  throw new ExecutionValidationError("The Solana transaction header is malformed.", 502);
}

function decodeBase64Transaction(value: string) {
  if (typeof value !== "string" || value.length < 100 || value.length > 16_000) {
    throw new ExecutionValidationError("The Solana transaction is missing or malformed.", 502);
  }
  const bytes = Uint8Array.from(Buffer.from(value, "base64"));
  if (
    bytes.length < 100
    || Buffer.from(bytes).toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")
  ) {
    throw new ExecutionValidationError("The Solana transaction is not canonical base64.", 502);
  }
  return bytes;
}

function equalBytes(left: ArrayLike<number>, right: ArrayLike<number>) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export interface SolanaTransactionBinding {
  messageDigest: string;
  signatureCount: number;
  requiredSignatureCount: number;
  firstSignaturePresent: boolean;
  firstSignature: string | null;
}

export function bindSolanaTransaction(
  transaction: string,
  expectedFeePayer: string,
  options: { requireFirstSignature?: boolean } = {},
): SolanaTransactionBinding {
  const bytes = decodeBase64Transaction(transaction);
  const signatures = decodeShortVec(bytes, 0);
  if (signatures.value < 1 || signatures.value > 64) {
    throw new ExecutionValidationError("The Solana transaction has an invalid signer count.", 502);
  }
  const messageOffset = signatures.offset + signatures.value * 64;
  if (messageOffset + 4 + 32 > bytes.length) {
    throw new ExecutionValidationError("The Solana transaction message is truncated.", 502);
  }
  const firstSignature = bytes.slice(signatures.offset, signatures.offset + 64);
  const firstSignaturePresent = firstSignature.some((byte) => byte !== 0);
  if (options.requireFirstSignature && !firstSignaturePresent) {
    throw new ExecutionValidationError("The connected wallet did not sign the executable transaction.");
  }

  const message = bytes.slice(messageOffset);
  const versioned = (message[0] & 0x80) !== 0;
  if (versioned && (message[0] & 0x7f) !== 0) {
    throw new ExecutionValidationError("The executable route uses an unsupported Solana message version.", 502);
  }
  const headerOffset = versioned ? 1 : 0;
  const requiredSignatureCount = message[headerOffset];
  if (requiredSignatureCount !== signatures.value) {
    throw new ExecutionValidationError("The Solana transaction signer header does not match its signatures.", 502);
  }
  const accounts = decodeShortVec(message, headerOffset + 3);
  if (accounts.value < requiredSignatureCount || accounts.offset + accounts.value * 32 > message.length) {
    throw new ExecutionValidationError("The Solana transaction account table is malformed.", 502);
  }
  const feePayer = message.slice(accounts.offset, accounts.offset + 32);
  const expected = addressEncoder.encode(address(expectedFeePayer));
  if (!equalBytes(feePayer, expected)) {
    throw new ExecutionValidationError("The executable transaction fee payer does not match the connected wallet.", 502);
  }

  return {
    messageDigest: createHash("sha256").update(Buffer.from(message)).digest("hex"),
    signatureCount: signatures.value,
    requiredSignatureCount,
    firstSignaturePresent,
    firstSignature: firstSignaturePresent
      ? String(getSignatureFromTransaction(getTransactionDecoder().decode(bytes)))
      : null,
  };
}
