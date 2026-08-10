# Hedgents Terminal security boundary

## Implemented controls

- Canonical product and settlement mints, decimals, token programs, direction, amounts, and price-impact limits are pinned server-side.
- Every signable Jupiter transaction is simulated before it reaches the wallet.
- A short-lived HMAC authorization binds the request, taker, assets, protected minimum, eligibility policy, exact serialized transaction message digest, last valid block height, and expiry. Submission rejects a changed fee payer, changed message, missing wallet signature, or expired blockhash.
- A separate domain and preferably separate secret sign 30-day recovery receipts; recovery evidence cannot submit an order.
- Eligibility is checked at quote construction and again immediately before submission.
- Settlement is independently verified against the authenticated wallet, exact authorized transaction message, output mint, and minimum amount using confirmed/finalized Solana transaction balances.
- Server RPC calls fail over across configured endpoints.
- API endpoints apply per-IP, per-instance limits. Mutations validate browser origin, content type, and actual decoded body size.
- Browser security headers use a per-request script nonce, deny framing and objects, isolate API and evidence responses, disable unneeded camera, microphone, geolocation, and payment permissions, and serve stored source material as inert downloadable text.
- Diagnostic telemetry is opt-in and excludes wallet addresses, signatures, and exact amounts.
- Scarcity outcome issuance is fully collateralized by the configured six-decimal settlement mint.
- Scarcity bids and asks use program-owned escrow; fee rates and recipients are snapshotted per order.
- Scarcity market accounts commit immutable question and rule hashes and snapshot their resolver at creation.
- Resolution evidence and physical-market source artifacts are persisted by content hash before the corresponding operator transaction or production dataset update is enabled.
- Scarcity production data fails closed when durable private storage is absent; sample data remains explicitly labeled and disabled in production by default.
- Approved detector candidates persist as immutable reviewed market specifications; later detector runs cannot overwrite their canonical question or rules.
- Detector network access is restricted to credential-free HTTPS requests on an explicit primary-source host allowlist. Redirects are revalidated and response bodies are streamed into bounded buffers.
- Scarcity wallet actions receive an application-controlled RPC simulation before wallet approval, and signed-pending signatures remain recoverable across reloads.
- Scarcity config initialization requires the deployed program's upgrade authority, collateral is restricted onchain to six decimals, and frontend decoding verifies owners, account versions, config relationships, resolver snapshots, collateral, fees, and canonical PDAs.
- Mainnet scarcity manifests fail closed without canonical Solana USDC, declared multisig approvals, and published audit, dispute, incident-response, and manual challenge-window commitments.
- Durable invite, market, and detector indexes use conditional Blob writes; bounded datasets and analytics scans prevent silent unbounded growth. Dataset publication fails on a concurrent conflicting write.
- Beta cookies carry a durable invite grant/version and expire within 12 hours. Proxy strips caller-supplied internal proofs and mints a short-lived request-bound attestation that protected handlers independently verify. Real-funds order and submission boundaries recheck the uncached grant; read-only traffic uses the private Blob CDN for at most 60 seconds. Revocation blocks new trades immediately and propagates through read-only access within one minute.
- Immediately before Jupiter submission, Hedgents writes an immutable private intent keyed by an HMAC of the authenticated Solana signature and bound to the transaction/guard digests and block-height expiry. Duplicate intent fails closed without another venue call; storage uncertainty never becomes a retry. Bounded post-response and recovery observations are best effort, integrity-HMACed, and exclude raw signatures, wallet addresses, exact amounts, signed transactions, IP/location, and raw request/session identifiers.

## Secrets

Production requires independent random `HEDGENTS_ORDER_SIGNING_SECRET`, `HEDGENTS_RECOVERY_SIGNING_SECRET`, and `HEDGENTS_EXECUTION_AUDIT_SECRET` values. `JUPITER_API_KEY` is never a production signing fallback. Rotate a signing secret only after accepting that outstanding tokens signed by the old value will stop validating; rotating the audit secret also makes prior record-integrity HMACs unverifiable unless the old key is retained offline.

## Deliberate closed-beta limitations

- Rate-limit counters live in each server instance. They are not a substitute for distributed WAF/rate-limit storage at public scale.
- Detailed execution history is local-first. The server audit ledger records a deliberately minimal intent and bounded status observations, not wallet addresses, exact amounts, or portable recovery credentials. Signed recovery receipts plus Solana remain the settlement source of truth; every non-failed record loaded or imported is downgraded to Pending and reverified before it can affect accounting. Users must export receipts before clearing site data.
- FIFO cost basis is a convenience calculation from verified Hedgents fills, not tax advice. External transfers and trades reduce history coverage.
- Wallet-extension behavior and paid mainnet settlement require the manual canary matrix.
- Issuer/jurisdiction approval and an independent security review remain external gates before public launch.
- The scarcity program is locally exercised but not independently audited or deployed. Mainnet configuration now requires a declared multisig and manual challenge process, but the program still lacks an onchain optimistic dispute instruction; the independent audit and final trust-model decision remain mandatory before public capital is accepted.
- Public RPC `getProgramAccounts` scans are acceptable for a closed beta but need indexed/dedicated infrastructure at scale.
- Scarcity data publication detects a concurrent write and fails instead of overwriting it; the operator must retry after reviewing the newer version. This is safe but not yet a collaborative merge workflow.
- Program pause blocks new risk creation (market creation, complete-set minting, and new orders), while merge, cancel, fill of already-open orders, resolution, and redemption remain available. This is a risk-growth circuit breaker, not a global emergency freeze.
- The Rust dependency audit reports no known vulnerabilities, but the Solana/Anchor dependency tree still contains unmaintained `bincode 1.3.3` and `libsecp256k1 0.6.0`, plus the conditional `rand 0.7.3` custom-logger advisory. Hedgents does not invoke that logger path; framework upgrades remain a pre-mainnet maintenance gate.
- The installed Anchor CLI is `0.30.1` while program crates are pinned to `0.31.1`. Builds and adversarial tests pass, but the toolchain must be aligned and pinned for reproducible mainnet bytecode.

Report a suspected vulnerability privately to the project operator. Do not include private keys, seed phrases, or funded-wallet credentials in a report.
