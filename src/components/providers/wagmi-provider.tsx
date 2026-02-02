"use client";

import { createConfig, http } from "wagmi";
import { base } from "viem/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiConnector } from "@privy-io/wagmi";

const queryClient = new QueryClient();

// Konfigurasi Wagmi Standar
const wagmiConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(),
  },
});

export const WagmiProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ""}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#676FFF",
          // [PENTING] Tampilkan list wallet (Rabby/MetaMask) paling atas
          showWalletLoginFirst: true, 
          logo: "https://nyawit-nih-orang.vercel.app/icon.png", // Opsional: Logo App Anda
        },
        embeddedWallets: {
          createOnLogin: "users-without-wallets", 
        },
        // [PENTING] Izinkan semua metode login yang relevan
        // 'wallet' = Rabby, Metamask, dll
        // 'email' = Privy Embedded Wallet
        // 'farcaster' = Kita simpan sbg opsi backup, tapi tidak auto-trigger
        loginMethods: ["wallet", "email", "farcaster"], 
      }}
    >
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiConnector config={wagmiConfig}>
            {children}
        </PrivyWagmiConnector>
      </QueryClientProvider>
    </PrivyProvider>
  );
};