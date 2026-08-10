# Hedgents blue-team review

Review date: 2026-08-09

Scope: the private terminal, native Solana metal execution, portfolio and recovery, scarcity intelligence and detector pipeline, resolution evidence, admin operations, durable storage, browser surfaces, and the `scarcity_exchange` Solana program. The colleague-owned stablecoin Rail SDK and its bridge adapters were explicitly excluded and were not modified.

This is a defensive engineering review, not a guarantee of security and not an independent audit. The scarcity program remains blocked from mainnet until the external gates at the end of this document are satisfied.

## Component disposition

| Component | Trust boundary checked | Defensive result |
| --- | --- | --- |
| Invite and administrator access | Code verification, role separation, cookies, redirects, API gates | HMAC sessions are role-bound and expiry-bound; comparisons are timing-safe; production fails closed without secrets/hashes; admin credentials also open the normal terminal; redirects remain same-origin; every private/admin route is gated. |
| Mutation APIs | CSRF, oversized bodies, request identity, abuse | Same-origin browser mutations, JSON-only bounded bodies, trusted Vercel client identity, stable errors, and per-instance rate limits. Public scale still requires a distributed WAF/rate limiter. |
| Jupiter quote and order assembly | Untrusted upstream response, asset substitution, stale routes | Server-pinned mints/decimals/direction/limits; bounded streamed upstream JSON; quote and eligibility checks; last-valid-block-height freshness; failures remove the product from executable selection. |
| Jupiter submission | Transaction substitution and replay | Authorization now commits the exact Solana message digest, fee payer, protected minimum, block-height lifetime, policy, and request. Submission requires the wallet signature and rejects changed messages, changed payer, missing signature, expiry, and stale blockhash. |
| Settlement | False-positive fill reporting | Confirmed/finalized transaction is fetched independently; exact message equality, authenticated wallet, output mint, and minimum token delta are verified before success. |
| Product registry | Wrong mints, equivalence, or chain metadata | Canonical identifiers, token programs, decimals, product class, issuer restrictions, and route grouping are validated. “Best” is never compared across unlike physical, trust, futures, or miners products. Live liquidity remains an external condition. |
| Solana wallet UX | Blind signing, ambiguous failure, cluster mismatch | Every scarcity action is simulated before the wallet opens; review screens show network and values; explicit rejection becomes Failed while RPC uncertainty stays Pending; recovery rechecks historical signatures; cluster-specific RPC configuration prevents devnet/mainnet mixing. |
| EVM wallet UX | Connector ownership and role | EVM connection remains part of the terminal. Cross-chain transport and bridge execution remain the external Rail dependency and were not changed in this pass. |
| Portfolio | Invented fills or basis | Only independently verified Hedgents fills affect accounting; pending/imported receipts are reverified; FIFO basis is explicitly partial when external activity exists; metal and scarcity positions share one portfolio with separate accounting sections. |
| Scarcity catalog | Coverage and misleading precision | All 99 tracked metal/material cells compile into a primary-source-backed numerical or event specification. Market readiness and evidence frequency remain visible; sample data is disabled in production by default. |
| Online detector | SSRF, redirect escape, malicious/large documents | Credential-free HTTPS only, explicit primary-source hostname suffixes, ports rejected, every redirect revalidated, and response streams/content lengths bounded. Detector state and evidence are size-bounded. |
| Data publication | Corruption, overwrite, XSS, unbounded growth | Source and observation schemas are bounded; durable publication fails closed without storage; content-addressed artifacts are served as inert downloads; conditional Blob writes detect conflicts; dataset sizes are capped. |
| Event market compilation | Detector drift after approval | Approved evidence freezes an immutable canonical question/rules document. Later detector runs cannot overwrite the approved specification. |
| Resolution | Fabricated, stale, post-deadline, or mismatched evidence | Resolution is allowed only after `resolveAfter`; source precedence is deterministic; numerical observations must reproduce the reviewed production observation exactly; event evidence must match approved detector evidence and predate the deadline; artifact hash, path, content, and Hedgents origin must agree. |
| Admin console | Wrong operator, account, resolver, or manifest | Admin session required; config/program account ownership, versions, canonical PDAs, current admin/resolver, collateral, fees, market resolver snapshots, mints, vaults, and document commitments are decoded and checked from chain. Actions are disabled without the matching reviewed wallet/manifests/evidence. |
| Durable indexes and analytics | Lost updates, silent resets, excessive scans | Invite, market, and detector indexes use ETag conditional writes/retries; malformed invite indexes fail closed; data writes reject conflicts; analytics scans are capped and disclose truncation. |
| Browser and mobile | Stored XSS, framing, inline script injection, WebKit failure | Per-request CSP script nonces, no framing/objects, restrictive API CSP, inert evidence downloads, HSTS, permissions limits, and no indexing. The HTTP-development CSP no longer upgrades WebKit assets to unavailable HTTPS. Desktop Chrome, Pixel Chrome, and iPhone WebKit flows are covered. |
| Solana initialization | First-initializer takeover | `initialize_config` requires the executable program and its ProgramData account and verifies that the signer is the program upgrade authority. An attacker-first initialization is rejected in localnet. |
| Solana collateral and accounting | Wrong mint shape, unauthorized value movement | Collateral mint must have six decimals; typed Anchor accounts, owners, signers, token programs, canonical PDAs, checked arithmetic, vault authorities, and snapshotted fees/resolvers constrain every instruction. |
| Solana orders and lifecycle | Overfill, unauthorized cancel/fill/resolve/redeem | Adversarial localnet covers asks, bids, partial fills, overfill rejection, cancel, authorized rotation, premature resolution rejection, winning/losing redemption, and invalid payouts. |
| Program governance | Upgrade, resolver, pause, dispute | Mainnet manifest requires canonical USDC, multisig threshold of at least two, audit/dispute/incident URLs, and a manual challenge window of at least 24 hours. Pause is a risk-growth circuit breaker, not a global freeze. The resolver/dispute trust model remains an external mainnet gate. |
| Dependencies | Known advisories and build-chain drift | Frontend production dependency audit reports zero known vulnerabilities. Rust audit reports no known vulnerability, with three framework-transitive maintenance warnings recorded below. |

