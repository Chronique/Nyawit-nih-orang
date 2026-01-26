"use client";

import { useState } from "react";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { parseEther, formatEther, type Address } from "viem";
import { base } from "viem/chains"; // 👈 MAINNET
import { getUnifiedSmartAccountClient } from "~/lib/smart-account-switcher"; 
import { SimpleToast } from "~/components/ui/simple-toast";
import { ArrowUp, CheckCircle, Cube, Globe } from "iconoir-react"; 

export const SmartAccountDeposit = ({ vaultAddress, isDeployed, balance, onUpdate }: { vaultAddress: string | null, isDeployed: boolean, balance: bigint, onUpdate: () => void }) => {
  const { address: owner, connector, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [toast, setToast] = useState<{msg:string, type:"success"|"error"}|null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleWithdraw = async () => {
    if (!walletClient || !owner || !vaultAddress || !amount) {
        setToast({ msg: "Wallet not ready.", type: "error" });
        return;
    }
    
    if (parseEther(amount) > balance) {
        setToast({ msg: "Saldo Kurang! Isi ETH dulu.", type: "error" });
        return;
    }

    setLoading(true);
    setTxHash(null);

    try {
      // 1. Force Switch ke Mainnet
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });

      console.log("🤖 [Mainnet] Init Client...");
      const client = await getUnifiedSmartAccountClient(walletClient, connector?.id, 0n);
      
      console.log("🚀 [Mainnet] Sending Withdraw UserOp...");
      const hash = await client.sendUserOperation({
        account: client.account!,
        calls: [{ 
            to: owner as Address, 
            value: parseEther(amount), 
            data: "0x" 
        }]
      });

      console.log("✅ UserOp Hash:", hash);
      setToast({ msg: "Bundling di Mainnet...", type: "success" });
      
      const receipt = await client.waitForUserOperationReceipt({ hash });
      const realTxHash = receipt.receipt.transactionHash;
      
      setTxHash(realTxHash); 
      setToast({ msg: "Withdraw Mainnet SUKSES! 💸", type: "success" });
      setAmount("");
      onUpdate();
    } catch (e: any) {
      console.error("WITHDRAW ERROR:", e);
      let msg = e.shortMessage || e.message;
      if(msg.includes("null")) msg = "Wallet Data Error (Types Null)";
      setToast({ msg: "Gagal: " + msg, type: "error" });
    } finally { setLoading(false); }
  };

  return (
    <div className="p-5 bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800 rounded-2xl mb-8">
      <SimpleToast message={toast?.msg ?? null} type={toast?.type ?? undefined} onClose={() => setToast(null)} />
      
      <div className="flex justify-between items-center mb-4">
         <div className="text-sm font-bold text-purple-800 dark:text-purple-300 flex items-center gap-2"><Cube className="w-4 h-4"/> Simple Account (Mainnet)</div>
         <div className="text-right">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Vault Balance</div>
            <div className="font-mono font-bold text-lg">{parseFloat(formatEther(balance)).toFixed(5)} ETH</div>
         </div>
      </div>

      <div className="space-y-3">
         <div className="relative">
            <input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.0" className="w-full pl-3 pr-16 py-3 rounded-xl border dark:bg-black/20 focus:outline-none focus:ring-2 focus:ring-purple-500"/>
            <button onClick={() => setAmount(formatEther(balance))} className="absolute right-2 top-2 bottom-2 px-3 text-xs font-bold bg-purple-100 dark:bg-purple-800 text-purple-600 dark:text-purple-200 rounded-lg">MAX</button>
         </div>
         
         <button onClick={handleWithdraw} disabled={loading} className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-lg disabled:opacity-50 transition-all">
            {loading ? "Signing (Real Money)..." : "Withdraw (Mainnet)"}
         </button>
         
         {txHash && (
             <a 
               href={`https://basescan.org/tx/${txHash}`} 
               target="_blank" 
               rel="noreferrer"
               className="block text-center text-xs text-blue-600 hover:underline bg-blue-50 p-2 rounded border border-blue-100 flex items-center justify-center gap-1"
             >
                <Globe className="w-3 h-3"/> Lihat di BaseScan (Mainnet)
             </a>
         )}
         
         <div className="flex items-center gap-2 justify-center text-[10px] text-zinc-500">
            <CheckCircle className="w-3 h-3"/> Gas Sponsored by Pimlico
         </div>
      </div>
    </div>
  );
};