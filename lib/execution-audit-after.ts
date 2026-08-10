import "server-only";

import { after } from "next/server";
import { recordExecutionAuditObservation } from "@/lib/execution-audit-store";
import type { ExecutionAuditObservationInput } from "@/lib/execution-audit-schema";

/**
 * Observation evidence must never replace a known execution or recovery
 * response. Next/Vercel keeps the callback alive after the response; a missing
 * request context or scheduling failure is deliberately swallowed because the
 * immutable pre-submit intent and Solana remain the authoritative boundaries.
 */
export function scheduleExecutionAuditObservation(input: ExecutionAuditObservationInput) {
  try {
    after(() => recordExecutionAuditObservation(input));
  } catch {
    // Best effort by design. The caller must return its actual result.
  }
}