## Material findings closed in this pass

1. **Critical — signable transaction was not cryptographically bound to the authorization.** The order authorization now commits the exact message digest and last valid block height. Execute and settlement both reproduce and compare that message.
2. **Critical — first caller could initialize the scarcity config.** Initialization now proves the signer is the deployed program's upgrade authority.
3. **High — resolution evidence could be structurally valid without reproducing reviewed source state.** Numerical and event observations now require an exact committed evidence match and content-addressed artifact verification.
4. **High — detector fetches could follow an unsafe redirect or consume an unbounded response.** Source hosts, protocols, ports, redirects, and bytes are now constrained.
5. **High — stored source artifacts could become active browser content.** Artifact responses are attachments with inert content types, `nosniff`, and a sandboxed `default-src 'none'` CSP.
6. **High — config and market UI trusted manifest addresses without complete chain relationship checks.** Account decoders now validate ownership, executable state, version, canonical PDA relationships, roles, collateral, fees, resolver snapshots, and commitments.
7. **Medium — pending wallet submissions could be shown as failed after an RPC timeout.** Only explicit onchain rejection becomes Failed; uncertainty stays recoverable Pending.
8. **Medium — devnet and mainnet RPC fallbacks could cross when generic variables were reused.** Execution, scarcity, wallet, and simulation paths now select cluster-specific variables and only accept a generic fallback for the configured cluster.
9. **Medium — concurrent Blob writers could silently lose index updates.** Conditional writes and retry/conflict handling now cover the mutable indexes and dataset.
10. **Medium — CSP broke the terminal shell in iPhone WebKit over local HTTP.** `upgrade-insecure-requests` is production-only; the phone browser matrix now renders the full terminal.
11. **Medium — external JSON/RPC responses were parsed without byte limits in several routes.** Jupiter, Pyth, token-directory, and Solana RPC reads now use bounded streamed parsing.
12. **Low — invalid-market payout and pause behavior were easy to misunderstand.** UI and security documentation now state the half-collateral rule, odd-unit rounding, and risk-growth pause semantics.

## Verification evidence

- TypeScript unit suite: 125 tests passed.
- Solana adversarial localnet: complete lifecycle passed with `SCARCITY_LOCALNET_E2E_OK`.
- Anchor build and generated IDL/type synchronization: passed.
- Frontend production dependency audit: zero known vulnerabilities.
- Rust audit: no known vulnerability; maintenance warnings are recorded below.
- Free Jupiter snapshot at 2026-08-09 15:51 UTC: 15 adapters recognized; four $100 buy routes passed the 1% impact gate (`PAXG`, `GOLD`, `XAUm`, `GLDx`), and all 12 corresponding exits to USDC/USDT/USDG passed. Other inventory was either explicitly not tradable or failed the impact guard. The UI correctly removes those routes from executable selection; adapter registration is now labeled separately from live execution.
- Browser matrix: 30/30 terminal and scarcity flows passed in desktop Chrome, Pixel-class mobile Chrome, and iPhone 14 WebKit. Security-header assertions are included in the matrix.
- Next.js production build and strict TypeScript compilation passed. Deployment `dpl_Co4yieaJx2iJAsubVLS9jnTHkbN5` reached READY and was aliased to `https://terminal.hedgents.com`; the live gate redirects unauthenticated users, the access page returns 200 for desktop and iPhone user agents with a nonce CSP, private APIs return 401 without a session, and the initial error-log scan was clean.

## Residual launch gates

These items cannot be honestly closed by repository code alone:

1. Commission an independent Solana program audit before accepting public mainnet capital.
2. Align and pin the Anchor CLI with the `0.31.1` crate line, create a reproducible build, and verify deployed bytecode.
3. Move upgrade authority, admin, resolver, and fee authority to reviewed Squads/multisig accounts and rehearse rotation/recovery.
4. Publish and operationally enforce the dispute, incident-response, and at-least-24-hour resolution challenge process; decide whether an onchain optimistic challenge is required.
5. Complete current issuer and jurisdiction review for every tokenized product. Code allowlists are not legal approval.
6. Add distributed edge rate limiting/WAF controls before opening the invite gate broadly.
7. Use independent, monitored Solana RPC providers and indexed account infrastructure before production volume.
8. Complete the real wallet-extension matrix and deliberately small paid mainnet canaries only after explicit approval.
9. Upgrade the Solana/Anchor framework line when practical to remove unmaintained transitive `bincode 1.3.3` and `libsecp256k1 0.6.0`; continue monitoring the conditional `rand 0.7.3` custom-logger advisory.
10. Have the Rail SDK owner perform and publish its own bridge-adapter, dependency, recovery, and mainnet-canary review. Hedgents should consume a pinned reviewed release; the SDK was intentionally outside this pass.

## Release rule

The terminal may remain an invite-only, fail-closed beta when the automated gates pass. Do not represent the scarcity exchange as mainnet-ready, and do not enable its value-moving actions on mainnet, until every applicable external gate above has documented evidence.
