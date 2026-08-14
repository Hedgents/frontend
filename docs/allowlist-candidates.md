# Program allowlist: candidates for review

Measured 2026-08-14 against mainnet. Method: 84 Jupiter quotes for USDC↔PAXG across the beta size
ladder ($5 to $100), both directions, with and without `restrictIntermediateTokens`, plus the
program sets actually invoked by the two canary transactions.

Reproduce with `scripts/allowlist-candidates.py`.

## The headline

**PAXG at beta sizes is a three-venue problem, not a 103-venue one.** Across 84 samples Jupiter
never once returned a multi-hop route, and only three venues appeared at all:

| venue | program | share of sampled routes |
| --- | --- | --- |
| GoonFi V2 | `goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE` | 28/42 |
| Raydium CLMM | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | 9/42 |
| Whirlpool (Orca) | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | 5/42 |

That materially deflates the "routing treadmill" worry for this pair. The fear was that a strict
allowlist collides with an unbounded set of venues reachable through multi-hop routes. For
USDC↔PAXG at these sizes, the reachable set is three, and it is stable.

## Already allowed, proven from chain

Both canary transactions passed the guard, so every program they invoked is necessarily in the
allowlist today. Excluding the two the guard treats as injectable (ComputeBudget, Lighthouse):

```
JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4   Jupiter Aggregator v6
whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc   Whirlpool (Orca)          [buy  2Y9kfgRh…]
goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE   GoonFi V2                 [sell 4fMwmczN…]
TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA   SPL Token
TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb   Token-2022
ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL   Associated Token Account
11111111111111111111111111111111              System
MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr   SPL Memo
```

## The candidate

**Raydium CLMM, `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`.** It is the only venue Jupiter
chooses for PAXG that is not proven present. It carried 9 of 42 sampled routes, and its appearances
cluster at the **$50 and $100 buys**, which is exactly the top of the beta cap where testers who
want a real position will land. A tester buying $100 has a materially higher chance of hitting it
than the $10 canary did, which is why the canary passing says less than it appears to.

Caveat: `HEDGENTS_SOLANA_PROGRAM_ALLOWLIST` is a Vercel sensitive variable and cannot be read back,
so this is "not proven present", not "proven absent". Check the current value before adding it.

## Not candidates

- **BisonFi** `BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi`
- **JupLend AMM** `jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd`

These are the two refusals seen in testing, but they appeared on **USDT and USDG sell routes**, and
those settlement assets are disabled for the beta. Adding them widens the surface for pairs the
terminal will not trade. The third refusal, `jupeiUmn…`, is not in Jupiter's program-to-label map at
all, so it cannot be constrained through `dexes` either way.

## What the allowlist does not give you

All three venue programs are **upgradeable**, so the allowlist pins a program *address*, not the
code behind it. "Reviewed" therefore means reviewed as of a date. Last redeploys, relative to the
canary at slot 439037345:

| venue | last deployed | age at canary |
| --- | --- | --- |
| Whirlpool | slot 398059635 | ~190 days |
| Raydium CLMM | slot 436167935 | ~13 days |
| GoonFi V2 | slot 438563879 | **~2 days** |

The reassuring part: every upgrade authority is **off-curve**, so it is a PDA and upgrades are
controlled by a program (multisig or governance) rather than by one private key. Verified by testing
each authority against the ed25519 curve equation:

```
BBvfpKqYovhzEjS4Ch1xZXFdxkaoUiXsujR9kgN1t8iR   GoonFi V2       off-curve (PDA)
FytDrVzDybM1TwFQPGb8qaxZR7dBCzNeqT3vtQsceZQK   Raydium CLMM    off-curve (PDA)
GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV   Whirlpool       off-curve (PDA)
```

Worth knowing rather than worth solving now: GoonFi V2 already carries most of your sell flow and
had been redeployed two days before the canary, so it is the least settled thing in the path and it
is already inside the gate.
