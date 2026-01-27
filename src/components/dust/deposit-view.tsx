"use client";

import { useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi"; 
import { Copy, Refresh, WarningTriangle, Wallet, UserCircle } from "iconoir-react"; // Icon baru

import { getCoinbaseSmartAccountClient, coinbasePublicClient } from "~/lib/smart-account";
import { useFrameContext } from "~/components/providers/frame-provider";

import { SimpleAccountDeposit } from "./eoa-account-deposit";
import { SmartAccountDeposit } from "./smart-account-deposit";
import { TokenList } from "./token-list";

// Kita ganti nama tipe-nya biar jelas
type AppMode = "EOA_WRAPPER" | "SMART_WALLET";

export const DustDepositView = () => {
  const { data: walletClient } = useWalletClient();
  const { connector } = useAccount(); 
  const frameContext = useFrameContext();
  
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [vaultBalance, setVaultBalance] = useState<bigint>(0n);
  const [isDeployed, setIsDeployed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Default mode
  const [mode, setMode] = useState<AppMode>("EOA_WRAPPER");

  // Deteksi Otomatis
  useEffect(() => {
    if (frameContext?.isInMiniApp) {
        setMode("SMART_WALLET"); // Farcaster
    } else {
        // Cek jika wallet aslinya adalah Smart Wallet (Coinbase App)
        if (connector?.id === 'coinbaseWalletSDK' || connector?.id === 'coinbaseWallet') {
            setMode("SMART_WALLET");
        } else {
            setMode("EOA_WRAPPER"); // Metamask, Rabby, dll
        }
    }
  }, [frameContext, connector?.id]);

  const refreshStatus = async () => {
      if (!walletClient) return;
      setLoading(true);
      try {
        // 🟢 PENTING: Baik EOA maupun Smart Wallet kita paksa lewat Coinbase Factory
        // Tujuannya: 
        // 1. Agar Rabby TIDAK Raw Sign (karena Coinbase support EIP-712).
        // 2. Agar alamat Vault SAMA di kedua platform.
        
        const client = await getCoinbaseSmartAccountClient(walletClient);
        const addr = client.account.address;
        
        const code = await coinbasePublicClient.getBytecode({ address: addr });
        const bal = await coinbasePublicClient.getBalance({ address: addr });

        setVaultAddress(addr);
        setIsDeployed(code !== undefined && code !== null && code !== "0x");
        setVaultBalance(bal);
        
      } catch (e) { console.error("Status Check Error:", e); }
      finally { setLoading(false); }
  };

  useEffect(() => {
    if (walletClient) {
        refreshStatus();
    }
  }, [walletClient, mode]); 

  if (!frameContext) {
    return <div className="text-center py-20 text-zinc-500 text-xs">Loading Environment...</div>;
  }

  const { isInMiniApp } = frameContext;

  return (
    <div className="max-w-md mx-auto pb-24">
       
       {/* SWITCHER MANUAL (Hanya muncul jika di Browser/Rabby) */}
       {!isInMiniApp && (
          <div className="flex justify-center mb-6">
              <div className="bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl flex text-[10px] font-bold border border-zinc-200 dark:border-zinc-800 w-full max-w-[300px]">
                  <button 
                    onClick={() => setMode("EOA_WRAPPER")}
                    className={`flex-1 py-2 rounded-lg flex justify-center items-center gap-2 transition-all ${mode === "EOA_WRAPPER" ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-white ring-1 ring-black/5" : "text-zinc-400 hover:text-zinc-600"}`}
                  >
                    <UserCircle className="w-4 h-4"/> EOA (Rabby)
                  </button>
                  <button 
                    onClick={() => setMode("SMART_WALLET")}
                    className={`flex-1 py-2 rounded-lg flex justify-center items-center gap-2 transition-all ${mode === "SMART_WALLET" ? "bg-blue-600 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}
                  >
                    <Wallet className="w-4 h-4"/> Smart Wallet
                  </button>
              </div>
          </div>
       )}

       {/* HEADER INFO */}
       <div className="text-center mb-6">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1 flex items-center justify-center gap-1">
            Active Vault 
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${mode === "SMART_WALLET" ? "bg-blue-100 text-blue-700" : "bg-zinc-200 text-zinc-700"}`}>
                {mode === "SMART_WALLET" ? "Smart Wallet" : "EOA Wrapper"}
            </span>
          </div>
          <div className="text-2xl font-mono font-bold flex justify-center items-center gap-2">
             {loading ? <Refresh className="w-5 h-5 animate-spin"/> : (vaultAddress ? (vaultAddress.slice(0,6) + "..." + vaultAddress.slice(-4)) : "...")}
             {vaultAddress && <Copy className="w-4 h-4 text-zinc-500 cursor-pointer hover:text-white" onClick={() => navigator.clipboard.writeText(vaultAddress)}/>}
          </div>
       </div>

       {/* KONTEN */}
       <div className="animate-in fade-in duration-300">
           {/* 1. Bagian Deposit dari Dompet Asli */}
           <SimpleAccountDeposit 
              vaultAddress={vaultAddress} 
              isDeployed={isDeployed} 
              onUpdate={refreshStatus} 
           />
           
           {/* 2. Bagian Withdraw/Manage Vault (Hanya jika vault aktif) */}
           {vaultAddress && isDeployed && (
               <SmartAccountDeposit 
                  vaultAddress={vaultAddress} 
                  isDeployed={isDeployed} 
                  balance={vaultBalance}
                  onUpdate={refreshStatus}
                  systemType="COINBASE" // Kita pakai infrastruktur Coinbase untuk keduanya
               />
           )}
       </div>

       <TokenList address={vaultAddress} />

    </div>
  );
};