"""Which Solana programs does Jupiter actually need to route the terminal's pairs?

The program allowlist is enforced after Jupiter has chosen a route, so a missing venue is a dead end
the tester meets only after picking a size. This measures the reachable venue set per settlement
asset and direction, rather than inferring it from whichever route happened to win once.

  python3 scripts/allowlist-candidates.py            # USDC only (the live beta)
  python3 scripts/allowlist-candidates.py --all      # plus USDT and USDG, for reopening them
"""
import json, urllib.request, time, collections, sys

PAXG = "5GgRAEmv8ZxF2PR5hY72Qs5x1bnQ6UK2RbTPoqJ3wSwW"
SETTLEMENT = {
    "USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "USDT": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    "USDG": "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
}
# Provably in the allowlist: every program the two mainnet canaries invoked, since both passed the
# guard. Anything outside this set is a candidate rather than a confirmed gap, because the live
# allowlist is a sensitive variable and cannot be read back.
PROVEN = {
    "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": "Jupiter Aggregator v6",
    "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc": "Whirlpool (Orca)",
    "goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE": "GoonFi V2",
}
USD_LADDER = (5, 10, 20, 35, 50, 75, 100)
PACING = 1.2  # seconds between quotes; the free tier 429s aggressively below about a second
PAXG_PER_USD = 1 / 4384  # ~$4,384/oz at the time of measurement; only sets the sell size ladder


def labels():
    with urllib.request.urlopen(
        "https://lite-api.jup.ag/swap/v1/program-id-to-label", timeout=20
    ) as r:
        return json.load(r)


def quote(i, o, amount, restrict):
    """A quote, or a tagged failure. The distinction matters: the free tier rate-limits hard, and
    counting a 429 as "no route exists" would report a pair as unroutable when it is only busy."""
    url = (
        f"https://lite-api.jup.ag/swap/v1/quote?inputMint={i}&outputMint={o}&amount={amount}"
        f"&slippageBps=50&restrictIntermediateTokens={'true' if restrict else 'false'}"
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            body = e.read()[:200].decode("utf-8", "replace")
            # Jupiter answers "no route" with a 4xx and a body saying so.
            return {"_norote": body} if "COULD_NOT_FIND_ANY_ROUTE" in body or "no route" in body.lower() else {"_err": f"{e.code} {body}"}
        except Exception as e:
            return {"_err": str(e)}
    return {"_throttled": True}


def main():
    assets = ["USDC", "USDT", "USDG"] if "--all" in sys.argv else ["USDC"]
    label_map = labels()
    by_label = {}
    for prog, lab in label_map.items():
        by_label.setdefault(lab, []).append(prog)

    # (asset, side) -> Counter of venue labels; plus the sample/miss counts behind each cell.
    hits = collections.defaultdict(collections.Counter)
    tried = collections.Counter()
    landed = collections.Counter()
    throttled = collections.Counter()
    noroute = collections.Counter()
    errored = collections.Counter()
    multihop = []

    for asset in assets:
        mint = SETTLEMENT[asset]
        for rnd in range(2):
            for restrict in (True, False):
                for usd in USD_LADDER:
                    for side in ("buy", "sell"):
                        if side == "buy":
                            q = quote(mint, PAXG, usd * 1_000_000, restrict)
                        else:
                            q = quote(PAXG, mint, int(usd * 1_000_000 * PAXG_PER_USD), restrict)
                        tried[(asset, side)] += 1
                        if "routePlan" not in q:
                            if q.get("_throttled"):
                                throttled[(asset, side)] += 1
                            elif "_norote" in q:
                                noroute[(asset, side)] += 1
                            else:
                                errored[(asset, side)] += 1
                            time.sleep(PACING)
                            continue
                        landed[(asset, side)] += 1
                        labs = [s["swapInfo"]["label"] for s in q["routePlan"]]
                        if len(labs) > 1:
                            multihop.append((asset, side, usd, " > ".join(labs)))
                        for l in labs:
                            hits[(asset, side)][l] += 1
                        time.sleep(PACING)

    print("=== reachable venues, by settlement asset and direction ===\n")
    needed = {}
    for asset in assets:
        for side in ("buy", "sell"):
            key = (asset, side)
            print(
                f"{asset} {side}  {landed[key]}/{tried[key]} routed"
                f"  |  {noroute[key]} no-route, {throttled[key]} throttled, {errored[key]} error"
            )
            if not hits[key]:
                verdict = ("GENUINELY UNROUTABLE" if noroute[key] and not throttled[key]
                           else "INCONCLUSIVE: throttled or errored, not proven unroutable")
                print(f"   {verdict}\n")
                continue
            for lab, n in hits[key].most_common():
                progs = by_label.get(lab, [])
                pid = progs[0] if progs else "(unlabelled)"
                mark = "  ok" if pid in PROVEN else "  <- CANDIDATE"
                print(f"   {n:3}x  {lab:22} {pid}{mark}")
                if pid not in PROVEN and progs:
                    needed.setdefault(pid, {"label": lab, "where": set()})["where"].add(
                        f"{asset} {side}"
                    )
            print()

    if multihop:
        print("=== multi-hop routes (these reach venues a single-hop sample would miss) ===")
        for m in multihop[:12]:
            print("  ", m)
        print()

    print("=== programs to review and add ===")
    if not needed:
        print("  none: every reachable venue is already proven present")
    for pid, info in sorted(needed.items(), key=lambda kv: kv[1]["label"]):
        print(f"  {pid}  {info['label']}   needed by: {', '.join(sorted(info['where']))}")


if __name__ == "__main__":
    main()
