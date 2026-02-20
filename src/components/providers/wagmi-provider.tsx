"use client";

import "@rainbow-me/rainbowkit/styles.css";
import {
  RainbowKitProvider,
  darkTheme,
  getDefaultConfig,
} from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  coinbaseWallet,
  okxWallet,
  rabbyWallet,
  injectedWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { WagmiProvider as WagmiProviderBase } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConnect, useAccount } from "wagmi";
import { useEffect, useState } from "react";

// EIP-6963 detection
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

// [FIX] Hapus walletConnectWallet dari daftar — tidak butuh projectId
// OKX, Rabby, MetaMask, Coinbase semua injected, tidak butuh WalletConnect
export const wagmiConfig = getDefaultConfig({
  appName: "Nyawit",
  // [FIX] Pakai placeholder — RainbowKit perlu string non-empty
  // tapi karena kita tidak include walletConnectWallet, tidak dipakai
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "nyawit-placeholder-00000000000",
  chains: [base],
  wallets: [
    {
      groupName: "Popular",
      wallets: [
        coinbaseWallet,
        metaMaskWallet,
        okxWallet,
        rabbyWallet,
        // walletConnectWallet DIHAPUS — ini yang butuh projectId valid
      ],
    },
    {
      groupName: "Other",
      wallets: [injectedWallet],
    },
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
          locale="en-US"
        >
          <AutoConnect />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProviderBase>
  );
}
