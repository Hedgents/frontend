# Hedgents frontend

Local operator dashboard for the [Hedgents fleet](https://github.com/Hedgents/fleet). Surfaces inter-agent mesh communication as a human-readable feed alongside live AUM, P&L, and per-strategy position state.

## Overview

The Hedgents fleet runs as 5 autonomous Rust daemons on the operator's hardware. This frontend is a local-only Next.js app that:

- Tails each daemon's structured tracing log via the dashboard backend (`fleet-dashboard-server`)
- Decodes signed CBOR envelopes (`Assign`, `Approve`, `Report`, `Escalate`, `MarketSignal`, `Beacon`) into one-line human sentences
- Renders a scrolling mesh feed showing the agent-to-agent conversation in real time
- Polls on-chain position state (Kamino, Jupiter Perps) for live AUM
- Surfaces fleet health, allocation breakdown, and 24h P&L

Designed for institutional treasury operators watching their own fleet execute strategy on real money.

## What you'll see

- **Numbers panel**: total AUM, 24h P&L, allocation pie, 5 daemon health pills
- **Mesh feed**: live envelope stream — "researcher saw SOL move +2.3% over 1h", "orchestrator asked onyc to lever to 40% LTV", "riskwatcher noticed onyc LTV drift, distance 487bps", etc.
- **Behavior timeline**: 24h activity heatmap + grouped events

## Status

In active development for the 2026-05 demo. See [the sprint plan](https://github.com/Hedgents/fleet/blob/main/docs/superpowers/plans/2026-05-06-demo-sprint.md) for architecture + day-by-day milestones.

## Architecture

```
[Hedgents fleet daemons] → [JSONL logs + tracing JSON]
                              ↓
                 [fleet-dashboard-server (axum)]
                       ↓                ↓
                  [SQLite store]  [chain reads]
                              ↓
                 [REST + WebSocket on 127.0.0.1:7700]
                              ↓
                  [this Next.js frontend, localhost:3000]
```

No hosted infrastructure. No auth. No wallet adapter. The operator's Solana keypair lives in their local `secrets-dir` per daemon convention; this frontend only displays — it doesn't custody.

## Build

```bash
npm install
npm run dev
# opens http://localhost:3000
```

Requires the [fleet dashboard server](https://github.com/Hedgents/fleet) running at `127.0.0.1:7700`. Override via `NEXT_PUBLIC_API_BASE` if running elsewhere.

## Stack

- Next.js 16 + React 19
- Tailwind CSS v4 + shadcn/ui
- recharts (24h activity chart)
- Native WebSocket for the live mesh feed (auto-reconnect every 2s)

## License

TBD — institutional preview.
