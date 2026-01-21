/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect } from "react";
import { useFrameContext } from "~/components/providers/frame-provider";
import { useAccount } from "wagmi";

// --- IMPORTS KOMPONEN UTAMA ---
import { DustDepositView } from "~/components/dust/deposit-view";
import { SwapView } from "~/components/dust/swap-view";
import { VaultView } from "~/components/dust/vault-view";
import { TopBar } from "~/components/top-bar";
import { WalletConnectPrompt } from "~/components/wallet-connect-prompt";
import { BottomNavigation } from "~/components/bottom-navigation";
import { TabType } from "~/types";

export default function Demo() {
  const frameContext = useFrameContext();
  const { isConnected } = useAccount();
  const [activeTab, setActiveTab] = useState<TabType>("deposit");

  return (
    <div style={{ 
      marginTop: (frameContext?.context as any)?.client?.safeAreaInsets?.top ?? 0,
      marginLeft: (frameContext?.context as any)?.client?.safeAreaInsets?.left ?? 0,
      marginRight: (frameContext?.context as any)?.client?.safeAreaInsets?.right ?? 0,
    }}>
      <div className="w-full max-w-lg mx-auto">
        
        {/* --- HEADER --- */}
        <div className="px-4 py-2">
          <TopBar />
        </div>

        {/* --- MAIN CONTENT AREA --- */}
        <div className="px-4 pb-28">
          {!isConnected ? (
            <WalletConnectPrompt />
          ) : (
            <>
              {/* --- KONTEN BERDASARKAN TAB --- */}
              
              {/* TAB 1: DEPOSIT (Scan EOA & Kirim ke Vault) */}
              {activeTab === "deposit" && (
                <div className="animate-in fade-in zoom-in-95 duration-300">
                  <div className="mb-4 pl-1">
                    <h2 className="text-xl font-bold bg-gradient-to-r from-zinc-800 to-zinc-500 bg-clip-text text-transparent dark:from-white dark:to-zinc-400">
                      Deposit Dust
                    </h2>
                    <p className="text-xs text-zinc-500 font-medium">
                      Scan your wallet and move dust to Vault.
                    </p>
                  </div>
                  <DustDepositView />
                </div>
              )}

              {/* TAB 2: SWAP (Eksekusi 0x/Aerodrome) */}
              {activeTab === "swap" && (
                <div className="animate-in fade-in zoom-in-95 duration-300">
                  <div className="mb-4 pl-1">
                    <h2 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                      Sweep & Swap
                    </h2>
                    <p className="text-xs text-zinc-500 font-medium">
                      Convert all vault assets to USDC/ETH.
                    </p>
                  </div>
                  <SwapView /> 
                </div>
               )}    

              {/* TAB 3: VAULT (Lihat Isi Brankas) */}
              {activeTab === "vault" && (
                <div className="animate-in fade-in zoom-in-95 duration-300">
                  <div className="mb-4 pl-1">
                    <h2 className="text-xl font-bold bg-gradient-to-r from-orange-600 to-yellow-600 bg-clip-text text-transparent">
                      My Vault
                    </h2>
                    <p className="text-xs text-zinc-500 font-medium">
                      Assets securely stored in your Smart Account.
                    </p>
                  </div>
                  <VaultView />
                </div>
              )}
            </>
          )}
        </div>

        {/* --- NAVIGASI BAWAH (FIXED) --- */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/80 dark:bg-black/80 backdrop-blur-lg border-t border-zinc-200 dark:border-zinc-800">
           <div className="max-w-lg mx-auto">
             <BottomNavigation 
               activeTab={activeTab}
               onTabChange={setActiveTab}
             />
           </div>
        </div>

      </div>
    </div>
  );
}