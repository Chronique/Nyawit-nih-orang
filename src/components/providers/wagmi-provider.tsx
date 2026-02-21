"use client";

// src/components/providers/wagmi-provider.tsx

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, coinbaseWallet, okxWallet, rabbyWallet, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { WagmiProvider as WagmiProviderBase } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConnect, useAccount, useSwitchChain } from "wagmi";
import { useEffect, useState, useRef } from "react";

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
  chains: [base, baseSepolia],
  wallets: [
    { groupName: "Popular", wallets: [coinbaseWallet, metaMaskWallet, okxWallet, rabbyWallet] },
    { groupName: "Other", wallets: [injectedWallet] },
  ],
  ssr: true,
});

// ── ChainWatcher ──────────────────────────────────────────────────────────────
function ChainWatcher() {
  const { chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  if (!isConnected || !chainId) return null;

  const isSupported = chainId === base.id || chainId === baseSepolia.id;
  if (isSupported) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white text-xs font-bold py-2 flex items-center justify-center gap-3 shadow-lg">
      ⚠ Unsupported network (Chain ID: {chainId})
      <button onClick={() => switchChainAsync({ chainId: base.id })} className="underline hover:no-underline ml-1">
        Switch to Base
      </button>
    </div>
  );
}

// ── AutoConnect ───────────────────────────────────────────────────────────────
// Prioritas:
// 1. Farcaster miniapp  → pakai connector farcaster
// 2. Coinbase Base App  → pakai connector coinbasewallet / injected
// 3. Browser biasa      → jangan auto connect, biarkan user pilih sendiri
function AutoConnect() {
  const { connect, connectors } = useConnect();
  const { isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  const tried = useRef(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || isConnected || tried.current) return;
    tried.current = true;

    const ua = navigator.userAgent || "";
    const win = window as any;

    // Deteksi Farcaster / Warpcast miniapp
    const isFarcaster =
      !!win.FrameSDK ||
      !!win.farcaster ||
      ua.includes("Farcaster") ||
      ua.includes("Warpcast");

    // Deteksi Coinbase Base App / Coinbase Wallet in-app browser
    const isCoinbaseApp =
      !!win.__cbswDetected ||
      ua.includes("CoinbaseWallet") ||
      ua.includes("CoinbaseBrowser") ||
      (!!win.ethereum && !!win.ethereum.isCoinbaseWallet);

    if (isFarcaster) {
      // Cari connector farcaster
      const fc = connectors.find(
        (c) => c.id === "farcaster" || c.name?.toLowerCase().includes("farcaster")
      );
      if (fc) {
        console.log("[AutoConnect] Farcaster detected, connecting...");
        connect({ connector: fc });
      }
      return;
    }

    if (isCoinbaseApp) {
      // Cari coinbase connector
      const cb = connectors.find(
        (c) =>
          c.id === "coinbaseWallet" ||
          c.id === "coinbaseWalletSDK" ||
          c.name?.toLowerCase().includes("coinbase")
      );
      if (cb) {
        console.log("[AutoConnect] Coinbase Base App detected, connecting...");
        connect({ connector: cb });
      }
      return;
    }

    // Browser biasa — tidak auto connect
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