/**
 * Normalize an etag read from Vercel Blob into a form `ifMatch` will actually accept.
 *
 * Blob serves objects above roughly one kilobyte compressed, and a compressed response carries a
 * WEAK validator: `W/"<hash>"` rather than `"<hash>"`. `If-Match` is defined to use strong
 * comparison, so a weak validator never matches and the conditional write fails with
 * "Precondition failed: ETag mismatch" every single time, forever, for that object.
 *
 * The failure mode is nasty because it is size-triggered and silent. A store works perfectly while
 * its object is small, and the day it crosses the threshold every conditional write starts failing.
 * It was found on 2026-08-18 after `scarcity/detector/state-v1.json` grew to 75 KB: the daily cron
 * had been running, doing its work, and discarding the result for nine days, because the write it
 * ended with could never succeed. Nothing logged an error a human saw.
 *
 * The hash inside the weak validator is the same hash the strong one carries, so dropping the `W/`
 * marker restores a matching comparison. The quotes are part of the value and must stay: stripping
 * them fails too. Verified against live Blob at 0.05, 0.5, 1, 2, 4, 8 and 32 KB.
 *
 * Apply this at every point an etag is read, never at the point it is used, so a new store cannot
 * pick up the raw value by accident.
 */
export function strongEtag(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.startsWith("W/") ? trimmed.slice(2) : trimmed;
}
