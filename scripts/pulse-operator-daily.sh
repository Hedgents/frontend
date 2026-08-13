#!/usr/bin/env bash
#
# The admin half of Gold 15. Run this once a day.
#
#   SCARCITY_COLLATERAL_MINT=... scripts/pulse-operator-daily.sh [roundsAhead]
#
# Quoting and settling moved to the Cloudflare Worker in /Hedgents/hedgents-pulse-worker, which runs
# every fifteen minutes on a key that can do neither of the two things below. What is left here needs
# the exchange admin and cannot be delegated:
#
#   create_market, which the program requires the admin to sign, and
#   close_market,  which returns a settled round's rent to the admin.
#
# Both are idempotent. Opening rounds a day ahead costs about 0.0087 SOL each up front, and closing
# returns roughly two thirds of it once a round has settled and been fully redeemed; the operator's
# own redemption is done by the Worker, so a round it has tidied is closeable here the next day.
set -uo pipefail
cd "$(dirname "$0")/.."

: "${SCARCITY_ADMIN_KEYPAIR:=$HOME/.config/solana/id.json}"
: "${SCARCITY_COLLATERAL_MINT:?set SCARCITY_COLLATERAL_MINT}"
# Alchemy serves the RPC but has no slotSubscribe, so confirmation listens on the public endpoint.
: "${SCARCITY_RPC_URL:=https://api.devnet.solana.com}"
: "${SCARCITY_WS_URL:=wss://api.devnet.solana.com}"
export SCARCITY_ADMIN_KEYPAIR SCARCITY_COLLATERAL_MINT SCARCITY_RPC_URL SCARCITY_WS_URL

ROUNDS_AHEAD="${1:-96}"

echo "=== $(date -u '+%Y-%m-%dT%H:%M:%SZ') Gold 15 daily ==="

# Reclaim first, so the rent recovered here helps pay for the rounds opened below.
echo "-- reclaiming settled rounds --"
npx tsx --conditions=react-server scripts/close-settled-pulse-rounds.ts 192 \
  || echo "   rent reclaim failed, continuing"

echo "-- opening the next ${ROUNDS_AHEAD} rounds --"
npx tsx scripts/create-pulse-rounds-devnet.ts "$ROUNDS_AHEAD" \
  || echo "   round creation failed"

echo "-- operator balance --"
solana balance "$(solana address --keypair "$SCARCITY_ADMIN_KEYPAIR")" --url "$SCARCITY_RPC_URL" 2>/dev/null || true
