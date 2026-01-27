"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount, useSwitchChain } from "wagmi";
import { getUnifiedSmartAccountClient } from "~/lib/smart-account-switcher"; 
import { alchemy } from "~/lib/alchemy";
import { fetchTokenPrices } from "~/lib/price";
import { formatUnits, encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { base } from "viem/chains"; 
import { Refresh, Flash, ArrowRight, Check, Wallet, WarningCircle } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";

// Interface untuk Data Token
interface TokenData {
  contractAddress: string;
  symbol: string;
  logo: string | null;
  decimals: number;
  rawBalance: string;
  formattedBal: string;
  priceUsd: number;
  valueUsd: number;
}

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; 
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006"; // 0x swap ke ETH biasanya via WETH unwrap atau native

const TokenLogo = ({ token }: { token: any }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { setSrc(token.logo || null); }, [token]);
  const sources = [token.logo, `https://tokens.1inch.io/${token.contractAddress}.png`].filter(Boolean);
  
  return (
    <img 
      src={src || sources[0] || "https://via.placeholder.com/32"} 
      className="w-full h-full object-cover" 
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} 
    />
  );
};

export const SwapView = () => {
  const { data: walletClient } = useWalletClient();
  const { address: ownerAddress, connector, chainId } = useAccount(); 
  const { switchChainAsync } = useSwitchChain();
  
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [accountType, setAccountType] = useState<string>("Detecting...");
  
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [loading, setLoading] = useState(false); 
  const [actionLoading, setActionLoading] = useState<string | null>(null); 
  const [toast, setToast] = useState<{ msg: string, type: "success" | "error" } | null>(null);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());

  // 1. FETCH VAULT DATA + PRICE
  const fetchVaultData = async () => {
    if (!walletClient) return;
    setLoading(true);

    try {
      const client = await getUnifiedSmartAccountClient(walletClient, connector?.id, 0n);
      if (!client.account) return;
      setVaultAddress(client.account.address);

      // @ts-ignore
      const isCSW = client.account.source === "coinbaseSmartAccount" || client.account.type === "coinbaseSmartAccount";
      setAccountType(isCSW ? "Coinbase Smart Wallet" : "Simple Account (EOA)");

      // A. Ambil Saldo (Alchemy)
      const balances = await alchemy.core.getTokenBalances(client.account.address);
      const nonZeroTokens = balances.tokenBalances.filter(t => t.tokenBalance && BigInt(t.tokenBalance) > 0n);
      const metadata = await Promise.all(nonZeroTokens.map(t => alchemy.core.getTokenMetadata(t.contractAddress)));
      
      const rawTokens = nonZeroTokens.map((t, i) => {
          const meta = metadata[i];
          return {
              contractAddress: t.contractAddress,
              symbol: meta.symbol || "UNKNOWN",
              logo: meta.logo || null,
              decimals: meta.decimals || 18,
              rawBalance: t.tokenBalance || "0",
              formattedBal: formatUnits(BigInt(t.tokenBalance || 0), meta.decimals || 18)
          };
      });

      // B. Ambil Harga (GeckoTerminal)
      const addresses = rawTokens.map(t => t.contractAddress);
      const prices = await fetchTokenPrices(addresses);

      // C. Filter & Hitung Value
      const liquidTokens = rawTokens.filter(t => {
          const isUSDC = t.contractAddress.toLowerCase() === USDC_ADDRESS.toLowerCase();
          const price = prices[t.contractAddress.toLowerCase()];
          // Tampilkan jika BUKAN USDC dan Punya Harga (bisa dijual)
          return !isUSDC && (price && price > 0);
      }).map(t => ({
          ...t,
          priceUsd: prices[t.contractAddress.toLowerCase()] || 0,
          valueUsd: (prices[t.contractAddress.toLowerCase()] || 0) * parseFloat(t.formattedBal)
      }));

      // Sort: Value Tertinggi ke Terendah
      liquidTokens.sort((a, b) => b.valueUsd - a.valueUsd);
      setTokens(liquidTokens);

    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { if(walletClient) fetchVaultData(); }, [walletClient, connector?.id]); 

  const toggleSelect = (addr: string) => {
      const newSet = new Set(selectedTokens);
      if (newSet.has(addr)) newSet.delete(addr); else newSet.add(addr);
      setSelectedTokens(newSet);
  };

  const toggleSelectAll = () => setSelectedTokens(selectedTokens.size === tokens.length ? new Set() : new Set(tokens.map(t => t.contractAddress)));

  // 🔥 0x SWAP LOGIC 🔥
  const get0xQuote = async (sellToken: string, sellAmount: string) => {
      const params = new URLSearchParams({
          chainId: "8453", // Base Chain ID
          sellToken: sellToken,
          buyToken: "ETH", // Target ETH
          sellAmount: sellAmount,
          slippagePercentage: "0.05" // 5% slippage (aman untuk dust)
      });

      const res = await fetch(`/api/0x/quote?${params.toString()}`);
      if (!res.ok) throw new Error("Gagal mengambil quote 0x");
      return await res.json();
  };

  const handleBatchSwap = async () => {
    if (!vaultAddress || selectedTokens.size === 0) return;
    if (!window.confirm(`Swap ${selectedTokens.size} assets to ETH using 0x API?`)) return;

    try {
        if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
        
        setActionLoading("Fetching 0x Quotes...");
        const client = await getUnifiedSmartAccountClient(walletClient!, connector?.id, 0n);

        const batchCalls: { to: Address; value: bigint; data: Hex }[] = [];
        
        // Loop token yang dipilih & Ambil Quote secara Paralel (hati-hati rate limit)
        // Kita proses chunking kecil agar aman
        const selectedList = tokens.filter(t => selectedTokens.has(t.contractAddress));
        
        for (const token of selectedList) {
            setActionLoading(`Quoting ${token.symbol}...`);
            
            try {
                // 1. Get Quote
                const quote = await get0xQuote(token.contractAddress, token.rawBalance);
                
                // 2. Cek apakah perlu Approve?
                // 0x API mengembalikan 'allowanceTarget'
                if (quote.allowanceTarget) {
                    batchCalls.push({
                        to: token.contractAddress as Address,
                        value: 0n,
                        data: encodeFunctionData({ 
                            abi: erc20Abi, 
                            functionName: "approve", 
                            args: [quote.allowanceTarget as Address, BigInt(token.rawBalance)] 
                        })
                    });
                }

                // 3. Masukkan Transaksi Swap
                batchCalls.push({
                    to: quote.to as Address,
                    value: BigInt(quote.value || 0),
                    data: quote.data as Hex
                });

                // Delay dikit biar gak kena rate limit API 0x (Free tier)
                await new Promise(r => setTimeout(r, 200));

            } catch (err) {
                console.error(`Skip ${token.symbol} error:`, err);
                setToast({ msg: `Skipped ${token.symbol}: No Liquidity/Error`, type: "error" });
            }
        }

        if (batchCalls.length === 0) {
            throw new Error("No valid quotes generated.");
        }

        setActionLoading(`Signing (${batchCalls.length / 2} Swaps)...`);

        // 4. KIRIM SEMUA SEBAGAI 1 UserOp (Atomik!)
        const userOpHash = await client.sendUserOperation({
            account: client.account!,
            calls: batchCalls
        });

        console.log("UserOp Hash:", userOpHash);
        setActionLoading("Executing On-Chain...");

        const receipt = await client.waitForUserOperationReceipt({ hash: userOpHash });
        if (!receipt.success) throw new Error("Transaction Reverted");

        setTokens(prev => prev.filter(t => !selectedTokens.has(t.contractAddress)));
        setSelectedTokens(new Set()); 
        setToast({ msg: "All Swaps Success! 🚀", type: "success" });

    } catch (e: any) {
        console.error("SWAP ERROR:", e);
        setToast({ msg: "Failed: " + (e.message || "Unknown error"), type: "error" });
    } finally {
        setActionLoading(null);
    }
  };

  return (
    <div className="pb-32 relative min-h-[50vh] p-4">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />
      {actionLoading && ( <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm"><div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl flex flex-col items-center gap-4"><div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div><div className="font-bold text-blue-600 animate-pulse">{actionLoading}</div></div></div> )}

      {/* HEADER CARD */}
      <div className="p-5 bg-gradient-to-br from-blue-900 to-indigo-900 text-white rounded-2xl shadow-lg mb-6 relative overflow-hidden">
        <div className="absolute top-4 right-4 text-[10px] px-2 py-1 rounded-full border border-white/20 bg-black/20 font-medium flex items-center gap-1"><Wallet className="w-3 h-3" /> {accountType}</div>
        <div className="flex items-center gap-2 text-blue-200 text-xs mb-1"><Flash className="w-3 h-3" /> 0x Powered</div>
        <h2 className="text-xl font-bold mb-2">Dust to ETH</h2>
        <div className="text-xs opacity-70 mb-2">
            Use the 0x API Aggregator to exchange small tokens (dust) for ETH at the best rate.
        </div>
        <div className="flex items-center justify-between mt-2"><code className="text-[10px] opacity-60 font-mono">{vaultAddress || "Connecting..."}</code></div>
      </div>

      {/* LIST HEADER */}
      <div className="flex items-center justify-between px-1 mb-2">
        <div className="flex items-center gap-3">
            <h3 className="font-semibold text-zinc-700 dark:text-zinc-300">Liquid Assets ({tokens.length})</h3>
            {tokens.length > 0 && ( <button onClick={toggleSelectAll} className="text-xs font-bold text-blue-600 hover:text-blue-700">{selectedTokens.size === tokens.length ? "Deselect All" : "Select All"}</button> )}
        </div>
        <button onClick={fetchVaultData} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:rotate-180 transition-all duration-500"><Refresh className="w-4 h-4 text-zinc-500" /></button>
      </div>

      {/* TOKEN LIST */}
      <div className="space-y-3">
        {loading ? ( <div className="text-center py-10 text-zinc-400 animate-pulse">Checking Prices & Liquidity...</div> ) : tokens.length === 0 ? ( <div className="text-center py-10 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800 text-zinc-400 text-sm">No tokens with value found.</div> ) : (
            tokens.map((token, i) => {
                const isSelected = selectedTokens.has(token.contractAddress);
                return (
                    <div key={i} onClick={() => toggleSelect(token.contractAddress)} className={`flex items-center justify-between p-4 border rounded-2xl shadow-sm cursor-pointer transition-all ${isSelected ? "bg-blue-50 border-blue-200 dark:bg-blue-900/10 dark:border-blue-800" : "bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800 hover:border-blue-200"}`}>
                        <div className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${isSelected ? "bg-blue-600 border-blue-600" : "bg-white border-zinc-300"}`}>{isSelected && <Check className="w-4 h-4 text-white" />}</div>
                            <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center overflow-hidden border border-zinc-200"><TokenLogo token={token} /></div>
                            <div>
                                <div className="font-bold text-sm">{token.symbol}</div>
                                <div className="text-xs text-zinc-500 font-mono">{parseFloat(token.formattedBal).toFixed(6)}</div>
                            </div>
                        </div>
                        <div className="text-right">
                           <div className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                             ${token.valueUsd.toFixed(2)}
                           </div>
                           <div className="flex items-center gap-1 justify-end opacity-50">
                             <ArrowRight className="w-3 h-3 text-zinc-300" />
                             <div className="text-[10px] font-bold text-zinc-400">ETH</div>
                           </div>
                        </div>
                    </div>
                );
            })
        )}
      </div>

      {/* FLOATING ACTION BUTTON */}
      {selectedTokens.size > 0 && (
          <div className="fixed bottom-24 left-4 right-4 z-40 animate-in slide-in-from-bottom-5">
            <button onClick={handleBatchSwap} className="w-full bg-blue-600 hover:bg-blue-700 text-white shadow-xl py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-colors">
                <Flash className="w-5 h-5" /> Swap {selectedTokens.size} Assets to ETH
            </button>
            <div className="text-center text-[10px] text-zinc-400 mt-2 bg-white/80 dark:bg-black/50 backdrop-blur-md py-1 rounded-full w-fit mx-auto px-3 shadow-sm border">
                Gas sponsored via Paymaster (if eligible)
            </div>
          </div>
      )}
    </div>
  );
};