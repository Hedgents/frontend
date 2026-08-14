# Emergency pause and receipt recovery

Rehearsed 2026-08-14 (gate G7). Re-run the drill after any change to the execution routes.

## What the pause does and does not do

`HEDGENTS_EXECUTION_ENABLED=false` stops **new** execution: quoting, order assembly, and
submission all refuse with 503 and the message *"New execution is paused by the operator. Existing
pending receipts can still be verified."*

It deliberately does **not** touch `POST /api/execution/status`. That route is the recovery path,
and it is the one thing that must keep working while paused. Someone whose transaction was
submitted and whose outcome is unknown still needs to learn where their money went. If pausing took
recovery down with it, the safest-looking action an operator can take would be the one that strands
whoever is mid-flight.

Recovery is therefore reachable with **no invite session at all** (verified in production: an
unauthenticated `POST` returns 400 for a malformed receipt rather than 401). It is gated only by a
signed recovery receipt, issued alongside every order and valid for 30 days. That is the correct
trade: the route reveals nothing without a receipt, and a receipt-holder can always self-serve.

## Drill

Two servers, one paused and one live, exercised against a **real settled mainnet transaction**
rather than a fixture, so the RPC path, the claim shape, and the received-amount check are all real.

```
# paused
HEDGENTS_EXECUTION_ENABLED=false npx next dev -p 3111
HEDGENTS_EXECUTION_ENABLED=false HEDGENTS_DRILL_BASE_URL=http://127.0.0.1:3111 \
  npx tsx --conditions=react-server scripts/pause-recovery-drill.ts

# live control
HEDGENTS_EXECUTION_ENABLED=true npx next dev -p 3112
HEDGENTS_EXECUTION_ENABLED=true HEDGENTS_DRILL_BASE_URL=http://127.0.0.1:3112 \
  npx tsx --conditions=react-server scripts/pause-recovery-drill.ts
```

Both the server and the script need the same `HEDGENTS_AUTH_SECRET` and
`HEDGENTS_ORDER_SIGNING_SECRET`; the script mints its own admin cookie and its own recovery receipt.
Local throwaway values are fine, and are what the drill is meant to use.

Result on 2026-08-14, 3/3 in each direction:

| Check | Paused | Live |
| --- | --- | --- |
| new orders | 503, refused for the operator pause | 403 eligibility, i.e. past the pause gate |
| real settled receipt recovers | 200 Success, verified, received 2281 | same |
| tampered receipt | 400, token not authenticated | same |

`received=2281` is 0.002281 PAXG, matching the G6 buy exactly. Recovery is reading the chain, not a
cached record.

`lib/emergency-pause-rehearsal.test.ts` covers the same properties as units, including that every
execution route is `force-dynamic` so the pause cannot be served from a cache. 5/5 pass.

## Pausing production

The flag lives in Vercel project env, and Vercel binds env values to a deployment when it is
created. **Changing the variable does nothing to what is currently serving.** It takes effect on
the next deployment, so the naive pause is:

```
vercel env rm HEDGENTS_EXECUTION_ENABLED production -y
printf 'false' | vercel env add HEDGENTS_EXECUTION_ENABLED production
vercel deploy --prod
```

Production builds here take about 1 minute, so that is a 1-2 minute pause once you are at a
terminal. Restore by writing `true` and deploying again. Note that `vercel env add --force` silently
no-ops on an existing key: you must `rm` then `add`, and you cannot read the value back to confirm.

### The weakness, and the lever that fixes it

That path makes the emergency stop depend on a **build succeeding**. A registry hiccup, a yanked
transitive dependency, or a type error that slipped into the tree all block the pause at the moment
you need it most.

The fix costs one extra deployment and no new infrastructure: keep a **paused twin**, a production
build of the same commit with the flag off, that holds no domain. Pausing is then an alias switch,
seconds, with nothing to compile.

```
# build the twin (does not take traffic; live deployment is untouched throughout)
vercel env rm HEDGENTS_EXECUTION_ENABLED production -y
printf 'false' | vercel env add HEDGENTS_EXECUTION_ENABLED production
vercel deploy --prod --skip-domain --yes          # note the URL it prints
vercel env rm HEDGENTS_EXECUTION_ENABLED production -y
printf 'true'  | vercel env add HEDGENTS_EXECUTION_ENABLED production

# pause, later, in seconds
vercel promote <twin-url>

# unpause
vercel promote <live-url>
```

The twin is only a *pure* pause for the commit it was built from. Rebuild it whenever production
ships new code, or promoting it silently rolls the code back too. Record both URLs here:

- live: `https://terminal-ooz1vzfjs-tobiasds-projects.vercel.app` (dpl_8iLUyHUdbDyttfGFEJER9hNioY1Q,
  aliased to terminal.hedgents.com, built from `da12c35`)
- paused twin: **not yet built**

## The other two switches

They are independent, which the unit tests assert, so reach for the narrowest one:

- `HEDGENTS_EXECUTION_PRODUCT_ALLOWLIST` removes a single product while everything else keeps
  trading. Missing or invalid in production pauses new execution outright, which is the safe
  direction.
- `HEDGENTS_WALLET_REJECTION_MODE=true` lets quotes build and sign but hard-disables submission.
  Use this when you want to keep exercising the flow without anything reaching the chain.

## Recovering a receipt while paused

The user needs the recovery receipt issued with their order. With it:

```
curl -X POST https://terminal.hedgents.com/api/execution/status \
  -H 'content-type: application/json' \
  -d '{"signature":"<tx signature>","recoveryAuthorization":"<receipt>"}'
```

Returns `Success` with a `settlement` block once the transaction is finalized, `Failed` if Solana
reports the transaction errored, `Pending` while no RPC has indexed it yet. Settlement is judged on
the taker's actual token delta against the authenticated minimum, never on the transaction bytes.
