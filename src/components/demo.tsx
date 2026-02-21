/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useFrameContext } from "~/components/providers/frame-provider";
import { WalletConnectPrompt } from "~/components/wallet-connect-prompt";
// --- IMPORTS MAIN COMPONENTS ---
import { DustDepositView } from "~/components/dust/deposit-view";
import { SwapView } from "~/components/dust/swap-view";
import { VaultView } from "~/components/dust/vault-view";
import { TopBar } from "~/components/top-bar"; // TopBar Baru
import { BottomNavigation } from "~/components/bottom-navigation";
import { TabType } from "~/types";
import { ArrowUpRight } from "lucide-react"; // Icon penunjuk

export default function Demo() {
  const frameContext = useFrameContext();
  const { isConnected } = useAccount();
  const [activeTab, setActiveTab] = useState<TabType>("deposit");

  const safeAreaTop = (frameContext?.context as any)?.client?.safeAreaInsets?.top ?? 0;
  
  return (
    <div 
      className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50"
      style={{ paddingTop: safeAreaTop }}
    >
      <div className="w-full max-w-lg mx-auto relative flex flex-col min-h-screen">
        
        {/* HEADER (TopBar Handle Connect) */}
        <div className="sticky top-0 z-20 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
          <TopBar />
        </div>

        <main className="flex-1 px-4 py-6 pb-28 space-y-6">
          
          {/* --- GATEKEEPER LOGIC --- */}
          {!isConnected ? (
            // STATE BELUM CONNECT: Tampilkan Teaser & Penunjuk ke TopBar
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-6 animate-in fade-in zoom-in duration-500">
               
               {/* Animasi Penunjuk ke Tombol Connect */}
               <div className="absolute top-4 right-16 animate-bounce text-blue-500">
                  <ArrowUpRight className="w-8 h-8" />
               </div>

               <div className="min-h-[60vh] flex flex-col justify-center">
               <WalletConnectPrompt />
            </div>

               <div className="space-y-2 max-w-xs mx-auto">
                  <h2 className="text-2xl font-bold">Welcome to Nyawit</h2>
                  <p className="text-zinc-500">
                    Connect your wallet (Rabby, MetaMask, or OKX) via the top right button to access your Smart Vault.
                  </p>
               </div>

               {/* Fitur Teaser (Visual Saja) */}
               <div className="grid grid-cols-3 gap-2 opacity-50 grayscale blur-[1px] select-none pointer-events-none">
                  <div className="h-20 bg-zinc-100 rounded-xl"></div>
                  <div className="h-20 bg-zinc-100 rounded-xl"></div>
                  <div className="h-20 bg-zinc-100 rounded-xl"></div>
               </div>

            </div>
          ) : (
            // SUDAH CONNECT: Tampilkan App Normal
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              
              <div className="mb-6 space-y-1">
                {activeTab === "deposit" && (
                  <>
                    <h2 className="text-2xl font-bold bg-gradient-to-br from-zinc-900 to-zinc-600 bg-clip-text text-transparent dark:from-white dark:to-zinc-400">
                      Deposit Dust
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Scan wallet & move dust to Vault.
                    </p>
                  </>
                )}
                {/* ... (Header tab lain sama) ... */}
                {activeTab === "swap" && (<h2 className="text-2xl font-bold">Swap</h2>)}
                {activeTab === "vault" && (<h2 className="text-2xl font-bold">My Vault</h2>)}
              </div>

              <div className="relative">
                {activeTab === "deposit" && <DustDepositView />}
                {activeTab === "swap" && <SwapView />}
                {activeTab === "vault" && <VaultView />}
              </div>

            </div>
          )}
        </main>

        {isConnected && (
          <div className="fixed bottom-0 left-0 right-0 z-30 flex justify-center pb-safe-area">
             <div className="w-full max-w-lg">
                <BottomNavigation 
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                />
             </div>
          </div>
        )}

      </div>
    </div>
  );
}