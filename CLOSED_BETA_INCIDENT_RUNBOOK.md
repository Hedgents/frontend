# Hedgents closed-beta incident runbook

This runbook covers beta-access revocation, emergency execution pause, and settlement recovery. It is deliberately scoped to controls that exist today. Hedgents does **not** yet have a durable server-side execution audit ledger; see “Evidence boundary” below.

## Known-safe control order

1. If new orders may be unsafe, set `HEDGENTS_EXECUTION_ENABLED=false` in the production environment and redeploy.
2. Leave `/api/execution/status` available. It cannot submit a transaction and is needed to determine the finalized state of already-issued receipts.
3. Revoke any affected invite grant from the authenticated admin panel.
4. Preserve browser receipts, transaction signatures, relevant deployment logs, and the current invite-registry response before changing signing secrets.
5. Investigate before re-enabling execution. Do not interpret a venue response or a browser toast as settlement truth; verify the authorized transaction on Solana.

The execution pause blocks comparison, order creation, and submission. It does not disable read-only discovery or possession-based settlement recovery.

## Revoke one tester

Use **Admin → Beta invitations → Revoke**, confirm the identifier, and wait for the server response. The row changes to `Revoked` only after the private invite index is durably written.

The equivalent authenticated API operation is:

```http
PATCH /api/admin/invites
Content-Type: application/json

{"id":"ABCDEF123456"}
```

Revocation is one-way and idempotent. It sets `active=false`, records `revokedAt`, and increments the grant’s `sessionVersion` once. Repeating the request returns the same revoked record; it never reactivates the code.

Every real-funds order and submission rechecks the session’s `grantId` and `grantVersion` against uncached private storage. A revoked tester cannot create or submit a new trade on the next request. Read-only terminal, discovery, quote, and comparison traffic may use the private Blob CDN for at most 60 seconds, reducing storage operations during normal polling; that access expires after the cache window. The Proxy creates a signed, request-bound, short-lived internal attestation only after the relevant lookup; protected route handlers validate the attestation instead of trusting Proxy alone. Administrator sessions remain separately valid.

## Session limits and broad invalidation

- New beta sessions live for at most 12 hours.
- Individual response: revoke the invite grant. This immediately blocks order creation and submission for every session issued from that code without affecting other testers; read-only access may take up to 60 seconds to expire.
- Broad response: pause execution first, then rotate `HEDGENTS_AUTH_SECRET` and redeploy if every beta and administrator session must be invalidated. Operators must sign in again.
- Do not rotate `HEDGENTS_RECOVERY_SIGNING_SECRET` as a session-response shortcut. That would invalidate outstanding settlement-recovery capabilities.

## Invite registry or Blob failure

Protected beta traffic fails closed with `503` when the durable invite registry cannot be read. Code redemption and admin mutation also return an availability error; they do not claim that a valid code is invalid or that a revocation succeeded. Administrator authentication remains valid, although registry list/create/revoke operations still need Blob.

Do not replace the index manually during an outage. Restore the configured private Blob binding, verify that `invites/index.json` passes integrity checks, list invites in Admin, then retry the original operation. Keep execution paused until the registry can be read consistently.

## Recover an already-issued execution

`POST /api/execution/status` is an exact public capability route: no beta cookie is required. The handler still enforces the browser-origin rule, JSON/body and rate limits, transaction-signature validation, a signed recovery authorization, and finalized Solana settlement verification. A neighboring path does not inherit this exception.

Recovery procedure:

1. Ask the tester to keep or export the local execution receipt. Never request a seed phrase or private key.
2. Use the receipt’s transaction signature and recovery authorization through the terminal recovery flow.
3. If the response is `Pending`, wait for normal chain finality and retry; do not submit the trade again.
4. Treat `Success` only as the result of independent finalized wallet-delta verification. Treat a verified onchain failure as `Failed`.
5. If recovery infrastructure is degraded, inspect the signature through two configured RPC providers while preserving the original receipt. Do not convert uncertainty into success or failure.

Revoking an invite, logging out, or pausing new execution must never prevent this recovery check.

## Deployment migration from legacy beta access

Production no longer accepts `HEDGENTS_INVITE_CODE_HASH` as a shared beta bypass. Before releasing this change:

1. Confirm `BLOB_READ_WRITE_TOKEN`, `HEDGENTS_AUTH_SECRET`, and `HEDGENTS_ADMIN_CODE_HASH` are configured in the target deployment.
2. Sign in as administrator and generate at least one durable invite grant before inviting or re-inviting testers.
3. Expect old beta cookies to fail closed because they have no `grantId` or `grantVersion`. Existing administrator cookies remain valid during the migration.
4. Existing valid v1 invite-index records migrate to v2 on read and are persisted as v2 on their next create, redemption, or revoke mutation. Inactive v1 records remain inactive.
5. Reissue stored invite codes or generate replacements as appropriate. Removing or retaining the legacy beta hash has no production access effect.

Local development may retain `HEDGENTS_INVITE_CODE_HASH` as a deterministic bootstrap convenience; this exception is unavailable when `NODE_ENV=production`.

## Evidence boundary

Current durable truth consists of the user’s authenticated recovery receipt and Solana transaction state. The private invite index records access issuance metadata, redemption counts, revocation time, and grant version. Deployment logs may provide supporting request context but are not a complete execution audit ledger.

Durable server-side execution audit events are **pending implementation**. Until that work is complete:

- do not claim that every order attempt has a durable server record;
- never block or rewrite an already-submitted result merely because a later audit write is unavailable;
- preserve local receipts and chain signatures during every incident;
- record operator actions and timestamps in the incident notes outside the application.

## Resume checklist

Resume only after all applicable items are true:

- the affected invite is visibly revoked, order/submission requests using its old session are rejected immediately, and read-only requests are rejected after the 60-second cache window;
- the private invite registry reads and writes successfully;
- pending receipts have been recovered or explicitly remain pending;
- the execution product allowlist and beta amount cap are still correct;
- independent RPC providers are healthy;
- the incident cause and operator actions are recorded;
- `npm test`, `npm run build`, and the relevant wallet canary pass;
- execution is deliberately re-enabled in a new deployment.
