"use client";

import { useEffect, useState } from "react";
import { useAccount, useWriteContract, useWalletClient } from "wagmi";
import { getSmartAccountClient, publicClient } from "~/lib/smart-account";
import { alchemy } from "~/lib/alchemy";
import { formatUnits, erc20Abi, type Address } from "viem";
import { Copy, Wallet, CheckCircle, Circle, NavArrowLeft, NavArrowRight, ArrowUp, Sparks, Rocket, Check } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// Alamat Factory V1.1 (Yang sudah di-whitelist di Paymaster)
const COINBASE_FACTORY_V1 = "0xba5ed110efdba3d005bfc882d75358acbbb85842";

interface TokenData {
  contractAddress: string;
  name: string;
  symbol: string;
  balance: string;
  rawBalance: string;
  decimals: number;
  logo: string | null;
}

export const DustDepositView = () => {
  const { address: ownerAddress } = useAccount(); 
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();

  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [isDeployed, setIsDeployed] = useState(false);
  const [activating, setActivating] = useState(false);

  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [loading, setLoading] = useState(false);
  const [potentialValue, setPotentialValue] = useState(0); 
  
  const [depositStatus, setDepositStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  
  // STATE TOAST
  const [toast, setToast] = useState<{ msg: string, type: "success" | "error" } | null>(null);

  // 1. INIT VAULT & CHECK DEPLOYMENT
  const checkVaultStatus = async () => {
      if (!walletClient) return;
      try {
        const client = await getSmartAccountClient(walletClient);
        if (!client.account) return;

        const vAddr = client.account.address;
        setVaultAddress(vAddr);

        const code = await publicClient.getBytecode({ address: vAddr });
        setIsDeployed(code !== undefined && code !== null && code !== "0x");
      } catch (e) { console.error(e); }
  };

  useEffect(() => {
    checkVaultStatus();
  }, [walletClient]);

  // 2. ACTIVATION LOGIC (GASLESS - FIX DUPLIKAT)
  const handleActivate = async () => {
    if (!walletClient || !vaultAddress) return;
    
    setActivating(true);
    try {
      const client = await getSmartAccountClient(walletClient);
      
      // Kirim transaksi dummy ke Factory agar disponsori Paymaster
      const hash = await client.sendUserOperation({
        account: client.account!,
        calls: [{ 
            to: COINBASE_FACTORY_V1, 
            value: 0n, 
            data: "0x" 
        }]
      });
      
      console.log("Activation Hash:", hash);
      setToast({ msg: "Activating Vault (Sponsored)...", type: "success" });
      
      await new Promise(r => setTimeout(r, 5000));
      await checkVaultStatus();
      setToast({ msg: "Vault Successfully Activated!", type: "success" });
    } catch (e: any) {
      console.error(e);
      setToast({ msg: "Activation Failed: " + (e.shortMessage || "Error"), type: "error" });
    } finally {
      setActivating(false);
    }
  };

  // 3. SCAN WALLET
  const scanOwnerWallet = async () => {
      if (!ownerAddress) return;
      setLoading(true);
      setPotentialValue(0); 
      try {
        const balances = await alchemy.core.getTokenBalances(ownerAddress);
        const nonZeroTokens = balances.tokenBalances.filter((token) => {
          return token.contractAddress.toLowerCase() !== USDC_ADDRESS.toLowerCase() && 
                 token.tokenBalance && BigInt(token.tokenBalance) > 0n;
        });

        const metadataPromises = nonZeroTokens.map(t => alchemy.core.getTokenMetadata(t.contractAddress));
        const metadataList = await Promise.all(metadataPromises);

        const formattedTokens: TokenData[] = nonZeroTokens.map((token, i) => {
          const meta = metadataList[i];
          const rawBal = BigInt(token.tokenBalance || "0");
          const decimals = meta.decimals || 18;
          return {
            contractAddress: token.contractAddress,
            name: meta.name || "Unknown",
            symbol: meta.symbol || "UNK",
            balance: formatUnits(rawBal, decimals),
            rawBalance: token.tokenBalance || "0",
            decimals: decimals,
            logo: meta.logo || null
          };
        });

        setTokens(formattedTokens);
      } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  useEffect(() => { if (ownerAddress) scanOwnerWallet(); }, [ownerAddress]);

  const formatDustValue = (val: number) => {
    if (val === 0) return "$0.00";
    if (val < 0.01) return `$${val.toFixed(6)}`;
    return `$${val.toFixed(2)}`;
  };

  // UI HELPERS
  const totalPages = Math.ceil(tokens.length / ITEMS_PER_PAGE);
  const currentTokens = tokens.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const toggleSelect = (address: string) => {
    const newSet = new Set(selectedTokens);
    if (newSet.has(address)) newSet.delete(address);
    else newSet.add(address);
    setSelectedTokens(newSet);
  };

  const toggleSelectAllPage = () => {
    const newSet = new Set(selectedTokens);
    const allSelected = currentTokens.every(t => newSet.has(t.contractAddress));
    currentTokens.forEach(t => {
      if (allSelected) newSet.delete(t.contractAddress);
      else newSet.add(t.contractAddress);
    });
    setSelectedTokens(newSet);
  };

  const handleDeposit = async () => {
    if (!vaultAddress) return;
    setDepositStatus("Preparing Deposit...");

    for (const tokenAddr of selectedTokens) {
      const token = tokens.find(t => t.contractAddress === tokenAddr);
      if (!token) continue;
      try {
        setDepositStatus(`Depositing ${token.symbol}...`);
        await writeContractAsync({
          address: tokenAddr as Address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [vaultAddress as Address, BigInt(token.rawBalance)],
        });
      } catch (e) {
        setDepositStatus(null);
        setToast({ msg: "Deposit Failed/Cancelled", type: "error" });
        return; 
      }
    }
    setDepositStatus("Confirming...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    setDepositStatus("Refreshing Data...");
    await scanOwnerWallet();
    setSelectedTokens(new Set());
    setDepositStatus(null);
    setToast({ msg: "Deposit Successful! 🧹", type: "success" });
  };

  return (
    <div className="pb-24 relative min-h-[50vh]">
      
      {/* TOAST COMPONENT */}
      <SimpleToast 
        message={toast?.msg || null} 
        type={toast?.type} 
        onClose={() => setToast(null)} 
      />

      {/* LOADING OVERLAY */}
      {(depositStatus || activating) && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
           <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4 max-w-[200px]">
              <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <div className="text-sm font-bold text-center animate-pulse">{activating ? "Activating Vault..." : depositStatus}</div>
           </div>
        </div>
      )}

      {/* HEADER: VAULT INFO + ACTIVATE BUTTON */}
      <div className="p-5 bg-gradient-to-br from-zinc-900 to-zinc-800 text-white rounded-2xl shadow-lg mb-6 relative overflow-hidden">
        
        {/* Status Badge */}
        <div className={`absolute top-4 right-4 text-[10px] px-2 py-1 rounded-full border font-medium flex items-center gap-1 ${isDeployed ? "bg-green-500/20 border-green-500 text-green-400" : "bg-orange-500/20 border-orange-500 text-orange-400"}`}>
           {isDeployed ? <Check className="w-3 h-3" /> : <Rocket className="w-3 h-3" />}
           {isDeployed ? "Active" : "Inactive"}
        </div>

        <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
          <Wallet className="w-3 h-3" /> Vault Address (Receiver)
        </div>
        <div className="flex items-center justify-between mb-4">
          <code className="text-sm font-mono opacity-90 truncate max-w-[200px]">
            {vaultAddress || "Generating..."}
          </code>
          <button onClick={() => {
             if (vaultAddress) {
                navigator.clipboard.writeText(vaultAddress);
                setToast({ msg: "Address Copied!", type: "success" });
             }
          }}>
            <Copy className="w-4 h-4 hover:text-blue-400 transition-colors" />
          </button>
        </div>

        {/* TOMBOL AKTIVASI */}
        {!isDeployed && vaultAddress && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <button 
              onClick={handleActivate}
              disabled={activating}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold shadow-lg flex items-center justify-center gap-2 transition-all"
            >
              <Rocket className="w-4 h-4" /> 
              Activate Vault 
            </button>
            <p className="text-[10px] text-zinc-400 text-center mt-2">
              Activation is required for the Vault to perform Swaps/Withdraws.
            </p>
          </div>
        )}
      </div>

      {/* SISA LOGIC LIST */}
      <div className="flex items-end justify-between mb-3 px-1">
        <div>
           <h3 className="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
             Wallet Assets <span className="text-xs font-normal text-zinc-400">({tokens.length})</span>
           </h3>
           
           {tokens.length > 0 && (
             <div className="text-xs font-medium text-green-600 mt-0.5 flex items-center gap-1">
               <Sparks className="w-3 h-3" />
               Potential Value: <span className="font-bold ml-1">{formatDustValue(potentialValue)}</span>
             </div>
           )}
        </div>

        <button 
          onClick={toggleSelectAllPage}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 mb-1"
        >
          {currentTokens.every(t => selectedTokens.has(t.contractAddress)) && currentTokens.length > 0
            ? "Deselect Page" 
            : "Select Page"}
        </button>
      </div>

      {/* TOKEN LIST */}
      {loading ? (
        <div className="text-center py-10 text-zinc-400 animate-pulse">Scanning wallet...</div>
      ) : tokens.length === 0 ? (
        <div className="text-center py-10 text-zinc-400 border-2 border-dashed rounded-xl">
          No dust tokens found in owner wallet.
        </div>
      ) : (
        <div className="space-y-2">
          {currentTokens.map((token) => {
            const isSelected = selectedTokens.has(token.contractAddress);
            return (
              <div 
                key={token.contractAddress}
                onClick={() => toggleSelect(token.contractAddress)}
                className={`flex items-center p-3 rounded-xl border transition-all cursor-pointer ${
                  isSelected 
                    ? "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800" 
                    : "bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800 hover:border-zinc-300"
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden shrink-0 mr-3 border border-zinc-100 dark:border-zinc-700">
                  {token.logo ? (
                    <img src={token.logo} alt={token.symbol} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-zinc-400">{token.symbol[0]}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{token.name}</div>
                  <div className="text-xs text-zinc-500 truncate">{parseFloat(token.balance).toFixed(4)} {token.symbol}</div>
                </div>
                <div className="pl-3">
                  {isSelected ? (
                    <CheckCircle className="w-6 h-6 text-blue-600 fill-blue-600/10" />
                  ) : (
                    <Circle className="w-6 h-6 text-zinc-300" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PAGINATION */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-4 mt-6">
          <button 
            disabled={page === 1} 
            onClick={() => setPage(p => p - 1)}
            className="p-2 rounded-lg hover:bg-zinc-100 disabled:opacity-30"
          >
            <NavArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <button 
            disabled={page === totalPages} 
            onClick={() => setPage(p => p + 1)}
            className="p-2 rounded-lg hover:bg-zinc-100 disabled:opacity-30"
          >
            <NavArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {selectedTokens.size > 0 && (
        <div className="fixed bottom-24 left-4 right-4 z-40 animate-in slide-in-from-bottom-5">
          <button
            onClick={handleDeposit}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-xl shadow-blue-600/30 py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
          >
            <ArrowUp className="w-5 h-5" />
            Deposit {selectedTokens.size} Assets
          </button>
        </div>
      )}
    </div>
  );
};