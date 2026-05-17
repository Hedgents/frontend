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
