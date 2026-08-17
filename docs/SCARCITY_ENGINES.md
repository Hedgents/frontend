# The two scarcity engines

There are **two** scarcity calculations in this repo. They share a word and nothing else. Confusing
them produces a badly wrong read of the product, in the pessimistic direction, because the general
engine currently publishes almost nothing while the lithium engine works.

Read this before answering any question about "the scarcity engine", what it scores, or whether it
is ready.

| | General engine | Lithium tightness engine |
|---|---|---|
| Code | `lib/scarcity/engine.ts`, `methodology.ts` | `lib/scarcity/lithium-tightness.ts` |
| Version constant | `SCARCITY_METHODOLOGY_VERSION` | `LITHIUM_TIGHTNESS_VERSION` |
| Inputs | 11 metrics, 2 dimensions | 1 parameter |
| Source | USGS Mineral Commodity Summaries, annual | GFEX daily quotations, free and unauthenticated |
| Cadence | yearly | every trading day |
| Coverage | 50 metals | lithium only |
| Settles a market? | no | yes, the 41-bucket curve rounds |

The name collision is real and unfixed: the general engine has a **dimension** called
`market-tightness`, and the lithium engine computes a **score** also called tightness. They are
unrelated numbers with unrelated methodologies. A curve market that says "tightness" means the
lithium one.

## The general engine publishes almost nothing, and that is expected

Measured 2026-08-17 by running `calculateScarcitySnapshot` over
`BUNDLED_USGS_SCARCITY_DATASET` for all 50 metals:

- `market-tightness`: **0 of 50 published**. Coverage is 0.15 against a 0.50 floor for every metal,
  because the USGS baseline supplies only `supply-growth-yoy-pct` (weight 0.15) out of that
  dimension's five metrics.
- `structural-scarcity`: **11 of 50 published**, every one at coverage exactly 0.40, which is the
  floor, and every one graded `insufficient`.
- The 11 published scores span 47.5 to 60.7 (cobalt 60.7, lead 56.9, zinc 55.8, silver 54.3, iron
  51.1, molybdenum 50.8, vanadium 50.3, gold 50.2, manganese 50.0, copper 49.1, lithium 47.5).
  They are compressed into that band because 60% of the dimension weight is neutral-filled at
  `NEUTRAL_FILL_SCORE = 50`.

This is the coverage floors working as designed, not a bug. An annual official dataset genuinely
cannot support a tightness reading, and the engine declines rather than inventing one. Treat the
general engine as slow structural context. It is not a trading signal and it does not settle
anything.

Reproduce with a throwaway script calling `calculateScarcitySnapshot(metal, BUNDLED_USGS_SCARCITY_DATASET, asOf)`.
Note the export is `calculateScarcitySnapshot`, not `buildScarcitySnapshot`.

## The lithium engine works

One parameter: the annualised front-to-third settlement slope of the GFEX lithium carbonate curve.
Backwardation means the physical market is paying up for metal now. It is scale-free, so a position
on it is a bet on physical tightness rather than on price, which is an instrument that does not
otherwise exist.

Measured 2026-08-17 over the cached GFEX history in `.scarcity-cache/gfex-lc/`:

- 653 trading days parsed, 2023-12-01 through 2026-08-12.
- **651 scored, 2 null.** Both nulls are the trailing-median warmup at the very start of the series.
- Observed range 1.3 to 97.6, so the full scale is used.
- Latest reading 2026-08-12: **55.3**, slope +3.15% annualised, front 2609, third 2611.
- 20 trading days earlier: 50.0. 60 trading days earlier: 36.8. Lithium tightened steadily through
  that window, from contango through flat into mild backwardation.
- The front contract rolled 2608 to 2609 on 2026-08-05 with no flip, which is the hysteresis rule
  (`LIQUIDITY_ENTRY` / `LIQUIDITY_EXIT`) doing its job.

Two of the three originally specced parameters were **killed by measurement**, and that record is
one of the more credible artifacts in the project. GFEX force-deregisters every lithium warrant
registered on or before the last trading day of March, July and November. The warrant total hit
literally zero on 2024-03-29 and 2024-07-31 and rebuilt within twenty trading days, the same metal
re-papered. Warrant momentum read those wipes as the most extreme tightening in the sample, and
removing the 21 days after each wipe cut the composite's forward correlation with price from +0.282
to +0.066. Cancellation pressure could not be cleaned either. Both were dropped. The warrant series
is still published as context.

## What is actually missing

Not the calculation. The wiring.

1. **`computeLithiumTightness` has no consumer outside `lithium-tightness.test.ts`.** The market
   document side is wired (`compileLithiumRound` is used by `app/page.tsx` and
   `lib/scarcity-deployment.ts`), but nothing in the running system turns the cached GFEX files into
   a score. Getting a current reading requires writing a script.
2. **No scheduled ingest.** `scripts/ingest-gfex-lithium.ts` is manual and the cache ends
   2026-08-12. `vercel.json` schedules only `/api/cron/scarcity-detector`, which feeds the general
   engine, not this one.
3. **Nothing displayed.** A trader looking at an open round cannot see the current score, its
   history, the live front and third contracts, or why a day went null.

The `2026-09` round in `LITHIUM_ROUNDS` locks 2026-09-10 and observes 2026-09-17. It cannot settle
from a feed that stopped updating, so the ingest schedule is the item with a real deadline on it.

## How to talk about this

Lead with lithium. It is daily, it uses the full scale, it has a live trend, and anyone holding the
committed metric document can reproduce the settlement number from a free public endpoint with no
license and no data history.

Do not lead with the general engine, and do not describe the product as "not working" because the
general engine returns nulls. Those nulls are the design. The honest summary is: one metal has a
working daily tightness signal that is not yet wired to a display or a schedule, and 50 metals have
annual structural context that mostly declines to publish.
