"use client";

// src/components/providers/wagmi-provider.tsx

import "@rainbow-me/rainbowkit/styles.css";
import {
  RainbowKitProvider,
  darkTheme,
  connectorsForWallets,
} from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  coinbaseWallet,
  okxWallet,
  rabbyWallet,
  injectedWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http, WagmiProvider as WagmiProviderBase } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConnect, useAccount, useSwitchChain } from "wagmi";
import { useEffect, useState, useRef } from "react";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";

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

// ── Wagmi config dengan farcasterMiniApp connector ────────────────────────────
const connectors = connectorsForWallets(
  [
    { groupName: "Popular", wallets: [coinbaseWallet, metaMaskWallet, okxWallet, rabbyWallet] },
    { groupName: "Other", wallets: [injectedWallet] },
  ],
  {
    appName: "Nyawit",
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "nyawit-placeholder-00000000000",
  }
);

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    ...connectors,
    farcasterMiniApp(), // ← wagmi connector langsung, bukan RainbowKit wallet
  ],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
  ssr: true,
});

// ── ChainWatcher ──────────────────────────────────────────────────────────────
function ChainWatcher() {
  const { chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  if (!isConnected || !chainId) return null;
  if (chainId === base.id || chainId === baseSepolia.id) return null;

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
function AutoConnect() {
  const { connect, connectors } = useConnect();
  const { isConnected } = useAccount();
  const tried = useRef(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || isConnected || tried.current) return;
    tried.current = true;

    const ua = navigator.userAgent || "";
    const win = window as any;

    const isFarcaster =
      !!win.FrameSDK ||
      !!win.farcaster ||
      ua.includes("Farcaster") ||
      ua.includes("Warpcast");

    const isCoinbaseApp =
      !!win.__cbswDetected ||
      ua.includes("CoinbaseWallet") ||
      ua.includes("CoinbaseBrowser") ||
      (!!win.ethereum && !!win.ethereum.isCoinbaseWallet);

    if (isFarcaster) {
      const fc = connectors.find(
        (c) =>
          c.id === "farcaster-miniapp" ||
          c.id === "farcaster" ||
          c.name?.toLowerCase().includes("farcaster")
      );
      if (fc) {
        console.log("[AutoConnect] Farcaster miniapp, connecting:", fc.id);
        connect({ connector: fc });
      } else {
        console.warn("[AutoConnect] Farcaster connector not found. Available:", connectors.map(c => c.id));
      }
      return;
    }

    if (isCoinbaseApp) {
      const cb = connectors.find(
        (c) =>
          c.id === "coinbaseWallet" ||
          c.id === "coinbaseWalletSDK" ||
          c.name?.toLowerCase().includes("coinbase")
      );
      if (cb) {
        console.log("[AutoConnect] Coinbase Base App, connecting:", cb.id);
        connect({ connector: cb });
      }
    }
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