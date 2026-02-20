"use client";

// src/components/providers/wagmi-provider.tsx

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, coinbaseWallet, okxWallet, rabbyWallet, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { WagmiProvider as WagmiProviderBase } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConnect, useAccount, useSwitchChain } from "wagmi";
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
  chains: [baseSepolia, base], // Sepolia duluan = default
  wallets: [
    { groupName: "Popular", wallets: [coinbaseWallet, metaMaskWallet, okxWallet, rabbyWallet] },
    { groupName: "Other", wallets: [injectedWallet] },
  ],
  ssr: true,
});

// ── ChainWatcher ──────────────────────────────────────────────────────────────
// Otomatis ikut chain wallet. Kalau wallet switch ke Base → app pakai Base.
// Kalau wallet switch ke Sepolia → app pakai Sepolia.
// Kalau chain tidak didukung sama sekali → tampil banner merah + tombol switch.
//
// Tidak perlu lakukan apa-apa untuk chain yang SUPPORTED karena:
// - useAccount().chainId sudah reaktif
// - Semua komponen (deposit, vault, swap) sudah pakai chainId dari useAccount()
// - Mereka otomatis re-fetch data ketika chainId berubah
function ChainWatcher() {
  const { chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  if (!isConnected || !chainId) return null;

  const isSupported = chainId === base.id || chainId === baseSepolia.id;
  if (isSupported) return null;

  // Chain tidak dikenal — tampil banner
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white text-xs font-bold py-2 flex items-center justify-center gap-3 shadow-lg">
      ⚠ Chain tidak didukung (ID: {chainId})
      <button
        onClick={() => switchChainAsync({ chainId: baseSepolia.id })}
        className="underline hover:no-underline ml-1"
      >
        Switch ke Base Sepolia
      </button>
      <span className="opacity-60">atau</span>
      <button
        onClick={() => switchChainAsync({ chainId: base.id })}
        className="underline hover:no-underline"
      >
        Base Mainnet
      </button>
    </div>
  );
}

// ── AutoConnect (Farcaster) ───────────────────────────────────────────────────
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
          <ChainWatcher />
          <AutoConnect />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProviderBase>
  );
}
