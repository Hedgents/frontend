# Hedgents metal terminal

Hedgents is a self-custodial Solana terminal for discovering, comparing, buying, and selling tokenized metal products. Purchases start with native Solana USDC; sales can settle into canonical Solana USDC, USDT, or USDG. Registered products become executable only when the exact-size Jupiter gate returns a valid route inside that product's price-impact limit; settlement goes directly to the connected wallet.

Cross-chain stablecoin funding is intentionally outside this repository. A separate Rail SDK may fund the Solana wallet, but Hedgents owns wallet connection, product intelligence, execution safety, and settlement verification.

## Current scope

- 15 registered Solana execution adapters across gold, silver, uranium, platinum, copper, and palladium; live liquidity is checked separately and may leave an adapter unavailable
- Live Pyth metal or underlying-security references where an institutional feed exists
- Exact-size Jupiter health checks across every registered product for the selected metal
- Like-for-like route ranking without treating physical metal, ETF shares, futures funds, and miners funds as interchangeable
- Wallet Standard signing and managed Jupiter execution
- Pre-signature Solana simulation and short-lived authenticated order claims
- Server-enforced country/issuer evidence with fail-closed tokenized-security allowlists
- Independent, multi-RPC post-trade settlement verification
- Recoverable signed-pending state and portable authenticated JSON receipts
- FIFO cost basis and realized/unrealized P&L for verified Hedgents fills, with explicit coverage limits
- Per-endpoint request limits, mutation-origin validation, bounded JSON bodies, and security headers
- Optional privacy-preserving beta diagnostics, off by default
- A production fail-closed execution switch and exact server-side closed-beta transaction cap; receipt recovery remains available during a pause
- A production fail-closed product execution allowlist, initially intended for `gold-paxg`; the full registry remains available for read-only discovery

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev -- --port 3001
```

Open `http://127.0.0.1:3001` to avoid colliding with unrelated services that may bind the IPv6 localhost address.

## Verification

```bash
npm test
npm run test:e2e
npm run build
npm run probe:metals -- 100
npm run simulate:metals -- 100
```

The probe and simulation commands require the environment described in [.env.example](./.env.example). The 60-route simulation matrix uses a public funded wallet for buys and public token-holder state for sells; it never signs or submits a transaction.

See [BETA_READINESS.md](./BETA_READINESS.md) for the closed-beta gates and operator checklist.
See [BETA_WALLET_MATRIX.md](./BETA_WALLET_MATRIX.md) for extension checks and the explicitly paid canary gate.

## Key boundaries

- No custody: the user approves transactions in their own wallet.
- No new bridge: cross-chain funding belongs to the separate Rail SDK.
- No false best price: products are ranked only inside an equivalent exposure group.
- No automatic hedge: Hyperliquid is displayed as a separate future approval path, not bundled into a spot purchase.
