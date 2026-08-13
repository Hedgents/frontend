/**
 * Rebuild the devnet deployment manifest from what is actually on chain.
 *
 *   SCARCITY_COLLATERAL_MINT=... HEDGENTS_SCARCITY_DEVNET_RPC_URLS=... \
 *   npx tsx --conditions=react-server scripts/rebuild-devnet-manifest.ts
 *
 * The manifest is the reviewed allowlist: a market absent from it reads as "trading disabled" no
 * matter what exists on chain. It lives in a Vercel environment variable that cannot be read back,
 * so rather than editing it blind this derives the whole thing from the chain and the catalog.
 *
 * Chain is the authority for which markets exist; the exchange config account is the authority for
 * the admin, collateral, fee recipient and fee, and the app re-checks that agreement on every read,
 * so a manifest built this way cannot silently disagree with the program. Creation signatures are
 * recovered by walking each market account's history back to its oldest transaction.
 *
 * Prints the JSON. Setting it is a separate, deliberate step.
 */
import { createSolanaRpc } from "@solana/kit";
import { loadScarcityMarketCatalog } from "@/lib/scarcity-market-store";
import { LITHIUM_ROUNDS } from "@/lib/scarcity/lithium-market";
import { resolveStoredCurveMarket } from "@/lib/scarcity-deployment";
import {
  decodeExchangeConfigAccount,
  deriveConfigAddress,
  deriveCurveMarketAddresses,
  deriveMarketAddresses,
  hexToBytes,
} from "@/lib/scarcity-exchange";

const rpcUrl = process.env.SCARCITY_RPC_URL?.trim()
  || process.env.HEDGENTS_SCARCITY_DEVNET_RPC_URLS?.split(",")[0]?.trim()
  || "https://api.devnet.solana.com";
const rpc = createSolanaRpc(rpcUrl);

async function accountData(addressText: string) {
  const account = await rpc
    .getAccountInfo(addressText as never, { encoding: "base64", commitment: "confirmed" })
    .send();
  return account.value ? Uint8Array.from(Buffer.from(account.value.data[0], "base64")) : null;
}

/** The transaction that created an account is the oldest one that touched it. */
async function creationSignature(addressText: string) {
  let before: string | undefined;
  let oldest: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const batch = await rpc
      .getSignaturesForAddress(addressText as never, { limit: 1000, before: before as never }, )
      .send();
    if (!batch.length) break;
    oldest = String(batch[batch.length - 1].signature);
    if (batch.length < 1000) break;
    before = oldest;
  }
  return oldest;
}

async function main() {
  const [configAddress] = await deriveConfigAddress();
  const configData = await accountData(String(configAddress));
  if (!configData) throw new Error("The exchange config account does not exist on this cluster.");
  const config = decodeExchangeConfigAccount(configData);

  const markets: Record<string, { resolver: string; creationSignature: string }> = {};
  for (const entry of await loadScarcityMarketCatalog()) {
    const market = entry as Record<string, any>;
    const slug = market.question?.slug as string | undefined;
    if (!slug || typeof market.marketId !== "string") continue;
    const derived = await deriveMarketAddresses(hexToBytes(market.marketId));
    if (!(await accountData(String(derived.market)))) continue;
    const signature = await creationSignature(String(derived.market));
    if (!signature) {
      process.stderr.write(`  ${slug}: on chain but no signature history, skipping\n`);
      continue;
    }
    markets[slug] = { resolver: String(config.resolver), creationSignature: signature };
    process.stderr.write(`  binary ${slug}\n`);
  }

  const curveMarkets: Record<string, { resolver: string; creationSignature: string }> = {};
  for (const key of Object.keys(LITHIUM_ROUNDS)) {
    const slug = `lithium-tightness-${key}-curve-v1`;
    const resolved = await resolveStoredCurveMarket(slug).catch(() => null);
    if (!resolved) continue;
    const derived = await deriveCurveMarketAddresses(hexToBytes(resolved.compiled.marketId));
    if (!(await accountData(String(derived.market)))) continue;
    const signature = await creationSignature(String(derived.market));
    if (!signature) continue;
    curveMarkets[slug] = { resolver: String(config.resolver), creationSignature: signature };
    process.stderr.write(`  curve ${slug}\n`);
  }

  const manifest = {
    schemaVersion: "1.0.0",
    cluster: "devnet",
    programAddress: "CJHWP9ed1BzWVQhUeJPQ9jJb4YcVWiFNpQcG7mPEGk86",
    admin: String(config.admin),
    collateralMint: String(config.collateralMint),
    feeRecipient: String(config.feeRecipient),
    resolver: String(config.resolver),
    tradingFeeBps: config.tradingFeeBps,
    markets,
    curveMarkets,
  };
  console.log(JSON.stringify(manifest));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
