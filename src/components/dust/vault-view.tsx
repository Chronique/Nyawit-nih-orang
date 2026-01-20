"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount } from "wagmi";
import { getSmartAccountClient, publicClient } from "~/lib/smart-account";
import { alchemy } from "~/lib/alchemy";
import { formatEther, parseEther, encodeFunctionData, erc20Abi, type Address } from "viem";
import { Copy, Wallet, ArrowRight, Refresh } from "iconoir-react";

export const VaultView = () => {
  const { data: walletClient } = useWalletClient();
  const { address: ownerAddress } = useAccount(); 
  
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [ethBalance, setEthBalance] = useState("0");
  const [tokens, setTokens] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(false); 
  const [actionLoading, setActionLoading] = useState<string | null>(null); 

  const fetchVaultData = async () => {
    if (!walletClient) return;
    setLoading(true);
    try {
      const client = await getSmartAccountClient(walletClient);
      
      // FIX: Cek account
      if (!client.account) return;

      const address = client.account.address;
      setVaultAddress(address);

      const bal = await publicClient.getBalance({ address });
      setEthBalance(formatEther(bal));

      const balances = await alchemy.core.getTokenBalances(address);
      const nonZeroTokens = balances.tokenBalances.filter(t => 
          t.tokenBalance && BigInt(t.tokenBalance) > 0n
      );

      const metadata = await Promise.all(
          nonZeroTokens.map(t => alchemy.core.getTokenMetadata(t.contractAddress))
      );

      const formatted = nonZeroTokens.map((t, i) => {
          const meta = metadata[i];
          const decimals = meta.decimals || 18;
          const raw = BigInt(t.tokenBalance || "0");
          const val = Number(raw) / (10 ** decimals);
          return {
              ...t,
              name: meta.name,
              symbol: meta.symbol,
              logo: meta.logo,
              decimals: decimals,
              rawBalance: raw,
              formattedBal: val.toLocaleString('en-US', { maximumFractionDigits: 4 })
          };
      });

      setTokens(formatted);

    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchVaultData();
  }, [walletClient]);

  // --- FITUR WITHDRAW ---
  const handleWithdraw = async (token?: any) => {
    if (!walletClient || !ownerAddress) return;

    try {
      const isEth = !token; 
      const symbol = isEth ? "ETH" : token.symbol;
      
      setActionLoading(`Withdrawing ${symbol}...`); 

      const client = await getSmartAccountClient(walletClient);
      
      // FIX: Cek account lagi sebelum transaksi
      if (!client.account) throw new Error("Akun tidak ditemukan");

      let callData: any;

      if (isEth) {
        const currentBal = parseEther(ethBalance);
        const gasBuffer = parseEther("0.00005"); 
        
        if (currentBal <= gasBuffer) {
           throw new Error("Saldo ETH terlalu kecil (habis untuk gas).");
        }

        const amountToSend = currentBal - gasBuffer;

        callData = {
          to: ownerAddress,
          value: amountToSend, 
          data: "0x"
        };
      } else {
        callData = {
          to: token.contractAddress as Address,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [ownerAddress, token.rawBalance]
          })
        };
      }

      // FIX: Pass 'account' secara eksplisit
      const hash = await client.sendUserOperation({
        account: client.account,
        calls: [callData]
      });
      console.log("Withdraw Tx:", hash);

      setActionLoading("Confirming...");
      
      await new Promise(resolve => setTimeout(resolve, 4000));
      await fetchVaultData();

    } catch (e: any) {
      console.error(e);
      const msg = e.message.includes("Saldo ETH") 
        ? "Saldo tidak cukup untuk bayar gas fee."
        : "Withdraw Gagal. Cek console.";
      alert(msg);
    } finally {
      setActionLoading(null); 
    }
  };

  return (
    <div className="pb-20 space-y-4 relative min-h-[50vh]">
      
      {/* LOADING OVERLAY */}
      {actionLoading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
           <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4 max-w-[200px]">
              <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <div className="text-sm font-bold text-center animate-pulse">{actionLoading}</div>
           </div>
        </div>
      )}

      {/* HEADER CARD */}
      <div className="p-5 bg-zinc-900 text-white rounded-2xl shadow-lg">
        <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
            <Wallet className="w-3 h-3" /> Smart Vault Active
        </div>
        <div className="flex items-center justify-between">
            <code className="text-sm truncate max-w-[200px]">{vaultAddress || "Loading..."}</code>
            <button onClick={() => vaultAddress && navigator.clipboard.writeText(vaultAddress)}>
               <Copy className="w-4 h-4 hover:text-blue-400" />
            </button>
        </div>
        <div className="mt-4 flex items-end justify-between">
            <div className="text-2xl font-bold">
                {parseFloat(ethBalance).toFixed(5)} <span className="text-sm font-normal text-zinc-400">ETH</span>
            </div>
            
            {parseFloat(ethBalance) > 0.00005 && (
               <button onClick={() => handleWithdraw()} className="text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-full border border-zinc-700 flex items-center gap-1 transition-all">
                 Withdraw All <ArrowRight className="w-3 h-3" />
               </button>
            )}
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <h3 className="font-semibold">Vault Assets</h3>
        <button onClick={fetchVaultData} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:rotate-180 transition-all duration-500">
           <Refresh className="w-4 h-4 text-zinc-500" />
        </button>
      </div>
      
      {/* ASSET LIST */}
      {loading ? (
        <div className="text-center py-10 text-zinc-400">Loading vault data...</div>
      ) : tokens.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed rounded-xl text-zinc-400">
            Vault kosong. Silakan deposit dulu.
        </div>
      ) : (
        <div className="space-y-2">
            {tokens.map((token, i) => (
                <div key={i} className="flex items-center justify-between p-3 border border-zinc-100 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 shadow-sm">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center shrink-0 overflow-hidden">
                            {token.logo ? <img src={token.logo} className="w-full" /> : token.symbol?.[0]}
                        </div>
                        <div>
                            <div className="font-semibold text-sm">{token.name}</div>
                            <div className="text-xs text-zinc-500">{token.formattedBal} {token.symbol}</div>
                        </div>
                    </div>
                    
                    <button 
                      onClick={() => handleWithdraw(token)}
                      className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                    >
                      Withdraw
                    </button>
                </div>
            ))}
        </div>
      )}
    </div>
  );
};