"use client";

// src/components/providers/wagmi-provider.tsx
// Updated: Base Sepolia untuk testing

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, coinbaseWallet, okxWallet, rabbyWallet, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { WagmiProvider as WagmiProviderBase } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConnect, useAccount } from "wagmi";
import { useEffect, useState } from "react";

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event: Event) => {
    const info = (event as CustomEvent).detail?.info;
    if (!info) return;
    const rdns = (info.rdns ?? "").toLowerCase();
    const name = (info.name ?? "").toLowerCase();
    if (rdns.includes("coinbase") || name.includes("coinbase")) {
      (window as any).__cbswDetected = true;
    }
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export const wagmiConfig = getDefaultConfig({
  appName: "Nyawit",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "nyawit-placeholder-00000000000",
  // Include both — ganti IS_TESTNET di smart-account.ts untuk switch
  chains: [baseSepolia, base],
  wallets: [
    {
      groupName: "Popular",
      wallets: [coinbaseWallet, metaMaskWallet, okxWallet, rabbyWallet],
    },
    { groupName: "Other", wallets: [injectedWallet] },
  ],
  ssr: true,
});

function AutoConnect() {
  const { connect, connectors } = useConnect();
  const { isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || isConnected) return;
    const isFarcaster =
      !!(window as any).FrameSDK ||
      !!(window as any).farcaster ||
      navigator.userAgent?.includes("Farcaster") ||
      navigator.userAgent?.includes("Warpcast");
    if (!isFarcaster) return;
    const fc = connectors.find(
      (c) => c.id === "farcaster" || c.name?.toLowerCase().includes("farcaster")
    );
    if (fc) connect({ connector: fc });
  }, [mounted, isConnected, connectors, connect]);

  return null;
}

const queryClient = new QueryClient();

export function WagmiProvider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProviderBase config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#2563eb",
            accentColorForeground: "white",
            borderRadius: "large",
            fontStack: "system",
            overlayBlur: "small",
          })}
          modalSize="compact"
        >
          <AutoConnect />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProviderBase>
  );
}
