/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState } from "react";
import { useFrameContext } from "~/components/providers/frame-provider";
import { useAccount } from "wagmi";

// --- IMPORTS KOMPONEN UTAMA ---
import { DustDepositView } from "~/components/dust/deposit-view";
import { SwapView } from "~/components/dust/swap-view";
import { VaultView } from "~/components/dust/vault-view";
// Catatan: Jika kamu rename file swap-nya jadi swap-view.tsx, sesuaikan importnya.

import { TopBar } from "~/components/top-bar";
import { WalletConnectPrompt } from "~/components/wallet-connect-prompt";
import { BottomNavigation } from "~/components/bottom-navigation";
import { TabType } from "~/types";

export default function Demo() {
  const frameContext = useFrameContext();
  const { isConnected } = useAccount();
  
  // Default tab = Deposit (User pertama masuk mau deposit dulu)
  const [activeTab, setActiveTab] = useState<TabType>("deposit");

  return (
    <div style={{ 
      marginTop: (frameContext?.context as any)?.client?.safeAreaInsets?.top ?? 0,
      marginLeft: (frameContext?.context as any)?.client?.safeAreaInsets?.left ?? 0,
      marginRight: (frameContext?.context as any)?.client?.safeAreaInsets?.right ?? 0,
    }}>
      <div className="w-full max-w-lg mx-auto">
        <div className="px-4 py-4">
          <TopBar />
        </div>

        <div className="px-4 pb-24">
          {!isConnected ? (
            <WalletConnectPrompt />
          ) : (
            <>
              {/* --- KONTEN BERDASARKAN TAB --- */}
              
              {/* TAB 1: DEPOSIT (Scan EOA & Kirim ke Vault) */}
              {activeTab === "deposit" && (
                <div className="animate-fade-in">
                  <div className="mb-4">
                    <h2 className="text-xl font-bold">Deposit Dust</h2>
                    <p className="text-xs text-zinc-500">Scan your wallet and move dust to Vault.</p>
                  </div>
                  <DustDepositView />
                </div>
              )}

              {/* TAB 2: SWAP (Eksekusi 0x) */}
              {activeTab === "swap" && (
                <div className="animate-fade-in">
                  <div className="mb-4">
                    <h2 className="text-xl font-bold">Sweep & Swap</h2>
                    <p className="text-xs text-zinc-500">Convert all vault assets to USDC/ETH.</p>
                  </div>
                  {/* Gunakan komponen swap yang sudah ada */}
                  <SwapView /> 
                </div>
               )}    

              {/* TAB 3: VAULT (Lihat Isi Brankas) */}
              {activeTab === "vault" && (
                <div className="animate-fade-in">
                  <div className="mb-4">
                    <h2 className="text-xl font-bold">My Vault</h2>
                    <p className="text-xs text-zinc-500">Assets securely stored in your Smart Account.</p>
                  </div>
                  <VaultView />
                </div>
              )}
            </>
          )}
        </div>

        {/* --- NAVIGASI BAWAH --- */}
        <BottomNavigation 
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>
    </div>
  );
}