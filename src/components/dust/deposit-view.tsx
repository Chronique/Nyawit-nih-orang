"use client";

import { useEffect, useState } from "react";
import { useAccount, useWriteContract, useWalletClient } from "wagmi";
import { getSmartAccountClient, publicClient } from "~/lib/smart-account";
import { alchemy } from "~/lib/alchemy";
import { formatEther, erc20Abi, type Address } from "viem";
import { Copy, Wallet, CheckCircle, Circle, NavArrowLeft, NavArrowRight, ArrowUp, Sparks } from "iconoir-react";

// Token yang di-exclude (Tidak dianggap dust)
const IGNORED_TOKENS = [
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC Base
  "0x4200000000000000000000000000000000000006", // WETH Base
];

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

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
  const [vaultEthBalance, setVaultEthBalance] = useState<string>("0");
  
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [loading, setLoading] = useState(false); // Loading scan wallet
  const [calculatingValue, setCalculatingValue] = useState(false); // Loading hitung harga
  const [potentialValue, setPotentialValue] = useState(0); // Total Value $$
  
  const [depositStatus, setDepositStatus] = useState<string | null>(null);
  
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());

  // 1. INIT VAULT INFO
  useEffect(() => {
    const initVault = async () => {
      if (!walletClient) return;
      try {
        const client = await getSmartAccountClient(walletClient);
        
        // FIX: Pastikan account ada sebelum akses
        if (!client.account) return; 

        const vAddr = client.account.address;
        setVaultAddress(vAddr);
        const bal = await publicClient.getBalance({ address: vAddr });
        setVaultEthBalance(formatEther(bal));
      } catch (e) { console.error(e); }
    };
    initVault();
  }, [walletClient]);

  // 2. SCAN TOKEN & METADATA
  const scanOwnerWallet = async () => {
      if (!ownerAddress) return;
      setLoading(true);
      setPotentialValue(0); 
      try {
        const balances = await alchemy.core.getTokenBalances(ownerAddress);
        
        const nonZeroTokens = balances.tokenBalances.filter((token) => {
          const isIgnored = IGNORED_TOKENS.includes(token.contractAddress.toLowerCase());
          return !isIgnored && token.tokenBalance && BigInt(token.tokenBalance) > 0n;
        });

        const metadataPromises = nonZeroTokens.map(t => alchemy.core.getTokenMetadata(t.contractAddress));
        const metadataList = await Promise.all(metadataPromises);

        const formattedTokens: TokenData[] = nonZeroTokens.map((token, i) => {
          const meta = metadataList[i];
          const rawBal = BigInt(token.tokenBalance || "0");
          const decimals = meta.decimals || 18;
          const divisor = BigInt(10 ** decimals);
          const beforeDecimal = rawBal / divisor;
          const afterDecimal = rawBal % divisor;
          const formatted = `${beforeDecimal}.${afterDecimal.toString().padStart(decimals, '0').slice(0,4)}`;

          return {
            contractAddress: token.contractAddress,
            name: meta.name || "Unknown",
            symbol: meta.symbol || "UNK",
            balance: formatted,
            rawBalance: token.tokenBalance || "0",
            decimals: decimals,
            logo: meta.logo || null
          };
        });

        setTokens(formattedTokens);
      } catch (error) {
        console.error("Alchemy Scan Error:", error);
      } finally {
        setLoading(false);
      }
  };

  useEffect(() => {
    if (ownerAddress) scanOwnerWallet();
  }, [ownerAddress]);

  // 3. CALCULATE POTENTIAL VALUE
  useEffect(() => {
    const calculateValue = async () => {
      if (tokens.length === 0) return;
      setCalculatingValue(true);
      let totalUsd = 0;

      for (const token of tokens) {
         try {
            const params = new URLSearchParams({
              sellToken: token.contractAddress,
              buyToken: USDC_ADDRESS, 
              sellAmount: token.rawBalance, 
            });

            const res = await fetch(`https://base.api.0x.org/swap/v1/price?${params}`, {
              headers: { '0x-api-key': process.env.NEXT_PUBLIC_0X_API_KEY || '' }
            });

            if (res.ok) {
              const data = await res.json();
              const usdVal = parseFloat(data.buyAmount) / 1000000;
              totalUsd += usdVal;
            }
         } catch (e) {
            // Ignore error
         }
      }
      
      setPotentialValue(totalUsd);
      setCalculatingValue(false);
    };

    if (tokens.length > 0) calculateValue();
  }, [tokens]);

  // --- LOGIC UI ---
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
        return; 
      }
    }
    setDepositStatus("Confirming...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    setDepositStatus("Refreshing Data...");
    await scanOwnerWallet();
    setSelectedTokens(new Set());
    setDepositStatus(null);
  };

  return (
    <div className="pb-24 relative min-h-[50vh]">
      
      {/* LOADING OVERLAY */}
      {depositStatus && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
           <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4 max-w-[200px]">
              <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <div className="text-sm font-bold text-center animate-pulse">{depositStatus}</div>
           </div>
        </div>
      )}

      {/* HEADER: VAULT INFO */}
      <div className="p-5 bg-gradient-to-br from-zinc-900 to-zinc-800 text-white rounded-2xl shadow-lg mb-6">
        <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
          <Wallet className="w-3 h-3" /> Vault Address (Receiver)
        </div>
        <div className="flex items-center justify-between mb-4">
          <code className="text-sm font-mono opacity-90 truncate max-w-[200px]">
            {vaultAddress || "Generating..."}
          </code>
          <button onClick={() => vaultAddress && navigator.clipboard.writeText(vaultAddress)}>
            <Copy className="w-4 h-4 hover:text-blue-400 transition-colors" />
          </button>
        </div>
        <div className="flex items-end justify-between border-t border-white/10 pt-3">
          <div>
            <div className="text-xs text-zinc-400 mb-1">Gas Balance</div>
            <div className="text-2xl font-bold tracking-tight">
              {parseFloat(vaultEthBalance).toFixed(5)} <span className="text-sm font-normal text-zinc-400">ETH</span>
            </div>
          </div>
          <div className="bg-white/10 px-3 py-1 rounded-full text-xs font-medium backdrop-blur-sm">
            Base Mainnet
          </div>
        </div>
      </div>

      {/* LIST HEADER */}
      <div className="flex items-end justify-between mb-3 px-1">
        <div>
           <h3 className="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
             Wallet Assets <span className="text-xs font-normal text-zinc-400">({tokens.length})</span>
           </h3>
           
           {tokens.length > 0 && (
             <div className="text-xs font-medium text-green-600 mt-0.5 flex items-center gap-1 animate-in fade-in slide-in-from-left-2">
               <Sparks className="w-3 h-3" />
               Potential Value: 
               {calculatingValue ? (
                 <span className="animate-pulse">Checking...</span>
               ) : (
                 <span className="font-bold ml-1">~${potentialValue.toFixed(2)}</span>
               )}
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
                  <div className="text-xs text-zinc-500">{token.balance} {token.symbol}</div>
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