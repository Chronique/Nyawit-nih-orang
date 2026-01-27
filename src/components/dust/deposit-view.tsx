"use client";

import { useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi"; 
import { Copy, Refresh, WarningTriangle, Cube, Wallet } from "iconoir-react";

// ZeroDev import di-disable atau tidak dipakai di logic bawah
import { getZeroDevSmartAccountClient, publicClient as zeroDevPublicClient } from "~/lib/zerodev-smart-account";
import { getCoinbaseSmartAccountClient, coinbasePublicClient } from "~/lib/coinbase-smart-account";
import { useFrameContext } from "~/components/providers/frame-provider";

import { SimpleAccountDeposit } from "./simple-account-deposit";
import { SmartAccountDeposit } from "./smart-account-deposit";
import { TokenList } from "./token-list";

export const DustDepositView = () => {
  const { data: walletClient } = useWalletClient();
  const { connector } = useAccount(); 
  const frameContext = useFrameContext();
  
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [vaultBalance, setVaultBalance] = useState<bigint>(0n);
  const [isDeployed, setIsDeployed] = useState(false);
  const [loading, setLoading] = useState(false);

  const [mode, setMode] = useState<"COINBASE" | "ZERODEV">("ZERODEV");

  useEffect(() => {
    if (frameContext?.isInMiniApp) {
        setMode("COINBASE");
    } else {
        if (connector?.id === 'coinbaseWalletSDK' || connector?.id === 'coinbaseWallet') {
            setMode("COINBASE");
        } else {
            setMode("ZERODEV");
        }
    }
  }, [frameContext, connector?.id]);

  const refreshStatus = async () => {
      if (!walletClient) return;
      setLoading(true);
      try {
        let addr, code, bal;

        // [UBAH DI SINI]
        if (mode === "ZERODEV") {
            // 🟢 TEMPORARY: Mode ZeroDev dialihkan ke Coinbase Smart Wallet
            // agar vault address SAMA dengan Farcaster dan bypass isu raw sign.
            const client = await getCoinbaseSmartAccountClient(walletClient);
            addr = client.account.address;
            // Gunakan coinbasePublicClient karena kita pakai factory coinbase
            code = await coinbasePublicClient.getBytecode({ address: addr });
            bal = await coinbasePublicClient.getBalance({ address: addr });
        } else {
            const client = await getCoinbaseSmartAccountClient(walletClient);
            addr = client.account.address;
            code = await coinbasePublicClient.getBytecode({ address: addr });
            bal = await coinbasePublicClient.getBalance({ address: addr });
        }

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
    return (
      <div className="max-w-md mx-auto py-20 text-center space-y-4">
        <div className="w-8 h-8 border-4 border-zinc-300 border-t-blue-500 rounded-full animate-spin mx-auto"></div>
        <p className="text-xs text-zinc-500">Detecting Environment...</p>
      </div>
    );
  }

  const { isInMiniApp } = frameContext;

  return (
    <div className="max-w-md mx-auto pb-24">
       
       {/* WARNING KHUSUS SYSTEM A (Sekarang dialihkan ke Coinbase) */}
       {!isInMiniApp && mode === "ZERODEV" && (
         <div className="bg-orange-500/10 border border-orange-500 text-orange-600 dark:text-orange-400 p-3 rounded-xl mb-4 flex items-start gap-3 text-xs">
            <WarningTriangle className="w-5 h-5 shrink-0" />
            <div>
               <strong>Using System A (External Wallet).</strong><br/>
               Vault is synced with Farcaster (via Coinbase Infra).<br/>
               <span className="opacity-70 font-mono text-[10px]">ZeroDev disabled temporarily due to sign issues.</span>
            </div>
         </div>
       )}

       {/* HEADER & SWITCHER */}
       <div className="text-center mb-6">
          {!isInMiniApp && (
              <div className="flex justify-center mb-4">
                  <div className="bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg flex text-[10px] font-bold border border-zinc-200 dark:border-zinc-800">
                      <button 
                        onClick={() => setMode("ZERODEV")}
                        className={`px-3 py-1.5 rounded-md flex items-center gap-1 transition-all ${mode === "ZERODEV" ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-white" : "text-zinc-400 hover:text-zinc-600"}`}
                      >
                        <Cube className="w-3 h-3"/> System A
                      </button>
                      <button 
                        onClick={() => setMode("COINBASE")}
                        className={`px-3 py-1.5 rounded-md flex items-center gap-1 transition-all ${mode === "COINBASE" ? "bg-blue-600 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-600"}`}
                      >
                        <Wallet className="w-3 h-3"/> System B
                      </button>
                  </div>
              </div>
          )}

          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
            Active Vault Address ({mode === "ZERODEV" ? "Sys A" : "Sys B"})
          </div>
          <div className="text-2xl font-mono font-bold flex justify-center items-center gap-2">
             {loading ? <Refresh className="w-5 h-5 animate-spin"/> : (vaultAddress ? (vaultAddress.slice(0,6) + "..." + vaultAddress.slice(-4)) : "...")}
             {vaultAddress && <Copy className="w-4 h-4 text-zinc-500 cursor-pointer hover:text-white" onClick={() => navigator.clipboard.writeText(vaultAddress)}/>}
          </div>
       </div>

       {/* KONTEN */}
       {/* Karena kedua mode sekarang pakai Coinbase, kita bisa sederhanakan render-nya atau biarkan struktur ini */}
       <div className="animate-in fade-in duration-300">
           <SimpleAccountDeposit 
              vaultAddress={vaultAddress} 
              isDeployed={isDeployed} 
              onUpdate={refreshStatus} 
           />
           
           {vaultAddress && isDeployed && (
               <SmartAccountDeposit 
                  vaultAddress={vaultAddress} 
                  isDeployed={isDeployed} 
                  balance={vaultBalance}
                  onUpdate={refreshStatus}
                  systemType="COINBASE" // Paksa tipe ke COINBASE di komponen internal
               />
           )}
       </div>

       <TokenList address={vaultAddress} />

    </div>
  );
};