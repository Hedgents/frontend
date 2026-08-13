/**
 * The request body Jupiter's execute endpoint expects.
 *
 * `lastValidBlockHeight` goes over the wire as a STRING. Sending the number it is everywhere else
 * in this codebase makes Jupiter's schema reject the whole request before it looks at the
 * transaction: a validation error, no execution, and nothing on chain.
 *
 * Pure and free of server-only imports so the wire shape can be tested directly, which is the point
 * of it living here rather than inline at the call site.
 */
export interface JupiterExecuteInput {
  signedTransaction: string;
  requestId: string;
  lastValidBlockHeight?: number;
}

export function jupiterExecuteBody(input: JupiterExecuteInput): Record<string, string> {
  return {
    signedTransaction: input.signedTransaction,
    requestId: input.requestId,
    // Compared against undefined rather than tested for truthiness: block height zero is a value,
    // not an absence, and dropping it would silently change what was submitted.
    ...(input.lastValidBlockHeight === undefined
      ? {}
      : { lastValidBlockHeight: String(input.lastValidBlockHeight) }),
  };
}
