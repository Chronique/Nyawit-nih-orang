"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount } from "wagmi"; // [TAMBAH] useAccount
import { Copy, Refresh, ShieldCheck, User } from "iconoir-react"; // [TAMBAH] Icon User

import { getUnifiedSmartAccountClient } from "~/lib/smart-account-switcher";
import { useFrameContext } from "~/components/providers/frame-provider";

import { SimpleAccountDeposit } from "./simple-account-deposit";
import { TokenList } from "./token-list";

export const DustDepositView = () => {
  const { data: walletClient } = useWalletClient();
  const { address: ownerAddress } = useAccount(); // [TAMBAH] Ambil alamat wallet asli (Signer)
  const frameContext = useFrameContext();
  
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshStatus = async () => {
      if (!walletClient) return;
      setLoading(true);
      try {
        const client = await getUnifiedSmartAccountClient(walletClient, undefined);
        const addr = client.account.address;
        setVaultAddress(addr);
      } catch (e) { console.error("Status Check Error:", e); }
      finally { setLoading(false); }
  };

  useEffect(() => { if (walletClient) refreshStatus(); }, [walletClient]); 

  // Loading state
  if (!walletClient) return <div className="text-center py-20 text-zinc-500 animate-pulse">Initializing Wallet...</div>;

  return (
    <div className="max-w-md mx-auto pb-24">
       {/* HEADER SIMPLE */}
       <div className="text-center mb-6 pt-4 space-y-4">
          
          {/* BAGIAN 1: SMART VAULT ADDRESS */}
          <div>
            <div className="flex justify-center mb-2">
               <div className="px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-bold flex items-center gap-1.5 border border-blue-200 dark:border-blue-800">
                  <ShieldCheck className="w-3 h-3"/> Unified Vault
               </div>
            </div>
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Active Vault Address</div>
            <div className="text-xl font-mono font-bold flex justify-center items-center gap-2">
               {loading ? <Refresh className="w-5 h-5 animate-spin"/> : (vaultAddress ? (vaultAddress.slice(0,6) + "..." + vaultAddress.slice(-4)) : "...")}
               {vaultAddress && <Copy className="w-4 h-4 text-zinc-500 cursor-pointer hover:text-white" onClick={() => navigator.clipboard.writeText(vaultAddress)}/>}
            </div>
          </div>

          {/* [DEBUG] BAGIAN 2: OWNER/SIGNER ADDRESS */}
          {/* Ini untuk mengecek apakah Signer-nya beda antara Farcaster & Email */}
          <div className="bg-zinc-100 dark:bg-zinc-900/50 rounded-lg p-2 max-w-[200px] mx-auto border border-zinc-200 dark:border-zinc-800">
             <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-500 mb-1">
                <User className="w-3 h-3" /> Owner (Signer) Address
             </div>
             <div className="font-mono text-xs text-zinc-700 dark:text-zinc-400 break-all">
                {ownerAddress ? (ownerAddress.slice(0,6) + "..." + ownerAddress.slice(-4)) : "Not Connected"}
             </div>
          </div>

       </div>

       <div className="animate-in fade-in duration-500">
           {/* Form Deposit */}
           <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm mb-6">
              <h3 className="text-sm font-bold mb-4 text-zinc-800 dark:text-white flex items-center gap-2">
                 Deposit Asset
              </h3>
              <SimpleAccountDeposit 
                vaultAddress={vaultAddress} 
                isDeployed={true} 
                onUpdate={refreshStatus} 
              />
           </div>

           {/* List Token */}
           <TokenList address={vaultAddress} />
       </div>
    </div>
  );
};