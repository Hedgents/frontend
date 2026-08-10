# Hedgents closed-beta readiness

The beta registers 15 Solana metal adapters. It executes native Solana USDC into an adapter, and sells that product into canonical Solana USDC, USDT, or USDG, only when the exact-size Jupiter Swap V2 route passes all output and impact guards. Registration is inventory coverage, not a promise of current liquidity. Cross-chain funding is deliberately outside this repository and is supplied as an external Rail SDK dependency.

## Product safety gates

- Every entered size triggers a quote-only check against every registered product for that metal, refreshed every 15 seconds.
- Products that fail routing, output, or price-impact checks are removed from executable selection automatically.
- “Best equivalent route” is only assigned inside a like-for-like product group. Physical metal, trust shares, futures funds, and miners funds are never treated as interchangeable.
- The selected route is rebuilt for the connected Solana wallet, authenticated server-side, and simulated by Solana RPC before a signature is requested.
- The tester must declare a two-letter residence code and attest issuer eligibility before order assembly. The server repeats the check at submission; tokenized securities fail closed outside the operator-approved country allowlist.
- After Jupiter reports success, Hedgents independently verifies the destination-wallet token increase against the authenticated minimum output using Solana RPC.
- A signed result is persisted as Pending before submission. A 30-day domain-separated recovery authorization lets Hedgents recheck finalized onchain settlement without retaining the short-lived execution permission.
- Every API endpoint is rate limited; mutation endpoints also enforce same-origin browser requests and bounded JSON bodies.
- Production new-trade execution fails closed unless `HEDGENTS_EXECUTION_ENABLED=true`. The switch blocks comparison, order assembly, and submission but deliberately leaves finalized settlement recovery available.
- `HEDGENTS_BETA_MAX_USD` caps each closed-beta trade (default $100). Buy input and sell stablecoin output are checked with integer base-unit arithmetic and authenticated again at submission.
- `HEDGENTS_WALLET_REJECTION_MODE=true` is reserved for an unpromoted QA deployment: quotes and wallet prompts work, but submission is rejected before the signed payload is read. It is not a live-execution setting.

## Free operator checks

Quote every registered adapter without a wallet:

```bash
JUPITER_API_KEY=... npm run probe:metals -- 100
```

Attempt to assemble and simulate all 15 buys and all 45 metal → stablecoin exits with public state. The report is expected to fail closed for inventory without current executable liquidity:

```bash
JUPITER_API_KEY=... \
HEDGENTS_SIMULATION_WALLET=... \
HEDGENTS_SOLANA_MAINNET_RPC_URLS=... \
npm run simulate:metals -- 100
```

The matrix uses no private key, requests no signature, and submits no transaction. `HEDGENTS_SIMULATION_WALLET` is optional: when omitted, the harness discovers a sufficiently funded public USDC holder for buy simulation. Sell simulations independently discover a public token holder and use only already-public account state.

## Scarcity workspace closure

- The periodic catalog compiles one canonical research specification for all 99 tracked metal/material cells: eight numerical tightness questions and 91 primary-source event questions.
- Approved online-detector evidence can now be frozen from the admin console into a durable, content-addressed event-market specification. Detector reruns cannot silently mutate that published document.
- Every scarcity wallet action is simulated by the application before the wallet opens. A simulation error blocks signing and includes the useful program logs.
- Signed-but-unconfirmed scarcity submissions are stored locally by schema version, wallet, cluster, and signature. Reloading the terminal automatically rechecks Solana and links unresolved submissions to Explorer.
- A mainnet operator or deployment manifest fails closed unless it declares reviewed multisig control, at least two approvals, a 24-hour-or-longer manual challenge window, and published audit, dispute, and incident-response URLs.
- These manifest checks do not create an onchain optimistic dispute mechanism. Independent review and the final resolver trust-model decision remain external launch gates.

## Beta operations

- Pending, successful, and failed signed attempts are retained locally in the tester’s browser and upserted by authenticated request ID.
- The latest local record can be exported and later imported as a JSON execution receipt. Pending receipts can be reverified at finalized commitment.
- Portfolio accounting uses FIFO basis from independently verified Hedgents fills only. External inventory is marked partial or untracked instead of receiving an invented basis.
- Errors include a stable category and a suggested next action.
- Optional diagnostics are off by default. A tester may opt in from the wallet panel; events include only product ID, metal, amount range, route counts, phase, error code, and a server-hashed execution reference used to deduplicate confirmations. Wallet addresses, transaction signatures, raw request IDs, and exact amounts are excluded.
- Diagnostics currently use deployment logs and incur no additional analytics vendor cost. Add durable storage only when beta volume justifies it.

## Before inviting testers

1. Run `npm test` and `npm run build`.
2. Run the quote probe across all registered adapters and record the currently executable subset.
3. Run `npm run test:e2e` in system Chrome at desktop and mobile widths.
4. Run the zero-spend 60-route simulation matrix; an explicit public beta wallet is optional.
5. Configure two independent server RPC providers, keep the beta cap at $100 or less, and enable the execution switch only for the wallet test window. Configure the approved country allowlist before enabling tokenized-security products. Independent order/recovery secrets and production allowed origins are already enforced and configured.
6. Review every product’s current issuer terms and eligible jurisdictions.
7. Complete [BETA_WALLET_MATRIX.md](./BETA_WALLET_MATRIX.md).
8. Perform one deliberately small mainnet canary only when paid verification is approved.

Emergency pause:

```bash
# Set HEDGENTS_EXECUTION_ENABLED=false in production, then redeploy.
# Pending receipts continue to verify through /api/execution/status.
```

## Honest infrastructure boundary

The built-in rate limiter is best-effort per server instance and intentionally costs nothing. It is sufficient for a small invite-only beta, but not a global distributed abuse-control system. Move counters to a durable shared store before public launch or when beta traffic spans enough instances to make per-instance limits ineffective.
