
/**
 * Restrict Jupiter to the venues whose programs have passed operator review.
 *
 * The program allowlist is enforced after Jupiter has already chosen a route, which makes it a dead
 * end rather than a constraint: the router picks from over a hundred venues, the reviewed set is a
 * handful, and any multi-hop route is likely to touch something unreviewed. The result was a
 * failure that depended on which venues happened to be cheapest that second. A pair could work and
 * then not, and a single-hop USDC route succeeding was partly luck.
 *
 * Passing `dexes` moves the same rule to where the decision is made. Jupiter then either returns a
 * route through reviewed venues or reports that none exists, and the post-hoc program check becomes
 * a backstop that should never fire rather than the thing users collide with.
 *
 * The venue list is derived from the program allowlist rather than configured separately, so the
 * two cannot drift apart. A program with no Jupiter label simply contributes no venue, which is
 * correct: the router cannot be asked for something it has no name for.
 *
 * The allowlist is passed in rather than read here, which keeps this free of server-only imports
 * and testable directly.
 */
const PROGRAM_LABEL_ENDPOINT = "https://api.jup.ag/swap/v1/program-id-to-label";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cache: { labels: Map<string, string>; fetchedAt: number } | null = null;

async function programLabels(apiKey: string | null): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.labels;
  const response = await fetch(PROGRAM_LABEL_ENDPOINT, {
    headers: apiKey ? { "x-api-key": apiKey } : {},
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Jupiter label map returned ${response.status}`);
  const payload = (await response.json()) as Record<string, unknown>;
  const labels = new Map<string, string>();
  for (const [program, label] of Object.entries(payload)) {
    if (typeof label === "string" && label) labels.set(program, label);
  }
  if (labels.size === 0) throw new Error("Jupiter label map is empty");
  cache = { labels, fetchedAt: Date.now() };
  return labels;
}

/**
 * The `dexes` value for an order request, or null when routing should stay unconstrained.
 *
 * Null when no allowlist is configured, since there is nothing to constrain to, and null if the
 * label map cannot be read. Failing open here is deliberate: the post-hoc program check still
 * refuses an unreviewed route, so the worst case is the behaviour we have today rather than a
 * terminal that cannot quote.
 */
export async function reviewedJupiterVenues(input: {
  apiKey: string | null;
  allowlist: ReadonlySet<string> | null;
}): Promise<string | null> {
  const { apiKey, allowlist } = input;
  if (!allowlist || allowlist.size === 0) return null;
  let labels: Map<string, string>;
  try {
    labels = await programLabels(apiKey);
  } catch {
    return null;
  }
  const venues = new Set<string>();
  for (const program of allowlist) {
    const label = labels.get(program);
    if (label) venues.add(label);
  }
  if (venues.size === 0) return null;
  return [...venues].sort().join(",");
}

/** Testing seam: the label map is cached for six hours and would otherwise leak between cases. */
export function resetJupiterVenueCacheForTests() {
  cache = null;
}
