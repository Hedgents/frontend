import assert from "node:assert/strict";
import test from "node:test";
import { resetJupiterVenueCacheForTests, reviewedJupiterVenues } from "./jupiter-venue-allowlist";

/**
 * Jupiter routes through more than a hundred venues; the reviewed set is a handful. Enforcing the
 * program allowlist only after the router has chosen turns that mismatch into an intermittent dead
 * end: a pair works when it happens to get a single reviewed hop and fails when it does not.
 * Constraining the request instead moves the same rule to where the choice is made.
 */
const GOONFI = "goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE";
const BYREAL = "REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2";

function withLabelMap(map: Record<string, unknown> | Error) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    if (map instanceof Error) throw map;
    return new Response(JSON.stringify(map), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return () => { globalThis.fetch = original; };
}

function currentAllowlist(): ReadonlySet<string> | null {
  const raw = process.env.HEDGENTS_SOLANA_PROGRAM_ALLOWLIST?.trim();
  if (!raw) return null;
  return new Set(raw.split(",").map((entry) => entry.trim()).filter(Boolean));
}

function withAllowlist(value: string | undefined) {
  const previous = process.env.HEDGENTS_SOLANA_PROGRAM_ALLOWLIST;
  if (value === undefined) delete process.env.HEDGENTS_SOLANA_PROGRAM_ALLOWLIST;
  else process.env.HEDGENTS_SOLANA_PROGRAM_ALLOWLIST = value;
  return () => {
    if (previous === undefined) delete process.env.HEDGENTS_SOLANA_PROGRAM_ALLOWLIST;
    else process.env.HEDGENTS_SOLANA_PROGRAM_ALLOWLIST = previous;
  };
}

test("the venue list is derived from the reviewed programs, so the two cannot drift", async () => {
  resetJupiterVenueCacheForTests();
  const restoreEnv = withAllowlist(`${GOONFI},${BYREAL}`);
  const restoreFetch = withLabelMap({ [GOONFI]: "GoonFi V2", [BYREAL]: "Byreal", other: "AlphaQ" });
  try {
    assert.equal(await reviewedJupiterVenues({ apiKey: "key", allowlist: currentAllowlist() }), "Byreal,GoonFi V2");
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test("the public label map works without sending an empty API-key header", async () => {
  resetJupiterVenueCacheForTests();
  const restoreEnv = withAllowlist(GOONFI);
  const original = globalThis.fetch;
  let observedHeaders: Headers | null = null;
  globalThis.fetch = (async (_input, init) => {
    observedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ [GOONFI]: "GoonFi V2" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  try {
    assert.equal(await reviewedJupiterVenues({ apiKey: null, allowlist: currentAllowlist() }), "GoonFi V2");
    assert.equal(observedHeaders?.has("x-api-key"), false);
  } finally {
    globalThis.fetch = original;
    restoreEnv();
  }
});

test("a reviewed program with no Jupiter label contributes no venue", async () => {
  resetJupiterVenueCacheForTests();
  const restoreEnv = withAllowlist(`${GOONFI},SomeProgramJupiterHasNoNameFor11111111111`);
  const restoreFetch = withLabelMap({ [GOONFI]: "GoonFi V2" });
  try {
    assert.equal(await reviewedJupiterVenues({ apiKey: "key", allowlist: currentAllowlist() }), "GoonFi V2");
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test("routing is left unconstrained when there is no allowlist to constrain to", async () => {
  resetJupiterVenueCacheForTests();
  const restoreEnv = withAllowlist(undefined);
  const restoreFetch = withLabelMap({ [GOONFI]: "GoonFi V2" });
  try {
    assert.equal(await reviewedJupiterVenues({ apiKey: "key", allowlist: currentAllowlist() }), null);
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test("an unreachable label map fails open rather than blocking every quote", async () => {
  // The post-hoc program check still refuses an unreviewed route, so the worst case here is the
  // behaviour we had before, not a terminal that cannot quote at all.
  resetJupiterVenueCacheForTests();
  const restoreEnv = withAllowlist(GOONFI);
  const restoreFetch = withLabelMap(new Error("network down"));
  try {
    assert.equal(await reviewedJupiterVenues({ apiKey: "key", allowlist: currentAllowlist() }), null);
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test("the label map is fetched once and reused", async () => {
  resetJupiterVenueCacheForTests();
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ [GOONFI]: "GoonFi V2" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  const restoreEnv = withAllowlist(GOONFI);
  try {
    await reviewedJupiterVenues({ apiKey: "key", allowlist: currentAllowlist() });
    await reviewedJupiterVenues({ apiKey: "key", allowlist: currentAllowlist() });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    restoreEnv();
  }
});
