"use client";

import { createConfig, http, WagmiProvider } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { coinbaseWallet, injected } from "wagmi/connectors"; // 🔥 Tambah 'injected'
import type { ReactNode } from "react";

// Setup QueryClient
const queryClient = new QueryClient();

// Setup Wagmi Config
const config = createConfig({
  // 🔥 FIX 1: Taruh baseSepolia PALING ATAS (Jadi Default)
  chains: [baseSepolia, base], 
  
  transports: {
    [baseSepolia.id]: http(),
    [base.id]: http(),
  },
  connectors: [
    // 🔥 FIX 2: Ubah preference ke 'all' (Lebih stabil, tidak maksa popup)
    coinbaseWallet({
      appName: "Nyawit",
      preference: "all", 
    }),
    // 🔥 FIX 3: Tambah opsi Injected (Buat jaga-jaga kalau Smart Wallet bengong)
    injected(), 
  ],
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}