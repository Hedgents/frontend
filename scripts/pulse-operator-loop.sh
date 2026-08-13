#!/usr/bin/env bash
#
# Keep Gold 15 alive: open rounds, quote both sides, settle what has closed.
#
#   scripts/pulse-operator-loop.sh
#
# This has to run on an operator machine rather than on the server. Creating a round calls
# create_market, which the program requires the exchange admin to sign, and the admin key is also
# the resolver and the pause authority, so it does not belong in a web host's environment. The
# faucet key is separate for exactly that reason; this one is not delegable.
#
# The quoting step is the reason this is a loop rather than a cron of one shot. mint_complete_set
# requires the market to be open for issuance, so the maker can only ever quote the round whose
# trading window has already begun: one round ahead, every fifteen minutes. Round creation and
# settlement are batched further out and are cheap to repeat.
#
# Everything it runs is idempotent, so a missed tick costs one round of liquidity and nothing else.
set -uo pipefail
cd "$(dirname "$0")/.."

: "${SCARCITY_ADMIN_KEYPAIR:=$HOME/.config/solana/id.json}"
: "${SCARCITY_COLLATERAL_MINT:?set SCARCITY_COLLATERAL_MINT}"
: "${SCARCITY_FEE_RECIPIENT:?set SCARCITY_FEE_RECIPIENT}"
: "${PYTH_API_KEY:=}"
# Alchemy serves the RPC but has no slotSubscribe, so confirmation listens on the public endpoint.
: "${SCARCITY_RPC_URL:=https://api.devnet.solana.com}"
: "${SCARCITY_WS_URL:=wss://api.devnet.solana.com}"
export SCARCITY_ADMIN_KEYPAIR SCARCITY_COLLATERAL_MINT SCARCITY_FEE_RECIPIENT PYTH_API_KEY
export SCARCITY_RPC_URL SCARCITY_WS_URL

CONTRACTS="${PULSE_CONTRACTS:-50}"

while true; do
  echo "=== $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
  npx tsx scripts/create-pulse-rounds-devnet.ts 4 >/dev/null 2>&1 \
    && echo "  rounds opened" || echo "  round creation failed"
  # Only the next round can be quoted; anything further is not open for issuance yet.
  npx tsx scripts/run-pulse-maker-devnet.ts 1 "$CONTRACTS" >/dev/null 2>&1 \
    && echo "  next round quoted" || echo "  quoting failed"
  npx tsx scripts/resolve-pulse-rounds.ts 8 >/dev/null 2>&1 \
    && echo "  settled what was due" || echo "  settlement failed"
  # Reclaim rent from rounds that are fully settled. Without this a round costs 0.023 SOL forever;
  # with it about 0.003 stays spent, being the two outcome mints the token program cannot close.
  npx tsx --conditions=react-server scripts/close-settled-pulse-rounds.ts 24 >/dev/null 2>&1 \
    && echo "  reclaimed settled rent" || echo "  rent reclaim failed"

  # Wake a little after each quarter-hour boundary, so a freshly opened round is quoted promptly.
  now=$(date -u +%s)
  sleep $(( 900 - (now % 900) + 20 ))
done
