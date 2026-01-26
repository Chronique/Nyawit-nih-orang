"use client";

import { useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { Copy, Refresh, Cube, Wallet } from "iconoir-react";

import { getZeroDevSmartAccountClient, publicClient as zeroDevPublicClient } from "~/lib/zerodev-smart-account";
import { getCoinbaseSmartAccountClient, coinbasePublicClient } from "~/lib/coinbase-smart-account";

import { SimpleAccountDeposit } from "./simple-account-deposit";
import { SmartAccountDeposit } from "./smart-account-deposit";
import { TokenList } from "./token-list";

type SystemMode = "ZERODEV" | "COINBASE";

export const DustDepositView = () => {
  const { connector } = useAccount();
  const { data: walletClient } = useWalletClient();

  const [mode, setMode] = useState<SystemMode>("COINBASE"); // Default ke COINBASE biar langsung ketemu saldo lama

  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [vaultBalance, setVaultBalance] = useState<bigint>(0n);
  const [isDeployed, setIsDeployed] = useState(false);
  const [loading, setLoading] = useState(false);

  const refreshStatus = async () => {
      if (!walletClient) return;
      setLoading(true);
      try {
        let addr, code, bal;

        if (mode === "ZERODEV") {
            const client = await getZeroDevSmartAccountClient(walletClient);
            addr = client.account.address;
            code = await zeroDevPublicClient.getBytecode({ address: addr });
            bal = await zeroDevPublicClient.getBalance({ address: addr });
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
    refreshStatus();
  }, [walletClient, mode]);

  return (
    <div className="max-w-md mx-auto pb-24">
       
       {/* SWITCHER */}
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

       {/* HEADER */}
       <div className="text-center mb-6">
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
            Active Vault Address ({mode})
          </div>
          <div className="text-2xl font-mono font-bold flex justify-center items-center gap-2">
             {loading ? <Refresh className="w-5 h-5 animate-spin"/> : (vaultAddress?.slice(0,6) + "..." + vaultAddress?.slice(-4))}
             {vaultAddress && <Copy className="w-4 h-4 text-zinc-500 cursor-pointer hover:text-white" onClick={() => navigator.clipboard.writeText(vaultAddress)}/>}
          </div>
       </div>

       {/* --- KONTEN BERDASARKAN MODE --- */}
       
       {mode === "COINBASE" ? (
           // SISTEM B: COINBASE 
           // Sekarang punya Deposit DAN Withdraw
           <>
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
                      systemType="COINBASE" // 👈 Withdraw via Coinbase Client
                   />
               )}
           </>
       ) : (
           // SISTEM A: ZERODEV
           <>
             <div className="p-4 bg-zinc-800/50 rounded-xl mb-4 border border-zinc-700 text-center text-xs text-zinc-400">
                Mode ZeroDev (Kernel). Kirim ETH Mainnet ke alamat di atas.
             </div>
             
             {vaultAddress && (
               <SmartAccountDeposit 
                  vaultAddress={vaultAddress} 
                  isDeployed={isDeployed} 
                  balance={vaultBalance}
                  onUpdate={refreshStatus}
                  systemType="ZERODEV" // 👈 Withdraw via ZeroDev Client
               />
             )}
           </>
       )}

       <TokenList address={vaultAddress} />

    </div>
  );
};