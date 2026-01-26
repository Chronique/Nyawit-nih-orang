"use client";

import { useState } from "react";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { parseEther, formatEther, type Address } from "viem";
import { base } from "viem/chains"; 

// IMPORT KEDUA CLIENT
import { getZeroDevSmartAccountClient } from "~/lib/zerodev-smart-account"; 
import { getCoinbaseSmartAccountClient } from "~/lib/coinbase-smart-account";

import { SimpleToast } from "~/components/ui/simple-toast";
import { ArrowUp, CheckCircle, Cube, Globe, Wallet } from "iconoir-react"; 

// Tambahkan Prop 'systemType'
export const SmartAccountDeposit = ({ 
    vaultAddress, 
    isDeployed, 
    balance, 
    onUpdate,
    systemType 
}: { 
    vaultAddress: string | null, 
    isDeployed: boolean, 
    balance: bigint, 
    onUpdate: () => void,
    systemType: "ZERODEV" | "COINBASE" // 👈 PROP BARU
}) => {
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
        setToast({ msg: "Saldo Kurang!", type: "error" });
        return;
    }

    setLoading(true);
    setTxHash(null);

    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });

      console.log(`🤖 [${systemType}] Init Smart Account Client...`);
      
      let client;
      // PILIH CLIENT BERDASARKAN SYSTEM TYPE
      if (systemType === "ZERODEV") {
          client = await getZeroDevSmartAccountClient(walletClient);
      } else {
          client = await getCoinbaseSmartAccountClient(walletClient);
      }
      
      console.log(`🚀 [${systemType}] Sending Withdraw UserOp...`);
      
      const hash = await client.sendUserOperation({
        account: client.account!,
        calls: [{ 
            to: owner as Address, 
            value: parseEther(amount), 
            data: "0x" 
        }]
      });

      console.log("✅ UserOp Hash:", hash);
      setToast({ msg: "Bundling (Wait)...", type: "success" });
      
      const receipt = await client.waitForUserOperationReceipt({ hash });
      const realTxHash = receipt.receipt.transactionHash;
      
      setTxHash(realTxHash); 
      setToast({ msg: "Withdraw Sukses! 💸", type: "success" });
      setAmount("");
      onUpdate();
    } catch (e: any) {
      console.error("WITHDRAW ERROR:", e);
      let msg = e.shortMessage || e.message;
      if(msg.includes("null")) msg = "Wallet Data Error";
      setToast({ msg: "Gagal: " + msg, type: "error" });
    } finally { setLoading(false); }
  };

  return (
    <div className={`p-5 rounded-2xl mb-8 border ${systemType === "ZERODEV" ? "bg-purple-50 border-purple-200" : "bg-blue-50 border-blue-200"}`}>
      <SimpleToast message={toast?.msg ?? null} type={toast?.type ?? undefined} onClose={() => setToast(null)} />
      
      <div className="flex justify-between items-center mb-4">
         <div className={`text-sm font-bold flex items-center gap-2 ${systemType === "ZERODEV" ? "text-purple-800" : "text-blue-800"}`}>
            {systemType === "ZERODEV" ? <Cube className="w-4 h-4"/> : <Wallet className="w-4 h-4"/>} 
            Withdraw ({systemType})
         </div>
         <div className="text-right">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Vault Balance</div>
            <div className="font-mono font-bold text-lg">{parseFloat(formatEther(balance)).toFixed(5)} ETH</div>
         </div>
      </div>

      <div className="space-y-3">
         <div className="relative">
            <input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.0" className="w-full pl-3 pr-16 py-3 rounded-xl border bg-white/50 focus:outline-none focus:ring-2 focus:ring-black/10 text-black"/>
            <button onClick={() => setAmount(formatEther(balance))} className="absolute right-2 top-2 bottom-2 px-3 text-xs font-bold bg-white/80 text-black rounded-lg hover:bg-white">MAX</button>
         </div>
         
         <button onClick={handleWithdraw} disabled={loading} className={`w-full py-3 text-white font-bold rounded-xl shadow-lg disabled:opacity-50 transition-all ${systemType === "ZERODEV" ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-600 hover:bg-blue-700"}`}>
            {loading ? "Signing..." : "Withdraw (Gasless)"}
         </button>
         
         {txHash && (
             <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer" className="block text-center text-xs text-blue-600 hover:underline bg-white/50 p-2 rounded border border-blue-100 flex items-center justify-center gap-1">
                <Globe className="w-3 h-3"/> Lihat di BaseScan
             </a>
         )}
      </div>
    </div>
  );
};