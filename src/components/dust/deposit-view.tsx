"use client";

import { useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { Copy, Refresh, Cube, Wallet } from "iconoir-react";

// IMPORT DUA LIBRARY (SISTEM A & B)
// Pastikan path import sesuai dengan file yang sudah kita buat sebelumnya
import { getZeroDevSmartAccountClient, publicClient as zeroDevPublicClient } from "~/lib/zerodev-smart-account";
import { getCoinbaseSmartAccountClient, coinbasePublicClient } from "~/lib/coinbase-smart-account";

import { SimpleAccountDeposit } from "./simple-account-deposit";
import { SmartAccountDeposit } from "./smart-account-deposit";

// Definisikan 2 Mode
type SystemMode = "ZERODEV" | "COINBASE";

export const DustDepositView = () => {
  const { connector } = useAccount();
  const { data: walletClient } = useWalletClient();

  // DEFAULT KE ZERODEV (Sistem A)
  const [mode, setMode] = useState<SystemMode>("ZERODEV");

  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [vaultBalance, setVaultBalance] = useState<bigint>(0n);
  const [isDeployed, setIsDeployed] = useState(false);
  const [loading, setLoading] = useState(false);

  // LOGIC SWITCHER ALAMAT
  const refreshStatus = async () => {
      if (!walletClient) return;
      setLoading(true);
      try {
        let addr, code, bal;

        if (mode === "ZERODEV") {
            // SISTEM A: ZERODEV (Kernel)
            // Ini yang nanti pake 'SmartAccountDeposit' (UserOp)
            const client = await getZeroDevSmartAccountClient(walletClient);
            addr = client.account.address;
            
            // Cek status di chain Mainnet (via ZeroDev client)
            code = await zeroDevPublicClient.getBytecode({ address: addr });
            bal = await zeroDevPublicClient.getBalance({ address: addr });

        } else {
            // SISTEM B: COINBASE (Yang Anda sebut Simple Account/EOA friendly)
            // Ini yang nanti pake 'SimpleAccountDeposit' (Deploy Manual)
            const client = await getCoinbaseSmartAccountClient(walletClient);
            addr = client.account.address;

            // Cek status di chain Mainnet (via Coinbase client)
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
    refreshStatus();
  }, [walletClient, mode]); // Refresh saat wallet atau mode berubah

  return (
    <div className="max-w-md mx-auto pb-24">
       
       {/* --- TOMBOL SWITCHER (HYBRID) --- */}
       <div className="flex bg-zinc-900 p-1 rounded-xl mb-6 border border-zinc-800">
          <button 
            onClick={() => setMode("ZERODEV")}
            className={`flex-1 py-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${mode === "ZERODEV" ? "bg-purple-600 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            <Cube className="w-4 h-4"/> Sistem A (ZeroDev)
          </button>
          <button 
            onClick={() => setMode("COINBASE")}
            className={`flex-1 py-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${mode === "COINBASE" ? "bg-blue-600 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            <Wallet className="w-4 h-4"/> Sistem B (Coinbase)
          </button>
       </div>

       {/* HEADER ALAMAT */}
       <div className="text-center mb-6">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
            Active Vault Address ({mode})
          </div>
          <div className="text-2xl font-mono font-bold flex justify-center items-center gap-2">
             {loading ? <Refresh className="w-5 h-5 animate-spin"/> : (vaultAddress?.slice(0,6) + "..." + vaultAddress?.slice(-4))}
             {vaultAddress && <Copy className="w-4 h-4 text-zinc-500 cursor-pointer hover:text-white" onClick={() => navigator.clipboard.writeText(vaultAddress)}/>}
          </div>
          <div className="text-xs text-zinc-600 mt-2">
            {mode === "ZERODEV" ? "Kernel Factory" : "Coinbase Factory"}
          </div>
       </div>

       {/* --- RENDER LOGIC --- */}
       
       {mode === "COINBASE" ? (
           // SISTEM B: COINBASE (EOA Friendly)
           // Tampilkan tombol Deploy Manual & Deposit
           <SimpleAccountDeposit 
              vaultAddress={vaultAddress} 
              isDeployed={isDeployed} 
              onUpdate={refreshStatus} 
           />
       ) : (
           // SISTEM A: ZERODEV (Smart UserOp)
           // Tampilkan Deposit (Tanpa Deploy) & Withdraw Gasless
           <>
             {/* Info Deposit untuk ZeroDev */}
             <div className="p-4 bg-zinc-800/50 rounded-xl mb-4 border border-zinc-700 text-center text-xs text-zinc-400">
                Alamat ini menggunakan <strong>ZeroDev Kernel</strong>.<br/>
                Kirim ETH Mainnet ke sini, lalu coba Gasless Withdraw di bawah.
             </div>
             
             {vaultAddress && (
               <SmartAccountDeposit 
                  vaultAddress={vaultAddress} 
                  isDeployed={isDeployed} 
                  balance={vaultBalance}
                  onUpdate={refreshStatus}
               />
             )}
           </>
       )}
    </div>
  );
};