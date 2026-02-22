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
import { TanamView } from "~/components/dust/tanam-view";
import { TopBar } from "~/components/top-bar";
import { BottomNavigation } from "~/components/bottom-navigation";
import { TabType } from "~/types";
import { ArrowUpRight } from "lucide-react";

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

        {/* HEADER */}
        <div className="sticky top-0 z-20 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
          <TopBar />
        </div>

        <main className="flex-1 px-4 py-6 pb-28 space-y-6">

          {!isConnected ? (
            // Belum connect
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-6 animate-in fade-in zoom-in duration-500">
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

              <div className="grid grid-cols-3 gap-2 opacity-50 grayscale blur-[1px] select-none pointer-events-none">
                <div className="h-20 bg-zinc-100 rounded-xl"></div>
                <div className="h-20 bg-zinc-100 rounded-xl"></div>
                <div className="h-20 bg-zinc-100 rounded-xl"></div>
              </div>
            </div>

          ) : (
            // Sudah connect
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">

              {/* Tab title */}
              <div className="mb-6 space-y-1">
                {activeTab === "deposit" && (
                  <>
                    <h2 className="text-2xl font-bold bg-gradient-to-br from-zinc-900 to-zinc-600 bg-clip-text text-transparent dark:from-white dark:to-zinc-400">
                      Blusukan
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Scan wallet & pindahkan dust ke Vault.
                    </p>
                  </>
                )}
                {activeTab === "swap" && (
                  <>
                    <h2 className="text-2xl font-bold text-orange-600">Bakar Wilayah</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Swap semua dust token ke ETH.
                    </p>
                  </>
                )}
                {activeTab === "tanam" && (
                  <>
                    <h2 className="text-2xl font-bold text-green-600">Tanam</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Deposit USDC / WETH ke Morpho, earn yield otomatis.
                    </p>
                  </>
                )}
                {activeTab === "vault" && (
                  <>
                    <h2 className="text-2xl font-bold text-yellow-600">Panen</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Kelola aset di Smart Vault kamu.
                    </p>
                  </>
                )}
              </div>

              {/* Tab content */}
              <div className="relative">
                {activeTab === "deposit" && <DustDepositView />}
                {activeTab === "swap"    && <SwapView />}
                {activeTab === "tanam"   && <TanamView />}
                {activeTab === "vault"   && <VaultView />}
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
