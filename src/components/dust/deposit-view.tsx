"use client";

import { useEffect, useState } from "react";
import { useAccount, useWriteContract, useWalletClient } from "wagmi";
import { getSmartAccountClient, publicClient } from "~/lib/smart-account";
import { alchemy } from "~/lib/alchemy";
import { formatEther, erc20Abi, type Address } from "viem";
import { Copy, Wallet, CheckCircle, Circle, NavArrowLeft, NavArrowRight, ArrowUp } from "iconoir-react";

// Token yang di-exclude (Tidak dianggap dust)
const IGNORED_TOKENS = [
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC Base
  "0x4200000000000000000000000000000000000006", // WETH Base
  // Tambahkan token 'bagus' lain di sini
];

interface TokenData {
  contractAddress: string;
  name: string;
  symbol: string;
  balance: string; // Formatted balance
  rawBalance: string; // BigInt string
  decimals: number;
  logo: string | null;
}

export const DustDepositView = () => {
  const { address: ownerAddress } = useAccount(); // Wallet EOA (Metamask)
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();

  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [vaultEthBalance, setVaultEthBalance] = useState<string>("0");
  
  // State Scanning
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [loading, setLoading] = useState(false);
  
  // State Pagination & Selection
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());

  // 1. INIT VAULT INFO
  useEffect(() => {
    const initVault = async () => {
      if (!walletClient) return;
      try {
        const client = await getSmartAccountClient(walletClient);
        const vAddr = client.account.address;
        setVaultAddress(vAddr);

        const bal = await publicClient.getBalance({ address: vAddr });
        setVaultEthBalance(formatEther(bal));
      } catch (e) { console.error(e); }
    };
    initVault();
  }, [walletClient]);

  // 2. SCAN OWNER WALLET (Via Alchemy)
  useEffect(() => {
    const scanOwnerWallet = async () => {
      if (!ownerAddress) return;
      setLoading(true);
      try {
        const balances = await alchemy.core.getTokenBalances(ownerAddress);
        
        // Filter token yang balance > 0 dan bukan USDC/ETH
        const nonZeroTokens = balances.tokenBalances.filter((token) => {
          const isIgnored = IGNORED_TOKENS.includes(token.contractAddress.toLowerCase());
          // Cek balance (hex) tidak nol
          return !isIgnored && token.tokenBalance && BigInt(token.tokenBalance) > 0n;
        });

        // Ambil Metadata (Nama, Symbol, Logo)
        const metadataPromises = nonZeroTokens.map(t => alchemy.core.getTokenMetadata(t.contractAddress));
        const metadataList = await Promise.all(metadataPromises);

        // Gabungkan data
        const formattedTokens: TokenData[] = nonZeroTokens.map((token, i) => {
          const meta = metadataList[i];
          const rawBal = BigInt(token.tokenBalance || "0");
          // Simple format (tanpa library berat)
          const decimals = meta.decimals || 18;
          const divisor = BigInt(10 ** decimals);
          const beforeDecimal = rawBal / divisor;
          const afterDecimal = rawBal % divisor;
          // Ambil 4 digit desimal pertama saja biar rapi
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

    if (ownerAddress) scanOwnerWallet();
  }, [ownerAddress]);

  // --- LOGIC PAGINATION ---
  const totalPages = Math.ceil(tokens.length / ITEMS_PER_PAGE);
  const currentTokens = tokens.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  // --- LOGIC SELECTION ---
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

  // --- LOGIC DEPOSIT (EOA -> VAULT) ---
  const handleDeposit = async () => {
    if (!vaultAddress) return;
    
    // PERINGATAN: EOA tidak bisa batch transfer native. 
    // Kita harus loop writeContract satu per satu (Metamask akan popup berkali-kali).
    // Untuk UX terbaik, biasanya kita minta user approve token, lalu Smart Account yang 'pull' (tarik).
    // Tapi untuk demo "Push" Deposit, kita loop saja.
    
    for (const tokenAddr of selectedTokens) {
      const token = tokens.find(t => t.contractAddress === tokenAddr);
      if (!token) continue;

      try {
        await writeContractAsync({
          address: tokenAddr as Address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [vaultAddress as Address, BigInt(token.rawBalance)],
        });
      } catch (e) {
        console.error("Deposit Cancelled/Failed for", token.symbol);
        break; // Stop jika user reject salah satu
      }
    }
    
    // Reset selection setelah deposit (idealnnya refresh balance juga)
    setSelectedTokens(new Set());
  };

  return (
    <div className="pb-24"> {/* Padding bawah untuk floating button */}
      
      {/* 1. HEADER: VAULT INFO */}
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

      {/* 2. LIST HEADER & CONTROLS */}
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="font-semibold text-zinc-700 dark:text-zinc-300">
          Wallet Assets <span className="text-xs font-normal text-zinc-400">({tokens.length})</span>
        </h3>
        <button 
          onClick={toggleSelectAllPage}
          className="text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          {currentTokens.every(t => selectedTokens.has(t.contractAddress)) && currentTokens.length > 0
            ? "Deselect Page" 
            : "Select Page"}
        </button>
      </div>

      {/* 3. TOKEN LIST */}
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
                {/* Icon */}
                <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden shrink-0 mr-3">
                  {token.logo ? (
                    <img src={token.logo} alt={token.symbol} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-zinc-400">{token.symbol[0]}</span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{token.name}</div>
                  <div className="text-xs text-zinc-500">{token.balance} {token.symbol}</div>
                </div>

                {/* Checkbox */}
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

      {/* 4. PAGINATION */}
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

      {/* 5. FLOATING DEPOSIT BUTTON */}
      {selectedTokens.size > 0 && (
        <div className="fixed bottom-24 left-4 right-4 z-50">
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