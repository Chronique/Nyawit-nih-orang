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
import { coinbaseWallet, injected } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";
import { useEffect, useRef } from "react";

const queryClient = new QueryClient();

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    farcasterMiniApp(),  // index 0 — prioritas di Base App / Farcaster
    coinbaseWallet({
      appName: "Nyawit Nih Orang",
      preference: "smartWalletOnly",
    }),
    injected(),          // Rabby, MetaMask, dll
  ],
  transports: {
    [base.id]: http("https://mainnet.base.org"),
  },
});

// -----------------------------------------------------------------------------
// AutoConnect: saat app pertama mount, coba connect ke farcasterMiniApp.
// Di dalam Base App / Farcaster ini langsung berhasil tanpa interaksi user.
// Di browser biasa akan gagal diam-diam (tidak throw), lalu user bisa klik Connect.
// -----------------------------------------------------------------------------
function AutoConnect() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  // Pakai ref agar tidak trigger ulang jika parent re-render
  const attempted = useRef(false);

  useEffect(() => {
    // Sudah connect atau sudah pernah dicoba → skip
    if (isConnected || attempted.current) return;
    attempted.current = true;

    const miniAppConnector = connectors[0]; // selalu farcasterMiniApp
    if (!miniAppConnector) return;

    // Tidak await — biar tidak block render.
    // Kalau gagal (misal di browser biasa), silent fail.
    connect({ connector: miniAppConnector });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Hanya run sekali saat mount

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
