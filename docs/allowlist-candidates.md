# Program allowlist: candidates for review

Measured 2026-08-14 against mainnet. Reproduce with `python3 scripts/allowlist-candidates.py --all`.

Method: Jupiter quotes across the beta size ladder ($5 to $100), both directions, for each
settlement asset, run twice; plus the program sets actually invoked by the two mainnet canaries, and
an on-chain upgrade-authority check on every venue that appeared.

## Measurement caveat, and which way it biases

The free tier refuses `restrictIntermediateTokens=false` (`NOT_SUPPORTED`), so **every sample below
ran in Jupiter's narrowest routing mode.** Production uses a paid key and routes less constrained.
Every venue count here is therefore a **floor**, not a census.

An earlier run reported USDG as having no routes at all. That was rate limiting counted as absence.
The sampler now distinguishes 429, no-route, and error, and USDG routes fine.

## USDC, the live pair: one candidate

USDC↔PAXG is single-hop and stable across runs. Three venues total, two of them provably present
already (both canaries passed the guard while touching them).

| venue | program | status |
| --- | --- | --- |
| GoonFi V2 | `goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE` | proven present (sell canary) |
| Whirlpool | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | proven present (buy canary) |
| **Raydium CLMM** | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | **candidate** |

Raydium CLMM clusters at the **$50 and $100 buys**, the top of the cap where a tester wanting a real
position lands. The $10 canary passing says little about that size.

## USDT and USDG: the set does not converge

Both are **multi-hop on essentially every route** (`Mercurial > GoonFi V2`,
`GoonFi V2 > SolFi V2`, `Aquifer > Manifest > Whirlpool`), which is the case the allowlist was always
going to struggle with. Two identical runs an hour apart produced materially different venue sets:

- run 1 surfaced Quantum, which run 2 never saw
- run 2 surfaced Byreal, HumidiFi, JupLend AMM, Perena and ZeroFi, none of which run 1 saw

Thirteen distinct venues across two runs, in the narrowest routing mode, still growing. This is not
a list that can be enumerated by sampling and then frozen.

| venue | program | needed by | upgrade authority | code age |
| --- | --- | --- | --- | --- |
| Mercurial | `MERLuDFBMmsHnsBPZw2sDQZHvXFMwp8EdjudcU2HKky` | USDT buy | PDA | 1570d |
| Perena | `NUMERUNsFCP3kuNmWZuXtm1AaQCPj9uw6Guv2Ekoi5P` | USDG buy | PDA | 507d |
| SolFi V2 | `SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF` | USDT sell | PDA | 154d |
| Manifest | `MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms` | USDT buy, USDG buy | PDA | 20d |
| Raydium CLMM | `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` | USDC buy, USDT sell | PDA | 14d |
| JupLend AMM | `jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd` | USDT sell | PDA | 4d |
| Aquifer | `AQU1FRd7papthgdrwPTTq5JacJh8YtwEXaBfKU3bTz45` | USDT buy, USDT sell | PDA | 3d |
| Byreal | `REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2` | USDT sell | PDA | 2d |
| **AlphaQ** | `ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA` | USDT both, USDG sell | **single keypair** | 76d |
| **ZeroFi** | `ZERor4xhbUycZ6gb9ntrhqscUcZmAbQDjEAtCf4hbZY` | USDG buy | **single keypair** | 6d |
| **HumidiFi** | `9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp` | USDG sell | **single keypair** | 1d |
| **Quantum** | `QuaNtZsgYRe5Z9Bk4LZ4cTD9tbkVoyCNf1R2BN9bBDv` | USDT sell | **single keypair** | 1d |
| **BisonFi** | `BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi` | USDT sell, USDG sell | **single keypair** | **~11h** |

"Code age" is time since the last redeploy of the program's bytes. "Single keypair" means the
upgrade authority is an on-curve address, so one private key can replace the program at will;
"PDA" means an off-curve address, so a program (multisig or governance) gates upgrades. Determined
by testing each authority against the ed25519 curve equation, not by reputation.

## The problem with allowlisting the single-keypair five

An allowlist entry asserts "we reviewed this program." For five of these, whatever you review can be
replaced by one key immediately afterwards, and the allowlist will not notice because it pins an
address, not code. BisonFi's bytes changed roughly **eleven hours** before this measurement.

That is a different risk from Raydium CLMM or Mercurial, where an upgrade needs a multisig.

## Correction: on the live pair, allowlist breadth is not the constraint

The candidate analysis above sampled Jupiter **without** passing `dexes`. Production passes it,
derived from the allowlist, so the router never sees the venues the allowlist excludes. Re-measured
with the real constraint in place, against the actual production allowlist:

```
dexes now   : GoonFi V2,Whirlpool,ZeroFi
dexes after : GoonFi V2,Raydium CLMM,Whirlpool,ZeroFi
```

| size | current set | +Raydium | unconstrained (all 103 venues) |
| --- | --- | --- | --- |
| $10 buy | 2294 | same | same |
| $25 buy | 5736 | same | same |
| $50 buy | 11473 | same | same |
| $100 buy | 22946 | same | same |
| $10-$100 sell | routes | same to 0.0bps | same to 0.0bps |

**Adding Raydium CLMM gains nothing measurable.** No coverage (every size already routed), no price
(identical output), and unconstrained routing across every venue Jupiter knows produces the same
result. GoonFi V2 is the best execution at every beta size in both directions, so no allowlist can
improve on what the current one already achieves. Raydium CLMM was added anyway as a spare, but it
is not a fix for anything currently broken.

The real exposure this surfaced is **concentration, not breadth**: 100% of live flow goes through
GoonFi V2, whose bytes were redeployed about two days before the canary. Whirlpool and ZeroFi are
already allowlisted as alternates, so the fallback exists; Jupiter simply never needs it. Note also
that ZeroFi, already in the allowlist, is one of the single-keypair-upgradeable venues below.

Seven of the eleven allowlist entries have no Jupiter label (System, ComputeBudget, ATA, SPL Token,
Token-2022, Memo, Jupiter v6), so they constrain nothing at the routing layer and act only as the
post-hoc guard's vocabulary. Only the four venue programs shape `dexes`.

## Recommendation

- **USDC:** nothing needed. Raydium CLMM is applied but measures as a no-op; do not deploy for it.
- **USDT/USDG:** adding the thirteen does not reopen these safely, because the set is still growing
  under the narrowest routing mode and five members are single-key mutable. If they are to reopen,
  the gate needs to change shape rather than lengthen: scope the block to programs that touch the
  taker's accounts, so the multi-hop middle of a route stops mattering. Failing that, pin a small
  venue set and accept the quotes that dead-end.
- Either way, `route_not_reviewed` in the admin failure ranking is now the meter that says how often
  the gate actually bites.
