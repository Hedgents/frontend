# Closed-beta wallet verification matrix

This is the final human wallet-extension gate. It deliberately does not automate extension approvals or submit paid transactions.

Run rejection checks only on an unpromoted, access-protected deployment with `HEDGENTS_WALLET_REJECTION_MODE=true`. The mode permits realistic quote construction and wallet prompts while the server rejects `/api/execution/execute` before reading or broadcasting a signed payload. Never enable it on the promoted terminal.

## Zero-spend checks

The current invited-beta wallet scope is Phantom. Solflare and Backpack are deferred until the operator expands the matrix.

1. Connect and disconnect the Solana wallet.
2. Confirm the terminal displays the correct shortened address and never requests a signature on connect.
3. Open one physical-metal order, one xStocks order, and one Ondo order.
4. Confirm country/issuer eligibility stops the route before order assembly when evidence is incomplete or restricted.
5. Build a quote and inspect the wallet transaction. In rejection-only QA, approving must stop locally with **zero** `/api/execution/execute` requests, no order receipt, and no explorer link. Rejecting must also produce no signature or submission record.
6. Export a receipt, clear only the site's local storage, import the receipt, and verify it returns to Orders.

## Paid canary gate

Only after an operator explicitly approves spend:

- Use the smallest adapter-permitted amount and a dedicated canary wallet.
- Test one USDC → metal buy and the corresponding metal → USDC sale first.
- Expand to USDT and USDG exits only after the USDC settlement receipt is independently verified.
- Never retry an ambiguous signed result. Import or retain its recovery receipt and use **Verify** until Solana reports a finalized outcome.
- Record product, wallet, quote time, signature, protected minimum, received amount, and issuer-policy evidence.

Passing this matrix is an operational approval, not a substitute for issuer/legal review or an external security audit.

## Run log — 2026-08-10

Safety setup:

- Live `terminal.hedgents.com` remained on execution-paused deployment `dpl_D4zU3HLwQJgfD1vDzpsbHKXyDyEu` throughout the wallet QA run.
- On the first isolated candidate (`dpl_H8q9XDHEf85cJ4Hd6He3NTncFpp8`), Phantom approved a $10 PAXG transaction. The signature was created locally, the sole execute request returned `503` before body parsing/Jupiter, and two independent Solana RPCs found no transaction. No funds moved.
- That run exposed a UI lifecycle bug: the client persisted a local signature as a real Pending submission before the server response. The client, server response contract, recovery state, timeline, and analytics were corrected.
- The corrected, unaliased candidate `dpl_CZwuk5qv8QBnshkWLw5qf8mCdh8m` inherited production credentials but kept a $10 cap and rejection-only mode.
- Phantom connected, a live PAXG quote was assembled and simulated, and wallet approval returned: “signed locally, intentionally discarded, and never submitted.”
- Orders remained empty. Vercel recorded one `POST /api/execution/order` (`200`) and zero `/api/execution/execute` requests.
- The full unit suite passed (`143/143`) and the production build passed.
- The reviewed build `dpl_A4hj9jGoM49Xp2BSG5P9tEcsubHE` was then promoted to `terminal.hedgents.com` with `HEDGENTS_EXECUTION_ENABLED=false` and wallet rejection mode disabled. A live browser smoke check showed the execution-paused control state, and the post-promotion error log was empty.

| Wallet | Discovery | Connect | Approval guard | Execute requests | Orders artifact | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Phantom | Wallet Standard | Pass | Pass · signed locally, discarded | 0 | 0 | Required scope passed |
| Solflare | Deferred by operator | Not run | Not run | — | — | Not a current blocker |
| Backpack | Deferred by operator | Not run | Not run | — | — | Not a current blocker |

Wallet-extension approval pages are intentionally outside browser automation. The operator manually approved Phantom; Hedgents then verified visible application state, deployment request logs, and independent Solana RPC evidence.
