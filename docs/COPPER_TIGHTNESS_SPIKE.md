# Copper tightness spike — kill test results (2026-08-20)

Follows `SCARCITY_INDEX_SPEC.md` §10 and build-order step 3 (kill test before
building). Run by `scripts/copper-tightness-killtest.ts` (raw per-contract
mirror data cached under `.scarcity-cache/sina-cu/` with SHA-256 digests).

## Verdict

| Gate | Result | Detail |
|---|---|---|
| **Dispersion** | **PASS — on all three base metals** | Copper 43.5% triple share (2020→2026 full window; 46.6% on the 2022→2026 first run), aluminium 39.9%, zinc 48.9%. 24–26 of 41 buckets occupied everywhere. The parimutuel is viable on each. |
| **Lead** | **Association is real but coincident, not predictive** | See the full-window + pooled analysis below. **No predictive claim in product or marketing** — unchanged. |
| **Settlement source** | **BLOCKED (open problem)** | See below. |

## Full-window and pooled lead analysis (2026-08-21 follow-up)

Question: does more data make the lead test significant? The Sina mirror serves
contracts **listed from 2019-01 onward** (earlier months return null), and since
2019's true front months are therefore missing, the honest analysis window is
**2020-01 → 2026-08** (1,605 trading days per metal).

**Single metal, full window (copper):** 5d forward r=+0.101 (z=1.78, still not
significant) while the backward control *rose* to r=+0.092 (z=1.63); the 20d
forward sign flipped negative. More single-metal data did not create a lead —
it weakened the forward-vs-backward separation.

**Pooled cross-metals (cu+al+zn, n=945 at 5d — the spec test #4 "broad enough"
route to power):**

| horizon | forward r (z) | backward r (z) | reading |
|---|---|---|---|
| 5d | **+0.075 (+2.31)** ✓ | **+0.078 (+2.41)** ✓ | significant both ways — symmetric |
| 10d | +0.086 (+1.87) | **+0.096 (+2.09)** ✓ | backward dominates |
| 20d | +0.020 (+0.30) | +0.032 (+0.49) | nothing |

The pooled power resolves the question, and the answer is that the association
is **symmetric around the observation**: score changes co-move with price
changes behind and ahead of them at equal strength. That is the signature of a
**coincident state measure** (term structure steepens while the price moves),
not a leading one. Forward never dominates backward at any horizon.

**Power math for reference:** z ≈ atanh(r)·√(n−3). At copper's r≈0.10, single-metal
5d significance needs n≈420 non-overlapping samples ≈ 8.4 years (beyond the
mirror's 6.6-year honest window); 20d needs ~33 years. Data volume alone cannot
get there — only pooling (done: resolves to coincident) or a different question
(regime-conditioned, level-vs-change) could, and each extra variant is another
look at the same data. The repo's confirmatory instrument for a predictive
claim, if one is ever pursued, is the blind placebo-randomized event study
(`lithium-event-study.ts` pattern): direction-committed before looking.

**Product consequence:** none for the curve markets — they settle on the score,
and dispersion (strong pass on all three metals) is the viability gate. The
no-predictive-claims copy shipped 2026-08-20 remains exactly right, and now
extends to aluminium and zinc.

Per-metal calibration on the full window: copper anchor ±0.19, gates entry
{OI>13,387, vol>9,372}; aluminium anchor ±0.23; zinc anchor ±0.32. Sample files
for re-pooling: `.scarcity-cache/lead-samples-{cu,al,zn}.json`.

## Measured calibration (2022-01-04 → 2026-08-19, 1120 trading days)

- Liquidity gates (from front-3 OI/volume P10): entry {OI > 14,145, vol > 7,587},
  exit {OI > 7,072, vol > 3,793}. Copper's scale is ~3× lithium's gates.
- Raw slope (front-to-third annualised): P2 −4.3%, median +0.3%, P98 +14.6%.
- Anchor table: **±0.21** symmetric (covers P0.5–P99.5; measured, not chosen —
  the lithium ±0.30 discipline applied to copper's own range).

## The settlement-source problem

The spike's original target — direct programmatic access to official SHFE daily
data (`shfe.com.cn/data/dailydata/kx/kx{date}.dat`) — is **blocked by a SafeLine
WAF bot challenge** (JS/slider captcha; `safeline_bot_challenge` cookie; plain
HTTP 307s; alternate hosts dead). Tested 2026-08-20 from this network.

The kill test therefore ran on the **Sina public kline mirror** of SHFE copper
settlements (per-contract `s`/`p`/`v` fields, free, unauthenticated). That is
**research/calibration grade, NOT a settlement source**. Per the spec's own
rule — "a settlement source that can go dark mid-market is not a settlement
source" — the copper engine must not ship until one of these resolves:

1. **Geo retry**: the SafeLine wall may be IP/geo-based. Retry the endpoint from
   the Hetzner box (which already runs the pulse scheduling) before concluding
   it is universal.
2. **Operator-archived ingest**: a human solves the captcha in a browser once
   per trading day and archives the official file (write-once, digested). A
   third party can still verify against shfe.com.cn with the same friction.
   Operationally heavier; a policy decision, not an engineering one.
3. **Wait** for SHFE to re-expose a clean endpoint.

GFEX (the lithium fetcher's exchange) is unaffected. GFEX platinum/palladium
remain too young (listed 2025-11-27; defer to 2027 per the spec).

## If the source unblocks, the build is mechanical

`shfe-cu` fetcher → write-once store → cron → `copper-tightness` index (same
A1 shape, the calibration above frozen into `metricHash`) → round compiler
(`copper-tightness-{round}-curve-v1`), all off the lithium template
(`gfex-lithium.ts` / `lithium-store.ts` / `lithium-tightness.ts` /
`lithium-market.ts`).
