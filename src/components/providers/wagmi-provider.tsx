"use client";

import { createConfig, http } from "wagmi";
import { base } from "viem/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiConnector } from "@privy-io/wagmi";

const queryClient = new QueryClient();

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
          showWalletLoginFirst: false, // Kita mau Email, jadi wallet list false dulu
        },
        embeddedWallets: {
          createOnLogin: "users-without-wallets", // INI KUNCINYA: Bikin wallet otomatis saat login email
        },
        // [FIX] Kita set HANYA 'email' sesuai request Mas
        loginMethods: ["email"], 
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