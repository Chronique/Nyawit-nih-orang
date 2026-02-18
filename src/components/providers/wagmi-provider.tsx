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
// ✅ farcasterMiniApp tidak menarik @reown/appkit — aman untuk webpack
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { useEffect, useRef } from "react";

const queryClient = new QueryClient();

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    farcasterMiniApp(), // index 0 — auto-connect di Base App / Farcaster
    injected(),         // Rabby, MetaMask, dll di browser biasa
    // ⚠️  coinbaseWallet sengaja dihapus — menarik @reown/appkit yang break webpack
    // Kalau butuh Coinbase Smart Wallet di browser, gunakan extension Coinbase Wallet
    // yang akan terbaca sebagai injected connector
  ],
  transports: {
    [base.id]: http("https://mainnet.base.org"),
  },
});

// -----------------------------------------------------------------------------
// AutoConnect: saat app mount di dalam Farcaster / Base App,
// langsung connect ke wallet user tanpa perlu klik tombol apapun
// -----------------------------------------------------------------------------
function AutoConnect() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const attempted = useRef(false);

  useEffect(() => {
    if (isConnected || attempted.current) return;
    attempted.current = true;

    const miniAppConnector = connectors[0]; // selalu farcasterMiniApp
    if (!miniAppConnector) return;

    // Silent fail kalau bukan di Farcaster/Base App
    connect({ connector: miniAppConnector });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
