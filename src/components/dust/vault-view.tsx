"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount } from "wagmi";
import { getSmartAccountClient, publicClient } from "~/lib/smart-account";
import { alchemy } from "~/lib/alchemy";
import { formatEther, parseEther, encodeFunctionData, erc20Abi, type Address } from "viem";
import { Copy, Wallet, ArrowRight, Refresh, Rocket, Check } from "iconoir-react";

export const VaultView = () => {
  const { data: walletClient } = useWalletClient();
  const { address: ownerAddress } = useAccount(); 
  
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [ethBalance, setEthBalance] = useState("0");
  const [tokens, setTokens] = useState<any[]>([]);
  const [isDeployed, setIsDeployed] = useState(false);
  
  const [loading, setLoading] = useState(false); 
  const [actionLoading, setActionLoading] = useState<string | null>(null); 

  // --- FETCH DATA (Tetap sama untuk tampilan UI) ---
  const fetchVaultData = async () => {
    if (!walletClient) return;
    setLoading(true);
    try {
      const client = await getSmartAccountClient(walletClient);
      if (!client.account) return;

      const address = client.account.address;
      setVaultAddress(address);

      const bal = await publicClient.getBalance({ address });
      setEthBalance(formatEther(bal));

      const code = await publicClient.getBytecode({ address });
      setIsDeployed(code !== undefined && code !== null && code !== "0x");

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

  // --- MANUAL DEPLOY (MODIFIED FOR GASLESS) ---
  // --- MANUAL DEPLOY (GASLESS VERSION) ---
  const handleDeploy = async () => {
    if (!walletClient || !vaultAddress) return;
    try {
      setActionLoading("Activating Vault...");
      const client = await getSmartAccountClient(walletClient);
      if (!client.account) throw new Error("Akun tidak ditemukan");

      // 🔥 TIDAK PERLU CEK SALDO LAGI (Karena dibayari Pimlico)
      console.log("Mengirim transaksi deploy (Sponsored)...");

      const hash = await client.sendUserOperation({
        account: client.account,
        calls: [{ to: vaultAddress as Address, value: 0n, data: "0x" }]
      });

      console.log("Deploy Hash:", hash);
      setActionLoading("Finalizing...");
      await new Promise(resolve => setTimeout(resolve, 5000));
      await fetchVaultData(); 

    } catch (e: any) {
      console.error(e);
      alert(`Gagal Aktivasi: ${e.shortMessage || e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  // --- WITHDRAW FUNCTION (LOGIKA BARU KAMU) ---
  const handleWithdraw = async (token?: any) => {
    if (!walletClient || !ownerAddress) return;

    try {
      const isEth = !token; 
      const symbol = isEth ? "ETH" : token.symbol;
      
      setActionLoading(`Withdrawing ${symbol}...`); 
      const client = await getSmartAccountClient(walletClient);
      if (!client.account) throw new Error("Akun tidak ditemukan");

      let callData: any;

      if (isEth) {
        // 🔥 INI LOGIKA BARU KAMU: FRESH BALANCE CHECK
        const balance = await publicClient.getBalance({ 
          address: client.account.address 
        });

        const gasBuffer = parseEther("0.00005");
        
        if (balance <= gasBuffer) {
           throw new Error("Saldo ETH tidak cukup untuk bayar gas.");
        }

        const amountToSend = balance - gasBuffer;

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

      const hash = await client.sendUserOperation({
        account: client.account,
        calls: [callData]
      });

      setActionLoading("Confirming...");
      await new Promise(resolve => setTimeout(resolve, 4000));
      await fetchVaultData();

    } catch (e: any) {
      console.error(e);
      alert(`Withdraw Gagal: ${e.message}`);
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
      <div className="p-5 bg-zinc-900 text-white rounded-2xl shadow-lg relative overflow-hidden">
        <div className={`absolute top-4 right-4 text-[10px] px-2 py-1 rounded-full border font-medium flex items-center gap-1 ${isDeployed ? "bg-green-500/20 border-green-500 text-green-400" : "bg-orange-500/20 border-orange-500 text-orange-400"}`}>
           {isDeployed ? <Check className="w-3 h-3" /> : <Rocket className="w-3 h-3" />}
           {isDeployed ? "Active Vault" : "Not Activated"}
        </div>

        <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
            <Wallet className="w-3 h-3" /> Smart Vault Address
        </div>
        <div className="flex items-center justify-between mb-4">
            <code className="text-sm truncate max-w-[180px] opacity-80">{vaultAddress || "Loading..."}</code>
            <button onClick={() => vaultAddress && navigator.clipboard.writeText(vaultAddress)}>
               <Copy className="w-4 h-4 hover:text-blue-400" />
            </button>
        </div>

        <div className="mt-2">
            <div className="text-2xl font-bold">
                {parseFloat(ethBalance).toFixed(5)} <span className="text-sm font-normal text-zinc-400">ETH</span>
            </div>
            
            <div className="mt-4">
              {!isDeployed ? (
                <button 
                  onClick={handleDeploy}
                  
                  className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-orange-900/20 flex items-center justify-center gap-2 transition-all"
                >
                  <Rocket className="w-4 h-4" /> 
                  {parseFloat(ethBalance) < 0.0002 ? "Deposit min 0.0002 ETH" : "Activate Vault Now"}
                </button>
              ) : (
                 parseFloat(ethBalance) > 0.00005 && (
                   <button onClick={() => handleWithdraw()} className="w-full bg-zinc-800 hover:bg-zinc-700 px-4 py-2.5 rounded-xl border border-zinc-700 flex items-center justify-center gap-2 transition-all text-sm font-medium">
                     Withdraw All ETH <ArrowRight className="w-3 h-3" />
                   </button>
                 )
              )}
            </div>
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
                      disabled={!isDeployed}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        !isDeployed 
                          ? "bg-zinc-100 text-zinc-400 cursor-not-allowed" 
                          : "text-blue-600 bg-blue-50 hover:bg-blue-100"
                      }`}
                    >
                      {!isDeployed ? "Locked" : "Withdraw"}
                    </button>
                </div>
            ))}
        </div>
      )}
    </div>
  );
};