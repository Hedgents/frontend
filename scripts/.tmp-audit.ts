import { createSolanaRpc } from "@solana/kit";
import { loadScarcityMarketCatalog } from "@/lib/scarcity-market-store";
import { resolveStoredCurveMarket } from "@/lib/scarcity-deployment";
import {
  decodeCurveMarketAccount,
  decodeScarcityMarketAccount,
  deriveCurveMarketAddresses,
  deriveMarketAddresses,
  hexToBytes,
} from "@/lib/scarcity-exchange";

const rpc = createSolanaRpc(process.env.DEVNET_RPC as string);
const nowUnix = Math.floor(Date.now() / 1_000);

async function accountExists(addr: string) {
  const a = await rpc.getAccountInfo(addr as never, { encoding: "base64", commitment: "confirmed" }).send();
  return a.value ? Uint8Array.from(Buffer.from(a.value.data[0], "base64")) : null;
}

async function main() {
  const catalog = await loadScarcityMarketCatalog();
  const binary: unknown[] = [];
  const curve: unknown[] = [];
  for (const market of catalog) {
    const m = market as Record<string, unknown>;
    const slug = String((m.question as Record<string, unknown> | undefined)?.slug ?? "");
    const marketId = typeof m.marketId === "string" ? m.marketId : null;
    if (marketId) {
      const derived = await deriveMarketAddresses(hexToBytes(marketId));
      const data = await accountExists(String(derived.market));
      if (data) {
        const d = decodeScarcityMarketAccount(data) as Record<string, unknown>;
        binary.push({ slug, status: d.status,
          opensAt: Number(d.opensAt), closesAt: Number(d.closesAt),
          openNow: nowUnix >= Number(d.opensAt) && nowUnix < Number(d.closesAt) });
      }
    }
    // Curve markets compile from the same spec under a different id.
    const resolved = await resolveStoredCurveMarket(slug).catch(() => null);
    const curveId = resolved?.compiled.marketId ?? null;
    if (curveId) {
      const derived = await deriveCurveMarketAddresses(hexToBytes(curveId));
      const data = await accountExists(String(derived.market));
      if (data) {
        const d = decodeCurveMarketAccount(data) as Record<string, unknown>;
        curve.push({ slug: resolved?.compiled.slug ?? slug, status: d.status, opensAt: Number(d.opensAt), closesAt: Number(d.closesAt),
          openNow: nowUnix >= Number(d.opensAt) && nowUnix < Number(d.closesAt) });
      }
    }
  }
  console.log(JSON.stringify({ catalogSize: catalog.length, deployedBinary: binary, deployedCurve: curve }, null, 2));
}
void main().catch((e) => { console.error("ERR", e instanceof Error ? e.message : e); process.exitCode = 1; });
