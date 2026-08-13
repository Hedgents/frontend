import { createSolanaRpc } from "@solana/kit";
import { LITHIUM_ROUNDS } from "@/lib/scarcity/lithium-market";
import { resolveStoredCurveMarket } from "@/lib/scarcity-deployment";
import { decodeCurveMarketAccount, deriveCurveMarketAddresses, hexToBytes } from "@/lib/scarcity-exchange";

const rpc = createSolanaRpc(process.env.DEVNET_RPC as string);
const nowUnix = Math.floor(Date.now() / 1_000);

async function main() {
  const out: unknown[] = [];
  for (const key of Object.keys(LITHIUM_ROUNDS)) {
    const slug = `lithium-tightness-${key}-curve-v1`;
    const resolved = await resolveStoredCurveMarket(slug).catch((e) => { out.push({ slug, resolveError: String(e) }); return null; });
    if (!resolved) continue;
    const compiled = resolved.compiled as any;
    const derived = await deriveCurveMarketAddresses(hexToBytes(compiled.marketId));
    const acct = await rpc.getAccountInfo(derived.market, { encoding: "base64", commitment: "confirmed" }).send();
    if (!acct.value) { out.push({ slug, market: String(derived.market), onChain: false }); continue; }
    const d = decodeCurveMarketAccount(Uint8Array.from(Buffer.from(acct.value.data[0], "base64"))) as Record<string, unknown>;
    out.push({ slug, market: String(derived.market), onChain: true, status: d.status,
      opensAt: Number(d.opensAt), closesAt: Number(d.closesAt),
      openNow: nowUnix >= Number(d.opensAt) && nowUnix < Number(d.closesAt),
      totalStake: String(d.totalStake ?? "") });
  }
  console.log(JSON.stringify({ nowUnix, rounds: out }, null, 2));
}
void main().catch((e) => console.error("ERR", e instanceof Error ? e.message : e));
