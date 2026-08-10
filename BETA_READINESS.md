# Hedgents closed-beta readiness

The beta registers 15 Solana metal adapters. It executes native Solana USDC into an adapter, and sells that product into canonical Solana USDC, USDT, or USDG, only when the exact-size Jupiter Swap V2 route passes all output and impact guards. Registration is inventory coverage, not a promise of current liquidity. Cross-chain transport remains an external Rail SDK responsibility; the terminal imports that SDK but starts new Rail funding only behind a separate, default-off feature flag.

## Product safety gates

- Every entered size triggers a quote-only check against every registered product for that metal, refreshed every 15 seconds.
- Products that fail routing, output, or price-impact checks are removed from executable selection automatically.
- “Best equivalent route” is only assigned inside a like-for-like product group. Physical metal, trust shares, futures funds, and miners funds are never treated as interchangeable.
- The selected route excludes JupiterZ/RFQ, requires exactly one writable signer (the taker/fee payer), and supports legacy and v0 messages with deterministically resolved lookup-table accounts.
- Before a signature is requested, a confirmed Solana simulation must return logs, fees, pre/post lamport and token balances, loaded addresses, and inner instructions. Missing or malformed accounting fails closed.
- The semantic guard requires the taker's aggregate input-token debit to equal the authorized amount exactly, output credit to meet the authenticated minimum, and every unrelated taker-owned mint delta to be non-negative. Only classic SPL Token and Token-2022 balance records are accepted.
- The guard rejects token burn instructions; dangerous approvals, authority changes, freezes, thaws, or closes against pre-existing taker accounts; arbitrary System transfers from the taker; and assign/allocate mutations of the taker wallet. Both parsed and compiled inner-instruction RPC shapes are inspected.
- `HEDGENTS_MAX_SOL_DEBIT_LAMPORTS` is mandatory and caps the taker's exact net SOL debit (network fee and any rent included). The initial example is `10000000` (0.01 SOL); use the lowest value that passes reviewed routes.
- Immediately before Jupiter submission, Hedgents signature-verifies and re-simulates the exact signed transaction at confirmed commitment. The new semantic report must match the authenticated report's digest, exact SOL debit, exact fee, and program fingerprint; Jupiter is never called after a guard failure.
- Production requires `HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST`. Populate it only with lowercase SHA-256 fingerprints emitted by reviewed, passing zero-spend matrix routes. Any new program set fails closed until reviewed.
- The tester must declare a two-letter residence code and attest issuer eligibility before order assembly. The server repeats the check at submission; tokenized securities fail closed outside the operator-approved country allowlist.
- After Jupiter reports success, Hedgents independently verifies the destination-wallet token increase against the authenticated minimum output using Solana RPC.
- A signed result is persisted as Pending before submission. A 30-day domain-separated recovery authorization lets Hedgents recheck finalized onchain settlement without retaining the short-lived execution permission.
- Every API endpoint is rate limited; mutation endpoints also enforce same-origin browser requests and bounded JSON bodies.
- Production beta access uses 12-hour sessions bound to an individually revocable private invite grant. Every protected request rechecks that grant; the legacy shared `HEDGENTS_INVITE_CODE_HASH` is a local-development convenience and is ignored in production.
- Production new-trade execution fails closed unless `HEDGENTS_EXECUTION_ENABLED=true`. The switch blocks comparison, order assembly, and submission but deliberately leaves finalized settlement recovery available.
- Production also fails closed unless `HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST` contains only registered, comma-separated product IDs. Start with `gold-paxg`; non-allowlisted products remain visible for read-only discovery but never reach Jupiter comparison, order assembly, or submission.
- `HEDGENTS_BETA_MAX_USD` caps each closed-beta trade (default $100). Buy input and sell stablecoin output are checked with integer base-unit arithmetic and authenticated again at submission.
- `HEDGENTS_WALLET_REJECTION_MODE=true` is reserved for an unpromoted QA deployment: quotes and wallet prompts work, but submission is rejected before the signed payload is read. It is not a live-execution setting.
- `HEDGENTS_RAIL_FUNDING_ENABLED=true` separately exposes terminal-initiated Ethereum/Base USDC funding. It defaults off and must remain false for the first Solana-USDC beta. Turning it off blocks new Rail quotes and wallet requests without blocking verification of an already-broadcast CCTP source burn. EVM wallet connection remains a Hedgents terminal feature either way.

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
HEDGENTS_MAX_SOL_DEBIT_LAMPORTS=10000000 \
npm run simulate:metals -- 100
```

The matrix uses no private key, requests no signature, and submits no transaction. It runs the production semantic guard, excludes JupiterZ, and prints `reviewedProgramFingerprintCandidates`; do not copy a fingerprint into production until the associated routes and program IDs are reviewed. `HEDGENTS_SIMULATION_WALLET` is optional: when omitted, the harness discovers a sufficiently funded public USDC holder for buy simulation. Sell simulations independently discover a public token holder and use only already-public account state.

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
5. Configure private Blob storage, sign in as administrator, and generate at least one durable invite grant before releasing the access migration. Old beta cookies have no grant identity and will be rejected; existing administrator sessions remain valid.
6. Configure two independent server RPC providers, set `HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST=gold-paxg`, set the lowest reviewed `HEDGENTS_MAX_SOL_DEBIT_LAMPORTS`, and populate `HEDGENTS_SOLANA_PROGRAM_FINGERPRINT_ALLOWLIST` only from inspected passing routes. Keep `HEDGENTS_RAIL_FUNDING_ENABLED=false`, keep the beta cap at $100 or less, and enable the execution switch only for the wallet test window. Add products or fingerprints only after their own canary and eligibility review. Configure the approved country allowlist before enabling tokenized-security products. Independent order/recovery secrets and production allowed origins are already enforced and configured.
7. Review every product’s current issuer terms and eligible jurisdictions.
8. Complete [BETA_WALLET_MATRIX.md](./BETA_WALLET_MATRIX.md).
9. Perform one deliberately small mainnet canary only when paid verification is approved.

Emergency pause:

```bash
# Set HEDGENTS_EXECUTION_ENABLED=false in production, then redeploy.
# Pending receipts continue to verify through /api/execution/status.
# Set HEDGENTS_RAIL_FUNDING_ENABLED=false to stop new terminal Rail transfers.
# A source burn already stored in the browser can still resume delivery verification.
```

## Honest infrastructure boundary

The built-in rate limiter is best-effort per server instance and intentionally costs nothing. It is sufficient for a small invite-only beta, but not a global distributed abuse-control system. Move counters to a durable shared store before public launch or when beta traffic spans enough instances to make per-instance limits ineffective.

The semantic guard is intentionally strict, not an onchain spending-limit program. It proves what both simulations report for the exact signed message and blocks known wallet-mutation primitives, but simulation is not finality: account state can move between simulation and landing, RPC providers can fail, and an upgradeable allowed program can change behavior. Keep venue/program review, tiny paid canaries, independent settlement verification, and the execution pause as separate launch gates.

See [CLOSED_BETA_INCIDENT_RUNBOOK.md](./CLOSED_BETA_INCIDENT_RUNBOOK.md) for invite revocation, access migration, execution pause, and receipt recovery.
