/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState } from "react";
import { useAccount, useDisconnect } from "wagmi"; // [TAMBAH] useDisconnect
import { usePrivy } from "@privy-io/react-auth";
import { useFrameContext } from "~/components/providers/frame-provider";
import { LogOut } from "lucide-react";

// --- IMPORTS MAIN COMPONENTS ---
import { DustDepositView } from "~/components/dust/deposit-view";
import { SwapView } from "~/components/dust/swap-view";
import { VaultView } from "~/components/dust/vault-view";
import { TopBar } from "~/components/top-bar";
import { WalletConnectPrompt } from "~/components/wallet-connect-prompt";
import { BottomNavigation } from "~/components/bottom-navigation";
import { Button } from "~/components/ui/button"; 
import { TabType } from "~/types";

export default function Demo() {
  const frameContext = useFrameContext();
  const { isConnected } = useAccount();
  const { logout } = usePrivy();
  const { disconnect } = useDisconnect(); // [TAMBAH] Hook disconnect wagmi
  
  const [activeTab, setActiveTab] = useState<TabType>("deposit");

  // [LOGIC BARU] Fungsi Disconnect Total
  const handleDisconnect = async () => {
    try {
        await logout(); // 1. Logout Privy
        disconnect();   // 2. Putus Koneksi Wagmi
        // Opsional: Reload halaman agar bersih total
        // window.location.reload(); 
    } catch (e) {
        console.error("Disconnect failed:", e);
    }
  };

  const safeAreaTop = (frameContext?.context as any)?.client?.safeAreaInsets?.top ?? 0;
  const safeAreaLeft = (frameContext?.context as any)?.client?.safeAreaInsets?.left ?? 0;
  const safeAreaRight = (frameContext?.context as any)?.client?.safeAreaInsets?.right ?? 0;

  return (
    <div 
      className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50"
      style={{ 
        paddingTop: safeAreaTop,
        paddingLeft: safeAreaLeft,
        paddingRight: safeAreaRight,
      }}
    >
      <div className="w-full max-w-lg mx-auto relative flex flex-col min-h-screen">
        
        <div className="sticky top-0 z-20 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
          <TopBar />
        </div>

        <main className="flex-1 px-4 py-6 pb-28 space-y-6">
          
          {!isConnected ? (
            <div className="flex flex-col items-center justify-center min-h-[40vh] animate-in fade-in zoom-in duration-500">
               <WalletConnectPrompt />
            </div>
          ) : (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              
              {/* TOMBOL DISCONNECT YANG SUDAH DIPERBAIKI */}
              <div className="flex justify-end mb-4">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={handleDisconnect} // [FIX] Panggil fungsi baru
                  className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 gap-2 px-2"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="text-xs font-semibold">Disconnect</span>
                </Button>
              </div>
              
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
                
                {activeTab === "swap" && (
                  <>
                    <h2 className="text-2xl font-bold bg-gradient-to-br from-blue-600 to-violet-600 bg-clip-text text-transparent">
                      Sweep & Swap
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Convert assets to USDC or ETH.
                    </p>
                  </>
                )}

                {activeTab === "vault" && (
                  <>
                    <h2 className="text-2xl font-bold bg-gradient-to-br from-amber-500 to-orange-600 bg-clip-text text-transparent">
                      My Vault
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Secure Smart Account Storage.
                    </p>
                  </>
                )}
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