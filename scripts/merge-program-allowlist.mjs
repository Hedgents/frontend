#!/usr/bin/env node
/**
 * Merge programs into HEDGENTS_SOLANA_PROGRAM_ALLOWLIST without dropping anything.
 *
 *   node scripts/merge-program-allowlist.mjs "<current value>" [program ...]
 *
 * The variable cannot be read back once written, so a hand-edit that drops an entry is invisible
 * until a tester's order dead-ends against a venue that used to work. This validates every entry,
 * refuses to lose one, and prints the exact commands, because `vercel env add --force` silently
 * no-ops on an existing key and must be preceded by `rm`.
 *
 * Defaults to adding Raydium CLMM, the only measured gap on the live USDC pair.
 * See docs/allowlist-candidates.md.
 */

const DEFAULT_ADDITIONS = [
  // Raydium CLMM. Carries the $50 and $100 USDC buys; upgrades are multisig-gated.
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
];

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const [current, ...requested] = process.argv.slice(2);

if (!current) {
  console.error(
    "usage: node scripts/merge-program-allowlist.mjs \"<current comma-separated value>\" [program ...]\n\n"
      + "Read the current value from the Vercel dashboard (Settings, Environment Variables,\n"
      + "HEDGENTS_SOLANA_PROGRAM_ALLOWLIST, Production). It is a list of public Solana program\n"
      + "addresses, so there is nothing secret in it.",
  );
  process.exit(2);
}

const existing = current.split(",").map((value) => value.trim()).filter(Boolean);
const additions = (requested.length ? requested : DEFAULT_ADDITIONS).map((v) => v.trim());

const invalid = [...existing, ...additions].filter((value) => !BASE58.test(value));
if (invalid.length) {
  console.error(`Not valid base58 program addresses:\n  ${invalid.join("\n  ")}`);
  process.exit(1);
}

const merged = [...existing];
const added = [];
const alreadyPresent = [];
for (const program of additions) {
  if (merged.includes(program)) alreadyPresent.push(program);
  else { merged.push(program); added.push(program); }
}

console.log(`current entries : ${existing.length}`);
if (alreadyPresent.length) console.log(`already present : ${alreadyPresent.join(", ")}`);
console.log(`adding          : ${added.length ? added.join(", ") : "(nothing)"}`);
console.log(`merged entries  : ${merged.length}`);

if (merged.length !== existing.length + added.length) {
  console.error("\nRefusing to continue: the merge changed the entry count unexpectedly.");
  process.exit(1);
}
if (!added.length) {
  console.log("\nNothing to do.");
  process.exit(0);
}

const value = merged.join(",");
console.log("\n--- new value ---");
console.log(value);
console.log("--- end ---");
console.log(
  "\nApply (rm first: `env add --force` silently no-ops on an existing key):\n\n"
    + "  vercel env rm HEDGENTS_SOLANA_PROGRAM_ALLOWLIST production -y\n"
    + `  printf '%s' '${value}' | vercel env add HEDGENTS_SOLANA_PROGRAM_ALLOWLIST production\n`
    + "  vercel deploy --prod\n\n"
    + "The redeploy is required: Vercel binds env values to a deployment at creation, so the\n"
    + "change does nothing to what is currently serving until you ship.\n\n"
    + "Then verify with a $100 USDC buy quote, which is where Raydium CLMM routes, and watch\n"
    + "\"Why they failed\" in /admin for route_not_reviewed.",
);
