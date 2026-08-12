import "server-only";
import { address, type Address } from "@solana/kit";
import {
  METAL_PULSE_INTERVAL_SECONDS,
  pulseRoundStart,
  pulseRoundWindow,
} from "@/lib/metal-pulse";
import { compileMetalPulseMarket } from "@/lib/metal-pulse-market";
import { decodeScarcityMarketAccount, deriveMarketAddresses } from "@/lib/scarcity-exchange";
import { hexToBytes } from "@/lib/scarcity-markets";
import { loadScarcityDeployment, scarcityRpcUrls } from "@/lib/scarcity-deployment";

/**
 * On-chain view of Gold 15 rounds.
 *
 * A pulse round needs no registry and no manifest entry. Its market id is a pure function of the
 * round's 15-minute boundary and the collateral mint, so every account address for every round that
 * ever existed can be re-derived locally from a timestamp. That matters at this cadence: at 96
 * rounds a day, a manifest listing them would be unusable within a week.
 *
 * Positions are therefore found by deriving the candidate YES and NO mints for a window of recent
 * rounds and matching them against ONE read of the wallet's token accounts, rather than reading a
 * market account per round.
 */
export const PULSE_POSITION_LOOKBACK_ROUNDS = 192; // two days at 15 minutes

export interface PulseRoundIdentity {
  roundId: string;
  startsAtUnix: number;
  endsAtUnix: number;
  marketId: string;
  market: string;
  yesMint: string;
  noMint: string;
  vault: string;
}

export async function deriveMetalPulseRound(input: {
  startsAtUnix: number;
  collateralMint: Address | string;
}): Promise<PulseRoundIdentity> {
  const compiled = compileMetalPulseMarket({
    startsAtUnix: input.startsAtUnix,
    collateralMint: input.collateralMint,
  });
  const addresses = await deriveMarketAddresses(hexToBytes(compiled.marketId));
  const window = pulseRoundWindow(input.startsAtUnix);
  return {
    roundId: window.id,
    startsAtUnix: window.startsAtUnix,
    endsAtUnix: window.endsAtUnix,
    marketId: compiled.marketId,
    market: String(addresses.market),
    yesMint: String(addresses.yesMint),
    noMint: String(addresses.noMint),
    vault: String(addresses.vault),
  };
}

/** The rounds a tester could plausibly hold: the current one, the next, and the recent past. */
export function recentPulseRoundStarts(nowUnix: number, lookback = PULSE_POSITION_LOOKBACK_ROUNDS) {
  const current = pulseRoundStart(nowUnix);
  const starts: number[] = [];
  // The next round trades before it starts, so include it.
  for (let index = 1; index >= -lookback; index -= 1) {
    starts.push(current + index * METAL_PULSE_INTERVAL_SECONDS);
  }
  return starts;
}

interface ParsedTokenAccount {
  account: { data: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } } };
}

async function rpc<T>(endpoints: readonly string[], method: string, params: unknown[]): Promise<T | null> {
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: `pulse-${method}`, method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as { result?: T; error?: unknown };
      if (payload.error || payload.result === undefined) continue;
      return payload.result;
    } catch {
      // Try the next provider rather than reporting an empty record.
    }
  }
  return null;
}

async function readPulseRoundStatus(
  endpoints: readonly string[],
  market: string,
): Promise<PulsePosition["status"]> {
  const account = await rpc<{ value: { data: [string, string] } | null }>(
    endpoints, "getAccountInfo", [market, { encoding: "base64", commitment: "confirmed" }],
  );
  if (!account?.value) return "missing";
  try {
    const decoded = decodeScarcityMarketAccount(
      new Uint8Array(Buffer.from(account.value.data[0], "base64")),
    ) as { status: PulsePosition["status"] };
    return decoded.status;
  } catch {
    return "missing";
  }
}

export interface PulsePosition {
  roundId: string;
  marketId: string;
  market: string;
  startsAtUnix: number;
  endsAtUnix: number;
  yes: string;
  no: string;
  /** "missing" when the round was never created on chain, which is not the same as unresolved. */
  status: "unresolved" | "resolved-yes" | "resolved-no" | "invalid" | "missing";
}

/**
 * Every Gold 15 position a wallet holds, from a single token-account read.
 *
 * Redeeming burns the tokens, so like every other binary market this sees holdings rather than
 * history. A round that was played and settled leaves nothing behind.
 */
export async function readPulsePositions(input: {
  wallet: string;
  nowUnix?: number;
}): Promise<{ cluster: "devnet" | "mainnet-beta"; positions: PulsePosition[] } | null> {
  const deployment = await loadScarcityDeployment();
  if (!deployment) return null;
  const endpoints = scarcityRpcUrls(deployment.cluster);
  const accounts = await rpc<{ value: ParsedTokenAccount[] }>(endpoints, "getTokenAccountsByOwner", [
    input.wallet,
    { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  if (!accounts?.value?.length) return { cluster: deployment.cluster, positions: [] };

  const balances = new Map<string, bigint>();
  for (const entry of accounts.value) {
    const mint = entry.account.data.parsed?.info?.mint;
    const amount = entry.account.data.parsed?.info?.tokenAmount?.amount;
    if (!mint || !amount || !/^\d+$/.test(amount) || amount === "0") continue;
    balances.set(mint, (balances.get(mint) ?? 0n) + BigInt(amount));
  }
  if (!balances.size) return { cluster: deployment.cluster, positions: [] };

  const positions: PulsePosition[] = [];
  const collateralMint = address(deployment.collateralMint);
  for (const startsAtUnix of recentPulseRoundStarts(input.nowUnix ?? Math.floor(Date.now() / 1_000))) {
    const round = await deriveMetalPulseRound({ startsAtUnix, collateralMint });
    const yes = balances.get(round.yesMint) ?? 0n;
    const no = balances.get(round.noMint) ?? 0n;
    if (yes === 0n && no === 0n) continue;
    positions.push({
      roundId: round.roundId,
      marketId: round.marketId,
      market: round.market,
      startsAtUnix: round.startsAtUnix,
      endsAtUnix: round.endsAtUnix,
      yes: yes.toString(),
      no: no.toString(),
      // Read the market account only for rounds actually held, which is a handful rather than 192.
      status: await readPulseRoundStatus(endpoints, round.market),
    });
  }
  return { cluster: deployment.cluster, positions };
}
