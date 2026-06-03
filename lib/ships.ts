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
