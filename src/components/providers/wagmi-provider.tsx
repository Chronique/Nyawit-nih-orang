"use client";

import { WagmiProvider as WagmiProviderBase, createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet, metaMask } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useConnect } from "wagmi";

// ── EIP-6963 listener: detect Coinbase Smart Wallet sebelum wagmi init ──────
// Coinbase Smart Wallet di web inject via EIP-6963, bukan window.ethereum langsung
// Ini yang bikin detection sebelumnya gagal (cuma cek isCoinbaseWallet)
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event: any) => {
    const info = event.detail?.info;
    if (!info) return;
    const name: string = (info.name ?? "").toLowerCase();
    const rdns: string = (info.rdns ?? "").toLowerCase();
    if (rdns.includes("coinbase") || name.includes("coinbase")) {
      (window as any).__cbswDetected = true;
      console.log("[EIP-6963] Coinbase provider detected:", info.name, rdns);
    }
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

// ── Wagmi config ─────────────────────────────────────────────────────────────
export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    coinbaseWallet({
      appName: "Nyawit",
      preference: "smartWalletOnly",
    }),
    metaMask(),
  ],
  transports: {
    [base.id]: http("https://mainnet.base.org"),
  },
});

const queryClient = new QueryClient();

// ── AutoConnect: fixed hydration ─────────────────────────────────────────────
function AutoConnect() {
  const { connect, connectors } = useConnect();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    const farcasterConnector = connectors.find(
      (c) => c.id === "farcaster" || c.name?.toLowerCase().includes("farcaster")
    );
    if (farcasterConnector) connect({ connector: farcasterConnector });
  }, [mounted]);

  return null;
}

// ── Export dengan nama WagmiProvider agar tidak break providers.tsx ──────────
export function WagmiProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProviderBase config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AutoConnect />
        {children}
      </QueryClientProvider>
    </WagmiProviderBase>
  );
}
