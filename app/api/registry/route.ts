import { NextResponse } from "next/server";
import { getAddressDecoder } from "@solana/kit";
import type { RegistryHealth } from "@/lib/execution-types";
import { apiSecurityError, enforceRateLimit } from "@/lib/api-security";
import { requireInviteAccess } from "@/lib/access-auth";
import { getJupiterOrder, hasJupiterApiKey } from "@/lib/jupiter-server";
import {
  getSolanaExecutionProduct,
  solanaExecutionProducts,
} from "@/lib/product-registry";
import { solanaRpcRequest } from "@/lib/solana-rpc";
import { readBoundedUpstreamJson } from "@/lib/safe-upstream-response";

export const dynamic = "force-dynamic";

interface JupiterTokenEntry {
  id?: string;
  symbol?: string;
  decimals?: number;
  tokenProgram?: string;
  isVerified?: boolean;
  liquidity?: number;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  permanentDelegate?: string | null;
}

function readPermanentDelegate(encoded: string | null) {
  if (!encoded) return null;
  try {
    const bytes = Buffer.from(encoded, "base64");
    let offset = 166;
    while (offset + 4 <= bytes.length) {
      const extensionType = bytes.readUInt16LE(offset);
      const extensionLength = bytes.readUInt16LE(offset + 2);
      offset += 4;
      if (offset + extensionLength > bytes.length) return null;
      if (extensionType === 12 && extensionLength === 32) {
        return getAddressDecoder().decode(bytes.subarray(offset, offset + extensionLength)).toString();
      }
      offset += extensionLength;
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchDirectoryEntry(mint: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`,
      { cache: "no-store", signal: controller.signal },
    );
    if (!response.ok) return null;
    const entries = await readBoundedUpstreamJson<JupiterTokenEntry[]>(response, 1_000_000, "Jupiter token directory");
    return entries.find((entry) => entry.id === mint) ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMintAccount(mint: string) {
  try {
    const result = await solanaRpcRequest<{ value?: { owner?: string; data?: [string, string] } | null }>(
      "getAccountInfo",
      [mint, { encoding: "base64", commitment: "confirmed" }],
      { id: "hedgents-registry-mint-check" },
    );
    const value = result?.value;
    return {
      available: true,
      exists: Boolean(value),
      owner: value?.owner ?? null,
      permanentDelegate: readPermanentDelegate(value?.data?.[0] ?? null),
    };
  } catch {
    return { available: false, exists: false, owner: null, permanentDelegate: null };
  }
}

async function buildHealth(
  productId: string,
  options: { probeLiquidity: boolean },
): Promise<RegistryHealth | null> {
  const product = getSolanaExecutionProduct(productId);
  if (!product) return null;

  const [directory, mintAccount] = await Promise.all([
    fetchDirectoryEntry(product.mint),
    fetchMintAccount(product.mint),
  ]);
  const identityVerified = Boolean(
    directory?.isVerified &&
      directory.id === product.mint &&
      directory.decimals === product.decimals &&
      directory.tokenProgram === product.tokenProgramAddress,
  );
  const onchainVerified = Boolean(
    mintAccount.available && mintAccount.exists && mintAccount.owner === product.tokenProgramAddress,
  );

  let liquidity: RegistryHealth["liquidity"] = {
    status: "configuration-required",
    directoryLiquidityUsd: typeof directory?.liquidity === "number" ? directory.liquidity : null,
    probeInputUsd: product.execution.probeUsd,
    probeOutputAmount: null,
    impliedUnitPriceUsd: null,
    note: "Set JUPITER_API_KEY to run the live $100 route probe.",
  };

  if (!options.probeLiquidity) {
    liquidity = {
      ...liquidity,
      status: "unavailable",
      note: "Select this product to run its live Jupiter route probe.",
    };
  } else if (hasJupiterApiKey()) {
    try {
      const params = new URLSearchParams({
        inputMint: product.execution.inputMint,
        outputMint: product.mint,
        amount: String(product.execution.probeUsd * 10 ** product.execution.inputDecimals),
      });
      const quote = await getJupiterOrder(params);
      const outAmount = typeof quote.outAmount === "string" ? quote.outAmount : null;
      const outputUnits = outAmount ? Number(outAmount) / 10 ** product.decimals : 0;
      const impliedUnitPriceUsd = outputUnits > 0
        ? product.execution.probeUsd / outputUnits
        : null;
      liquidity = {
        status: outAmount && BigInt(outAmount) > 0n ? "verified" : "failed",
        directoryLiquidityUsd: typeof directory?.liquidity === "number" ? directory.liquidity : null,
        probeInputUsd: product.execution.probeUsd,
        probeOutputAmount: outAmount,
        impliedUnitPriceUsd,
        note: outAmount
          ? `Jupiter returned a current USDC → ${product.symbol} route for the probe size.`
          : "Jupiter returned no output for the probe size.",
      };
    } catch (error) {
      liquidity = {
        status: "failed",
        directoryLiquidityUsd: typeof directory?.liquidity === "number" ? directory.liquidity : null,
        probeInputUsd: product.execution.probeUsd,
        probeOutputAmount: null,
        impliedUnitPriceUsd: null,
        note: error instanceof Error ? error.message : "The Jupiter route probe failed.",
      };
    }
  }

  return {
    productId,
    checkedAt: new Date().toISOString(),
    identity: {
      status: directory ? (identityVerified ? "verified" : "failed") : "unavailable",
      mint: product.mint,
      symbol: directory?.symbol ?? null,
      decimals: directory?.decimals ?? null,
      tokenProgram: directory?.tokenProgram ?? null,
      directoryVerified: Boolean(directory?.isVerified),
    },
    onchain: {
      status: mintAccount.available ? (onchainVerified ? "verified" : "failed") : "unavailable",
      accountExists: mintAccount.exists,
      owner: mintAccount.owner,
    },
    controls: {
      mintAuthority: directory?.mintAuthority ?? null,
      freezeAuthority: directory?.freezeAuthority ?? null,
      permanentDelegate: mintAccount.permanentDelegate ?? directory?.permanentDelegate ?? null,
      note: `${product.controlNote} Every executable order is simulated before signing.`,
    },
    liquidity,
    ready: identityVerified && onchainVerified && liquidity.status === "verified",
  };
}

export async function GET(request: Request) {
  let responseHeaders: Record<string, string> = {};
  try {
    requireInviteAccess(request);
    responseHeaders = enforceRateLimit(request, { key: "registry", limit: 50, windowMs: 60_000 }).headers;
    const productId = new URL(request.url).searchParams.get("productId");
    if (productId) {
      const health = await buildHealth(productId, { probeLiquidity: true });
      if (!health) return NextResponse.json(
        { error: "Product is not in the executable registry." },
        { status: 404, headers: { ...responseHeaders, "cache-control": "no-store" } },
      );
      return NextResponse.json(health, { headers: { ...responseHeaders, "cache-control": "no-store" } });
    }

    const products = await Promise.all(
      Object.keys(solanaExecutionProducts).map((id) =>
        buildHealth(id, { probeLiquidity: false }),
      ),
    );
    return NextResponse.json(
      { checkedAt: new Date().toISOString(), products: products.filter(Boolean) },
      { headers: { ...responseHeaders, "cache-control": "no-store" } },
    );
  } catch (error) {
    const security = apiSecurityError(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Registry unavailable." },
      { status: security?.status ?? 500, headers: { ...responseHeaders, ...(security?.headers ?? {}), "cache-control": "no-store" } },
    );
  }
}
