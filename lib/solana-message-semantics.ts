import { createHash } from "node:crypto";
import { canonicalMessageSemantics, parseSolanaMessage } from "@/lib/solana-message-parse";

export {
  addedInstructionPrograms,
  canonicalMessageSemantics,
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  diffSolanaMessages,
  parseSolanaMessage,
  solanaTransactionMessageBytes,
  type ParsedSolanaMessage,
  type ParsedMessageInstruction,
} from "@/lib/solana-message-parse";

/** The commitment the server stores at quote time and re-derives on submission. */
export function solanaMessageSemanticDigest(message: Uint8Array) {
  return createHash("sha256")
    .update(canonicalMessageSemantics(parseSolanaMessage(message)))
    .digest("hex");
}

