"use client";

import "core-js/actual/disposable-stack";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { walletSigner } from "@solana/kit-plugin-wallet";
import { ClientProvider } from "@solana/react";
import { useState } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { base, bsc, mainnet } from "wagmi/chains";

const isSolanaDevnet = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet";
const solanaRpcUrl = isSolanaDevnet
  ? process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL
    ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL
    ?? "https://api.devnet.solana.com"
  : process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL
    ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL
    ?? "https://api.mainnet-beta.solana.com";
const solanaWalletChain = isSolanaDevnet
  ? "solana:devnet" as const
  : "solana:mainnet" as const;

export const solanaClient = createClient()
  .use(walletSigner({ chain: solanaWalletChain }))
  .use(solanaRpc({ rpcUrl: solanaRpcUrl }));

export type AppSolanaClient = Awaited<typeof solanaClient>;

export const evmConfig = createConfig({
  chains: [mainnet, base, bsc],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [bsc.id]: http(),
  },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 5_000,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={evmConfig}>
      <ClientProvider client={solanaClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ClientProvider>
    </WagmiProvider>
  );
}
