"use client";

import { useState } from "react";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { parseEther, type Address } from "viem";
import { base } from "viem/chains"; // 👈 Pastikan Mainnet
import { SimpleToast } from "~/components/ui/simple-toast";
import { Wallet, Copy, Coins } from "iconoir-react";

export const SimpleAccountDeposit = ({ vaultAddress, isDeployed, onUpdate }: { vaultAddress: string | null, isDeployed: boolean, onUpdate: () => void }) => {
  const { chainId } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [toast, setToast] = useState<{msg:string, type:"success"|"error"}|null>(null);

  // KITA HAPUS LOGIC DEPLOY (CB_SW_FACTORY)
  // Karena SimpleAccount akan auto-deploy via UserOp (Lazy Deploy).
  
  const handleDeposit = async () => {
    if (!vaultAddress || !amount) return;
    setLoading(true);
    try {
      // 1. Force Switch ke Base Mainnet
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      
      // 2. Kirim ETH Asli
      await sendTransactionAsync({
        to: vaultAddress as Address,
        value: parseEther(amount),
        chainId: base.id
      });
      
      setToast({ msg: "Deposit Mainnet Sukses! 💰", type: "success" });
      setAmount("");
      onUpdate();
    } catch (e: any) {
      console.error(e);
      setToast({ msg: "Deposit Gagal", type: "error" });
    } finally { setLoading(false); }
  };

  return (
    <div className="p-5 bg-zinc-900 text-white rounded-2xl shadow-lg relative overflow-hidden mb-4 border border-zinc-700">
      <SimpleToast message={toast?.msg ?? null} type={toast?.type ?? undefined} onClose={() => setToast(null)} />
      
      <div className="flex justify-between items-start mb-2">
         <div className="text-xs text-zinc-400 flex items-center gap-2"><Wallet className="w-4 h-4"/> 1. EOA (Dompet Asli)</div>
         <div className="px-2 py-1 bg-blue-900/50 text-blue-200 text-[10px] rounded border border-blue-500/50 font-bold">BASE MAINNET 🔵</div>
      </div>
      
      <div className="flex items-center gap-2 mb-4">
         <code className="text-sm font-mono opacity-80">{vaultAddress || "Menghitung Alamat..."}</code>
         <button onClick={() => vaultAddress && navigator.clipboard.writeText(vaultAddress)}><Copy className="w-4 h-4 hover:text-blue-400"/></button>
      </div>

      <div className="flex gap-2">
          <input type="number" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.0001 ETH" className="flex-1 bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none"/>
          <button onClick={handleDeposit} disabled={loading} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2">
            <Coins className="w-4 h-4"/> Deposit Real ETH
          </button>
      </div>
      
      <div className="mt-2 text-[10px] text-zinc-500">
        *Alamat di atas adalah SimpleAccount (bukan Coinbase Wallet).
        <br/>*Langsung deposit saja, tidak perlu deploy manual.
      </div>
    </div>
  );
};