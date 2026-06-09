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
    version: "v0.5.7",
    date: "2026-06-09",
    headline: "ONyc leverage path live on mainnet — first USDC borrow tx confirmed",
    detail:
      "End-to-end ONyc leverage smoke test on mainnet: $50 USDC → ONyc deposit (Jupiter swap + Kamino deposit) → InitObligationFarmsForReserve(Debt) → BorrowObligationLiquidityV2 at 40% target LTV. v0.5.5–v0.5.7 burned three bugs in sequence: (1) Kamino's ONyc reserve uses Chainlink Data Streams (not Pyth/Scope) so the on-chain market_value_sf doesn't propagate — added a NAV-fallback ($1.11) for borrow sizing; (2) RefreshObligation expected only currently-referenced reserves (1, ONyc deposit) but the bundle passed both ONyc + USDC, triggering 0x1776 InvalidAccountInput — bundle now reads the obligation and passes only existing reserves; (3) the ONyc-market USDC reserve has farm_debt enabled, so the first borrow needs InitObligationFarmsForReserve(mode=1) to create the user's debt-farm state PDA. Position now live: $41 ONyc collateral, $14.75 USDC debt, ~36% LTV, current_apr_bps=1100.",
  },
  {
    version: "v0.5.0",
    date: "2026-06-08",
    headline: "ONyc replaces Multiply — leveraged on-chain reinsurance NAV, USD-denominated, delta-neutral",
    detail:
      "First minor-version bump in the fleet. Multiply (leveraged jitoSOL) is abandoned: its net +1.0 SOL beta failed the USD-yield-vault thesis — you can't pitch a Solana-native USD yield product whose biggest leg is leveraged SOL exposure. ONyc takes its slot. Mechanics: deposit ONyc (OnRe's Bermuda-licensed tokenized reinsurance token) as collateral in Kamino's isolated ONyc market, borrow USDC at a conservative 40% LTV, recycle into more ONyc. Yield is reinsurance premium income (~11% base) amplified by ~1.5-2× leverage. USD-denominated, delta-neutral, uncorrelated to crypto regimes — the portfolio's first RWA leg. The 'build above the protocol' element is a NAV-aware LTV controller that encodes OnRe's monthly Apex Group attestation cadence: dampens alerts on routine 30-80bps NAV steps but escalates on real impairment (5%+ single steps or 3+ consecutive downward streaks). ~5,500 lines of new daemon code, 98 tests pass. The fleet stays at three strategies: stable_yield + hedgedjlp + onyc.",
  },
  {
    version: "v0.4.27",
    date: "2026-06-06",
    headline: "Orchestrator harvest: hedgedjlp PnL realize via full-unwind auto-accept",
    detail:
      "Closes the gap left by v0.4.26: the harvest loop now actually realizes accumulated perp PnL instead of just logging it. New opt-in --auto-allow-full-withdraw flag in hedgedjlp-daemon unlocks auto-accept for WithdrawHedgedJlp{jlp_lamports=u64::MAX} (full-unwind sentinel) from the configured orchestrator. The original 'always manual' policy still applies to partial-size withdraws — only full unwinds get the auto-execute exception. Standard daemon-side gates (sender allowlist, master switch, cooldown) still enforced. Combined with v0.4.26's harvest loop, the orchestrator now: (1) sees PnL > $5 threshold, (2) emits WithdrawHedgedJlp full-unwind, (3) daemon auto-accepts and unwinds, (4) freed USDC redeploys via 60s allocator tick. End-to-end PnL realization in autonomous mode.",
  },
  {
    version: "v0.4.26",
    date: "2026-06-06",
    headline: "Orchestrator harvest loop: per-strategy yield watching every 6h",
    detail:
      "New harvest module in the orchestrator runs alongside the 60s allocator tick at a slower 6h cadence. Three jobs: (1) stable_yield observed only — auto-compounds inside Kamino; (2) leveraged onyc re-leveraged when NAV appreciation drops LTV by >150bps (target 40% restored via AssignOnyc with usdc_lamports=0); (3) hedgedjlp PnL above $5 threshold logged as 'manual harvest recommended'. CLI knobs for cadence, drift threshold, PnL threshold, target LTV. Distinct cooldown keys (harvest_onyc vs allocator's onyc) so both loops can fire independently. JSONL audit log captures every harvest decision. 12 unit tests pin the decision boundaries.",
  },
  {
    version: "v0.4.25",
    date: "2026-06-05",
    headline: "Dashboard: dynamic incidents-resolved counter + combined APR matches strategy card",
    detail:
      "Two dashboard fixes in one ship. (1) `incidents_resolved` in /lifetime was a hand-bumped constant stuck at 18 since the rc-era — replaced with a const-fn that counts release headings in the embedded DEVLOG.md at compile time, so it advances with every ship. (2) /aum's `combined_apr_bps` used live-spot APR while strategy cards display the 24h-mean headline (`apr_24h_bps ?? current_apr_bps`), so the two diverged whenever Kamino moved — today the card showed stable_yield at 5.36% while combined read 3.74% with 100% of funds in stable_yield. Same fallback chain in both places now.",
  },
  {
    version: "v0.4.24",
    date: "2026-06-05",
    headline: "Cap Kamino-SOL-borrow proxy so hedgedjlp net APR survives Kamino spikes",
    detail:
      "Dashboard reported hedgedjlp at 0.51% net APR while JLP fees still yielded 17.70%. The proxy uses Kamino's SOL borrow rate to estimate Jupiter Perps funding; that proxy holds at 4–8% in normal conditions but Kamino's borrow rate hit 22.89% today during a SOL liquidity squeeze. Cap the proxy at 8% so spikes can't poison the estimate. Net APR with cap = 17.70 − 8×0.75 = 11.70%, comfortably above the 6.85% carry hurdle. Proper fix (read custody.funding_rate_state on-chain per open short) is a follow-up rc.",
  },
  {
    version: "v0.4.23",
    date: "2026-06-05",
    headline: "Orchestrator's /strategies fetch timeout raised 15s → 90s",
    detail:
      "After v0.4.22 the unwind→sweep→redeploy chain worked end-to-end and the first $135 deposit landed in stable_yield. Subsequent ticks then failed every cycle: the dashboard's /strategies endpoint makes four sequential RPC calls per strategy and routinely takes 22–60s under Helius load. The orchestrator's fetch_snapshot client was built with a 15s timeout that was always going to lose. Bumped to 90s so ticks complete; the proper fix (parallelise the chain reads with tokio::join!) belongs in a future dashboard PR.",
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
      "Pre-rc14 the orchestrator only emitted envelopes. Now it consumes researcher's PriceMovedBps signals into a market cache; the allocator's cost-benefit gate suppresses rebalance moves when SOL is in a sharp downward window. Closes a real architectural gap — the LITEPAPER's 'execution daemons subscribe to MarketSignal' silently excluded the orchestrator.",
  },
  {
    version: "v0.4.13",
    date: "2026-06-02",
    headline: "Allocator now credits risk reduction in cross-strategy rebalance",
    detail:
      "Pre-rc13 the cost-benefit gate was blind to directional exposure: it refused to move capital between strategies at small APR gaps even when the rebalance materially reduces directional exposure. v0.4.13 adds a one-sided risk-reduction credit so moves toward delta-neutral get scored on apr_gain + risk_gain, not just apr_gain.",
  },
  {
    version: "v0.4.12",
    date: "2026-06-02",
    headline: "Idle wallet SOL counted in AUM (was silently dropped)",
    detail:
      "Pre-rc12 the dashboard only valued the USDC residual; native SOL sitting outside strategies was invisible. The 0.62 SOL of recovered capital that hid here on 2026-06-01 is what motivated the fix. SOL price comes from Jupiter Lite Price API, cached 30s.",
  },
  {
    version: "v0.4.10",
    date: "2026-06-02",
    headline: "Hedgedjlp resize closes over-hedged legs (was: open-only)",
    detail:
      "When JLP value dropped, the hedge previously never resized down — cycles 2 (3.80x) and 5 (3.91x) both ran over-hedged on production. Resize now identifies legs where existing > target and issues partial decrease_position requests symmetrically with the open-side path.",
  },
  {
    version: "v0.4.8",
    date: "2026-06-01",
    headline: "Trailing 24-hour APR as the headline number",
    detail:
      "Strategy cards now lead with the 24-hour mean APR (smoothed against realtime noise) instead of the second-by-second tick. Bitwise USCC reports a single dated yield — Hedgents does the same. Live APR is still shown underneath for transparency.",
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
      "Daemons end-to-end: stable-yield, hedgedjlp, riskwatcher, researcher, orchestrator. Approval queues, libp2p mesh with role-bound keys, dashboard.",
  },
];
