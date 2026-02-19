"use client";

import {
  createConfig,
  http,
  WagmiProvider as WagmiProviderBase,
  useConnect,
  useAccount,
} from "wagmi";
import { base } from "viem/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { injected } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { useEffect, useRef, useState } from "react";

const queryClient = new QueryClient();

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    farcasterMiniApp(), // index 0 — auto-connect di Base App / Farcaster
    injected(),         // Rabby, MetaMask, dll di browser biasa
  ],
  transports: {
    [base.id]: http("https://mainnet.base.org"),
  },
});

// -----------------------------------------------------------------------------
// AutoConnect: mount setelah hydration selesai, baru connect
// Ini fix untuk error "Cannot update a component while rendering a different component"
// -----------------------------------------------------------------------------
function AutoConnect() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const attempted = useRef(false);
  // [FIX] Tunggu sampai component benar-benar mounted di client
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // [FIX] Hanya jalankan setelah mounted, belum pernah coba, dan belum connect
    if (!mounted || isConnected || attempted.current) return;
    attempted.current = true;

    const miniAppConnector = connectors[0]; // selalu farcasterMiniApp
    if (!miniAppConnector) return;

    // Silent fail kalau bukan di Farcaster/Base App
    // Tidak perlu await — biarkan async, tidak block render
    connect({ connector: miniAppConnector });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  return null;
}

export const WagmiProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProviderBase config={wagmiConfig}>
        <AutoConnect />
        {children}
      </WagmiProviderBase>
    </QueryClientProvider>
  );
};
