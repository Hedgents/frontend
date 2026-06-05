/**
 * Shipping log surfaced from `fleet/DEVLOG.md`. Hand-curated — one edit
 * per release. The full devlog lives in the repo; the dashboard's home
 * shows only the latest entry while `/devlog` shows the full list.
 */

export interface Ship {
  version: string;
  date: string; // YYYY-MM-DD
  headline: string;
  detail: string;
}

export const SHIPS: Ship[] = [
  {
    version: "v0.4.23",
    date: "2026-06-05",
    headline: "Orchestrator's /strategies fetch timeout raised 15s → 90s",
    detail:
      "After v0.4.22 the unwind→sweep→redeploy chain worked end-to-end and the first $135 deposit landed in stable_yield. Subsequent ticks then failed every cycle: the dashboard's /strategies endpoint makes four sequential RPC calls (multiply, stable_yield, hedgedjlp, rates) and routinely takes 22–60s under Helius load. The orchestrator's fetch_snapshot client was built with a 15s timeout that was always going to lose. Bumped to 90s so ticks complete; the proper fix (parallelise the four chain reads with tokio::join!) belongs in a future dashboard PR.",
  },
  {
    version: "v0.4.21",
    date: "2026-06-04",
    headline: "Multiply unwind sweeps freed SOL → USDC (closes the rc20 loop)",
    detail:
      "rc20 fully drained the leveraged obligation on-chain but left the freed SOL sitting in the wallet, blocking the orchestrator's next-tick hedgedjlp deposit (which expects USDC). rc21 adds a Jupiter SOL→USDC sweep step at the tail of the unwind. Best-effort: any sweep failure downgrades to a warn and reports final_usdc_lamports=0; the structural unwind is already complete and the operator can retry manually.",
  },
  {
    version: "v0.4.19",
    date: "2026-06-04",
    headline: "Multiply unwind retries with smaller delta when Kamino's max_withdraw_value is binding",
    detail:
      "v0.4.17 made the orchestrator's Withdraw{multiply} envelopes actually reach multiply's unwind handler. v0.4.18 fixed the vault validation. v0.4.19 fixes the sizing bug: at low SOL prices the position's headroom shrinks and 16.67% per round exceeds Kamino's max_withdraw_value. The unwind now halves delta and re-sims when WithdrawTooLarge fires, up to 6 attempts per round.",
  },
  {
    version: "v0.4.17",
    date: "2026-06-03",
    headline: "Orchestrator's Withdraw{multiply} now actually deleverages on-chain",
    detail:
      "Pre-rc17 the orchestrator's Withdraw{multiply} emitted AssignMultiply{target_ltv_bps=0} as a workaround. The multiply daemon's leverage handler bailed out at current_ltv >= target_ltv → 'already at or above target; no work to do'. Every rebalance proposal from rc1 through rc16 was silently swallowed. Today's SOL drop made that visible. Fix: emit the real WithdrawMultiply envelope which routes to the existing unwind path.",
  },
  {
    version: "v0.4.16",
    date: "2026-06-03",
    headline: "MarketSignal consumer audit — explicit log per daemon, honest mesh truth table",
    detail:
      "The LITEPAPER claimed execution daemons subscribe to MarketSignal. They do at the delivery layer, but only orchestrator (rc14) actually consumes. rc16 adds an explicit per-MarketSignal log branch in each daemon's dispatch so the operator sees them, plus a docs/mesh-consumers.md truth table documenting reality and the priority-ordered wiring follow-ups.",
  },
  {
    version: "v0.4.15",
    date: "2026-06-03",
    headline: "Riskwatcher classifier functions for previously-stub RiskKinds",
    detail:
      "RiskKind enum has carried OracleStaleness, DeltaDrift, and PerpFundingSpike for months — but classify() only emitted LiquidationDistance. v0.4.15 adds the pure-logic classifier functions for all three, with band boundaries tuned against production telemetry. Wiring each into a real poller follows in rc16+ as per-poller work.",
  },
  {
    version: "v0.4.14",
    date: "2026-06-03",
    headline: "Orchestrator subscribes to researcher's MarketSignals (closes the loop)",
    detail:
      "Pre-rc14 the orchestrator only emitted envelopes. Now it consumes researcher's PriceMovedBps signals into a market cache; the allocator's cost-benefit gate suppresses SOL-sale rebalances when SOL is in a sharp downward move. Closes a real architectural gap — the LITEPAPER's 'execution daemons subscribe to MarketSignal' silently excluded the orchestrator.",
  },
  {
    version: "v0.4.13",
    date: "2026-06-02",
    headline: "Allocator now credits risk reduction in cross-strategy rebalance",
    detail:
      "Pre-rc13 the cost-benefit gate was blind to directional exposure: it would refuse to move capital from multiply (β=1) to hedgedjlp (β=0) at a small APR gap, even though the rebalance materially reduces SOL exposure. v0.4.13 adds a one-sided risk-reduction credit so moves toward delta-neutral get scored on apr_gain + risk_gain, not just apr_gain.",
  },
  {
    version: "v0.4.12",
    date: "2026-06-02",
    headline: "Idle wallet SOL counted in AUM (was silently dropped)",
    detail:
      "Pre-rc12 the dashboard only valued the USDC residual; native SOL sitting outside strategies was invisible. The 0.62 SOL of recovered capital that hid here on 2026-06-01 is what motivated the fix. SOL price comes from Jupiter Lite Price API, cached 30s.",
  },
  {
    version: "v0.4.11",
    date: "2026-06-02",
    headline: "Multiply card shows per-leg APR (jitoSOL yield, SOL borrow cost)",
    detail:
      "Strategy card now reads '$X @ 7.29% − $Y @ 5.52%' instead of just the dollar split. Yield % in green, cost % in amber so the directional sign is readable in one glance. Completes the v0.4.9 collateral/debt decomposition.",
  },
  {
    version: "v0.4.10",
    date: "2026-06-02",
    headline: "Hedgedjlp resize closes over-hedged legs (was: open-only)",
    detail:
      "When JLP value dropped, the hedge previously never resized down — cycles 2 (3.80x) and 5 (3.91x) both ran over-hedged on production. Resize now identifies legs where existing > target and issues partial decrease_position requests symmetrically with the open-side path.",
  },
  {
    version: "v0.4.9",
    date: "2026-06-02",
    headline: "Multiply card shows gross collateral / debt decomposition",
    detail:
      "Strategy card now renders \"$X collateral − $Y debt\" under the net figure for multiply. Answers the recurring 'what is this number made of?' question without re-deriving the position from chain state every time. Inspired by USCC's per-holding allocation table.",
  },
  {
    version: "v0.4.8",
    date: "2026-06-01",
    headline: "Trailing 24-hour APR as the headline number",
    detail:
      "Strategy cards now lead with the 24-hour mean APR (smoothed against realtime noise) instead of the second-by-second tick. Bitwise USCC reports a single dated yield — Hedgents does the same. Live APR is still shown underneath for transparency.",
  },
  {
    version: "v0.4.7",
    date: "2026-06-01",
    headline: "Multiply APR estimate fixed (was using USDC borrow, multiply borrows SOL)",
    detail:
      "Dashboard's multiply APR was swinging to 0 / blank whenever Kamino's USDC borrow rate spiked. Strategy itself was unaffected — only the forward-looking APR estimate. Formula now uses Kamino SOL borrow (stable ~6%) instead of USDC borrow (volatile 4–47%).",
  },
  {
    version: "v0.4.6",
    date: "2026-06-01",
    headline: "rc54 — SOL reserve farm constant updated (Kamino added a farm)",
    detail:
      "Kamino enabled a collateral farm on the SOL reserve after rc49 shipped. The expected_farm_collateral table now matches on-chain reality so the stale-RPC defender stops false-tripping on every SOL reserve load.",
  },
  {
    version: "v0.4.5",
    date: "2026-06-01",
    headline: "rc53 — always sweep idle wallet SOL into the multiply obligation",
    detail:
      "Multiply seed no longer gates on usdc_lamports > 0; any wallet SOL above the fee buffer gets staked into the obligation each tick. Recovered 3.5 SOL of parked capital on the first live run.",
  },
  {
    version: "v0.4.4",
    date: "2026-06-01",
    headline: "rc52 — refresh all obligation reserves before RefreshObligation",
    detail:
      "Existing-position seed previously refreshed only jitoSOL, then RefreshObligation failed (klend 0x1776) because the SOL reserve in the obligation was stale. Now refreshes every reserve the obligation references.",
  },
  {
    version: "v0.4.3",
    date: "2026-06-01",
    headline: "rc47 — existing-position USDC seeding bug fix",
    detail:
      "Allocator's USDC envelope reached multiply but never entered the obligation because the seed path skipped when the obligation already held jitoSOL collateral. Forced top-up when usdc_lamports > 0.",
  },
  {
    version: "v0.4.2",
    date: "2026-05-31",
    headline: "Over-engineering pass — paper-trading + stablefloor-daemon deleted",
    detail:
      "Removed dead paper-trading scaffolding and the unused stablefloor-daemon crate. Smaller surface area, fewer compilation units, no behavior change.",
  },
  {
    version: "v0.4.1",
    date: "2026-05-30",
    headline: "Beta vault tracking — founder seed + per-user shares",
    detail:
      "Mutual-fund-style share accounting; NAV-priced deposits/withdrawals. Admin endpoints behind a shared bearer token for the closed beta.",
  },
  {
    version: "v0.4.0",
    date: "2026-05-17",
    headline: "Orchestrator daemon — autonomous regime-aware allocator",
    detail:
      "New compile-time-isolated daemon. Dispatches Assign/Withdraw envelopes on a tick; per-strategy cooldown + stale-snapshot guard; dry-run → execute promotion path documented.",
  },
  {
    version: "v0.3.3",
    date: "2026-05-16",
    headline: "klend repay account-list fix",
    detail:
      "Multiply unwind round-trip proven on mainnet — position drained 35% → 2.5% LTV across two rounds.",
  },
  {
    version: "v0.3.2",
    date: "2026-05-16",
    headline: "wSOL wrap inserted in unwind bundle",
    detail:
      "CreateATA + system transfer + sync_native bridge between Jito WithdrawSol and klend RepayV2.",
  },
  {
    version: "v0.3.1",
    date: "2026-05-16",
    headline: "Jito WithdrawSol as iterative swap leg",
    detail:
      "Iterative deleverage now closes the loop: withdraw jitoSOL collateral → redeem to SOL → repay USDC borrow.",
  },
  {
    version: "v0.3.0",
    date: "2026-05-16",
    headline: "WithdrawMultiply protocol + iterative unwind",
    detail:
      "Pure round-builder. v2 klend ixns for repay + withdraw_collateral. Approval queue routing.",
  },
  {
    version: "v0.2.9",
    date: "2026-05-16",
    headline: "systemd live target",
    detail:
      "hedgents-live.target with Conflicts= directive — live daemons now survive SSH logout.",
  },
  {
    version: "v0.2.8",
    date: "2026-05-15",
    headline: "Combined APR in dashboard",
    detail:
      "/aum exposes deployed-USD-weighted average APR across live strategies; benchmark widgets now compare fleet-combined APR against T-bill rates.",
  },
  {
    version: "v0.2.7",
    date: "2026-05-15",
    headline: "Riskwatcher leverage-frame fix",
    detail:
      "Jupiter Perps liquidation-distance formula corrected — eliminated 55+ false-positive Critical escalates per day.",
  },
  {
    version: "v0.2.5",
    date: "2026-05-14",
    headline: "Riskwatcher polls Jupiter Perps positions",
    detail:
      "Independent observation of hedgedjlp's short positions; emits position view into the shared registry alongside Kamino obligations.",
  },
  {
    version: "v0.2.4",
    date: "2026-05-13",
    headline: "JLP via Jupiter Swap aggregator",
    detail:
      "Direct add_liquidity_2 path on the JLP pool is closed in production. Buy and withdraw legs now route through Jupiter Swap quote+swap.",
  },
  {
    version: "v0.2.0",
    date: "2026-05-10",
    headline: "Regime-aware allocator",
    detail:
      "Pure decision function: hurdle = stable_yield + risk_premium per strategy. CLI in dry-run and execute modes; audit log to JSONL.",
  },
  {
    version: "v0.1.0",
    date: "2026-04-22",
    headline: "Full fleet on devnet → mainnet bring-up",
    detail:
      "5 daemons end-to-end: stable-yield, multiply, hedgedjlp, riskwatcher, researcher. Approval queues, libp2p mesh with role-bound keys, dashboard.",
  },
];
