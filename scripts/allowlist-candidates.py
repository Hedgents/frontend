import json, urllib.request, time, collections
USDC="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
PAXG="5GgRAEmv8ZxF2PR5hY72Qs5x1bnQ6UK2RbTPoqJ3wSwW"
labels=json.load(open('/private/tmp/claude-501/-Users-tobiasd-Desktop-Hedgents/03ec7686-c892-4700-b3f6-edd640460dfc/scratchpad/labels.json'))
by_label={}
for p,l in labels.items(): by_label.setdefault(l,[]).append(p)
def quote(i,o,a,restrict):
    u=(f"https://lite-api.jup.ag/swap/v1/quote?inputMint={i}&outputMint={o}&amount={a}"
       f"&slippageBps=50&restrictIntermediateTokens={'true' if restrict else 'false'}")
    try:
        with urllib.request.urlopen(u,timeout=20) as r: return json.load(r)
    except Exception as e: return {"_err":str(e)}
hits=collections.Counter(); multihop=0; total=0; hop_examples=[]
for rnd in range(3):
    for restrict in (True,False):
        for usd in (5,10,20,35,50,75,100):
            for side in ("buy","sell"):
                if side=="buy": q=quote(USDC,PAXG,usd*1_000_000,restrict)
                else: q=quote(PAXG,USDC,int(usd*1_000_000/4384),restrict)
                total+=1
                if "routePlan" not in q: continue
                labs=[s["swapInfo"]["label"] for s in q["routePlan"]]
                if len(labs)>1:
                    multihop+=1
                    if len(hop_examples)<6: hop_examples.append((side,usd,restrict," > ".join(labs)))
                for l in labs: hits[l]+=1
                time.sleep(0.35)
print(f"samples={total} multihop_routes={multihop}\n")
print("venue".ljust(28),"hits  program id")
for l,n in hits.most_common():
    print(l.ljust(28), f"{n:4}  {','.join(by_label.get(l,['(unlabelled)']))}")
if hop_examples:
    print("\nmulti-hop examples:")
    for e in hop_examples: print(" ",e)
