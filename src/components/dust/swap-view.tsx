"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount, useWriteContract, useSwitchChain } from "wagmi";
import { getUnifiedSmartAccountClient } from "~/lib/smart-account-switcher"; 
import { publicClient } from "~/lib/simple-smart-account"; 
import { alchemy } from "~/lib/alchemy";
import { formatUnits, encodeFunctionData, erc20Abi, type Address } from "viem";
import { baseSepolia } from "viem/chains"; 
import { Copy, Wallet, Refresh, Flash, ArrowRight, WarningCircle, Check, CheckCircle } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";

// ⚠️ PASTIKAN ALAMAT INI SESUAI DENGAN YANG DI DEPLOY DI REMIX
const SWAPPER_ADDRESS = "0xdBe1e97FB92E6511351FB8d01B0521ea9135Af12"; 

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // MockUSDC di Sepolia

// --- KOMPONEN LOGO ---
const TokenLogo = ({ token }: { token: any }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { setSrc(token.logo || null); }, [token]);

  const sources = [
    token.logo,
    `https://tokens.1inch.io/${token.contractAddress}.png`,
    `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${token.contractAddress}/logo.png`
  ].filter(Boolean);

  if (!src && sources.length === 0) return <div className="text-[10px] font-bold">?</div>;

  return (
    <img 
      src={src || sources[1] || sources[2]} 
      className="w-full h-full object-cover"
      onError={(e) => {
        const t = e.target as HTMLImageElement;
        t.style.display = 'none';
      }}
    />
  );
};

export const SwapView = () => {
  const { data: walletClient } = useWalletClient();
  const { connector, chainId } = useAccount(); 
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(false); 
  const [actionLoading, setActionLoading] = useState<string | null>(null); 
  const [toast, setToast] = useState<{ msg: string, type: "success" | "error" } | null>(null);

  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());

  // 1. FETCH DATA VAULT
  const fetchVaultData = async () => {
    if (!walletClient) return;
    setLoading(true);
    try {
      const client = await getUnifiedSmartAccountClient(walletClient, connector?.id);
      if (!client.account) return;

      const address = client.account.address;
      setVaultAddress(address);

      const balances = await alchemy.core.getTokenBalances(address);
      const nonZeroTokens = balances.tokenBalances.filter(t => 
          t.tokenBalance && BigInt(t.tokenBalance) > 0n
      );

      const metadata = await Promise.all(
          nonZeroTokens.map(t => alchemy.core.getTokenMetadata(t.contractAddress))
      );

      const formatted = nonZeroTokens.map((t, i) => {
          const meta = metadata[i];
          return {
              ...t,
              name: meta.name,
              symbol: meta.symbol,
              logo: meta.logo,
              contractAddress: t.contractAddress,
              decimals: meta.decimals || 18,
              rawBalance: t.tokenBalance,
              formattedBal: formatUnits(BigInt(t.tokenBalance || 0), meta.decimals || 18)
          };
      });

      const dustTokens = formatted.filter(t => t.contractAddress.toLowerCase() !== USDC_ADDRESS.toLowerCase());
      setTokens(dustTokens);

    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { fetchVaultData(); }, [walletClient, connector?.id]); 

  // --- SELECTION LOGIC ---
  const toggleSelect = (address: string) => {
      const newSet = new Set(selectedTokens);
      if (newSet.has(address)) newSet.delete(address);
      else newSet.add(address);
      setSelectedTokens(newSet);
  };

  const toggleSelectAll = () => {
      if (selectedTokens.size === tokens.length) {
          setSelectedTokens(new Set()); 
      } else {
          const all = new Set(tokens.map(t => t.contractAddress));
          setSelectedTokens(all); 
      }
  };

  // 🔥 CORE SWAP: SINGLE TOKEN (Tetap pakai execute biasa)
  const handleSwapSingle = async (token: any) => {
      // (Kode lama untuk swap satu per satu - disederhanakan)
      // ... Kita fokus ke Batch di bawah
      alert("Please use the 'Swap Selected' button below for efficiency!");
  };

  // 🔥🔥🔥 GOD MODE: BATCH SWAP (EXECUTE BATCH) 🔥🔥🔥
  const handleBatchSwap = async () => {
    if (!vaultAddress || selectedTokens.size === 0) return;
    
    if (!SWAPPER_ADDRESS || SWAPPER_ADDRESS.includes("PASTE")) {
        alert("Harap pasang Address Contract Swapper di kodingan dulu!");
        return;
    }

    if (!window.confirm(`Batch Swap ${selectedTokens.size} assets in 1 Transaction?`)) return;

    try {
        if (chainId !== baseSepolia.id) await switchChainAsync({ chainId: baseSepolia.id });
        setActionLoading("Preparing Bundle...");

        // ARRAY UNTUK MENAMPUNG SEMUA PERINTAH
        const dests: Address[] = [];
        const values: bigint[] = [];
        const funcs: `0x${string}`[] = [];

        // LOOPING TOKEN YANG DIPILIH
        for (const addr of selectedTokens) {
            const token = tokens.find(t => t.contractAddress === addr);
            if (!token) continue;

            // 1. MASUKKAN PERINTAH APPROVE KE ANTRIAN
            dests.push(token.contractAddress as Address);
            values.push(0n);
            funcs.push(encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [SWAPPER_ADDRESS as Address, BigInt(token.rawBalance)]
            }));

            // 2. MASUKKAN PERINTAH SWAP KE ANTRIAN
            const swapperAbi = [{
                name: "swapTokenForETH",
                type: "function",
                stateMutability: "nonpayable",
                inputs: [{type: "address", name: "token"}, {type: "uint256", name: "amount"}],
                outputs: []
            }] as const;

            dests.push(SWAPPER_ADDRESS as Address);
            values.push(0n);
            funcs.push(encodeFunctionData({
                abi: swapperAbi,
                functionName: "swapTokenForETH",
                args: [token.contractAddress as Address, BigInt(token.rawBalance)]
            }));
        }

        setActionLoading(`Signing 1 Transaction for ${funcs.length} Actions...`);

        // ABI executeBatch (Standar SimpleAccount)
        const batchAbi = [{
            type: 'function',
            name: 'executeBatch',
            inputs: [
                { name: 'dest', type: 'address[]' },
                { name: 'value', type: 'uint256[]' },
                { name: 'func', type: 'bytes[]' }
            ],
            outputs: [],
            stateMutability: 'payable'
        }] as const;

        // 🔥 FIRE ONE SHOT!
        const txHash = await writeContractAsync({
            address: vaultAddress as Address,
            abi: batchAbi,
            functionName: 'executeBatch',
            args: [dests, values, funcs],
            chainId: baseSepolia.id
        });

        console.log("Batch Hash:", txHash);
        setToast({ msg: "Batch Swap Submitted! 🚀", type: "success" });
        setSelectedTokens(new Set()); 
        
        setActionLoading("Waiting for Block...");
        await new Promise(r => setTimeout(r, 5000));
        await fetchVaultData();

    } catch (e: any) {
        console.error(e);
        // Fallback kalau contract tidak support batch (jarang terjadi di SimpleAccount modern)
        if (e.message.includes("function selector")) {
            setToast({ msg: "This Vault version doesn't support Batching. Update Contract.", type: "error" });
        } else {
            setToast({ msg: "Failed: " + (e.shortMessage || e.message), type: "error" });
        }
    } finally {
        setActionLoading(null);
    }
  };

  return (
    <div className="pb-32 relative min-h-[50vh]">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      {/* LOADING OVERLAY */}
      {actionLoading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
           <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
              <div className="text-sm font-bold text-center animate-pulse text-yellow-500">{actionLoading}</div>
              <div className="text-xs text-zinc-500">Confirm 1 Transaction in Wallet</div>
           </div>
        </div>
      )}

      {/* HEADER */}
      <div className="p-5 bg-gradient-to-br from-yellow-900 to-amber-900 text-white rounded-2xl shadow-lg mb-6 relative overflow-hidden">
        <div className="flex items-center gap-2 text-yellow-200 text-xs mb-1">
          <Flash className="w-3 h-3" /> Dust Sweeper
        </div>
        <h2 className="text-xl font-bold mb-2">Swap Dust to ETH</h2>
        
        <div className="flex items-center justify-between bg-black/20 p-3 rounded-xl border border-white/10">
          <code className="text-xs font-mono opacity-80 truncate max-w-[150px]">
            {vaultAddress || "Loading..."}
          </code>
          <button onClick={() => { if (vaultAddress) { navigator.clipboard.writeText(vaultAddress); setToast({ msg: "Address Copied!", type: "success" }); } }}>
            <Copy className="w-4 h-4 hover:text-yellow-400 transition-colors" />
          </button>
        </div>
      </div>

      {/* CONTROLS (Select All) */}
      <div className="flex items-center justify-between px-1 mb-2">
        <div className="flex items-center gap-3">
            <h3 className="font-semibold text-zinc-700 dark:text-zinc-300">Dust Assets ({tokens.length})</h3>
            {tokens.length > 0 && (
                <button 
                    onClick={toggleSelectAll}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700"
                >
                    {selectedTokens.size === tokens.length ? "Deselect All" : "Select All"}
                </button>
            )}
        </div>
        <button onClick={fetchVaultData} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:rotate-180 transition-all duration-500">
           <Refresh className="w-4 h-4 text-zinc-500" />
        </button>
      </div>

      <div className="space-y-3">
        {loading ? (
            <div className="text-center py-10 text-zinc-400 animate-pulse">Scanning Vault...</div>
        ) : tokens.length === 0 ? (
            <div className="text-center py-10 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800">
               <div className="text-zinc-400 text-sm mb-1">No dust tokens found.</div>
            </div>
        ) : (
            tokens.map((token, i) => {
                const isSelected = selectedTokens.has(token.contractAddress);
                return (
                    <div 
                        key={i} 
                        onClick={() => toggleSelect(token.contractAddress)}
                        className={`flex items-center justify-between p-4 border rounded-2xl shadow-sm cursor-pointer transition-all ${
                            isSelected 
                            ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-900/10 dark:border-yellow-800" 
                            : "bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800 hover:border-zinc-300"
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${isSelected ? "bg-yellow-500 border-yellow-500" : "bg-white border-zinc-300"}`}>
                                {isSelected && <Check className="w-4 h-4 text-white" />}
                            </div>

                            <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center overflow-hidden border border-zinc-200">
                                <TokenLogo token={token} />
                            </div>
                            <div>
                                <div className="font-bold text-sm">{token.symbol}</div>
                                <div className="text-xs text-zinc-500">{parseFloat(token.formattedBal).toFixed(6)}</div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 opacity-50">
                            <ArrowRight className="w-4 h-4 text-zinc-300" />
                            <div className="text-xs font-bold text-zinc-400">ETH</div>
                        </div>
                    </div>
                );
            })
        )}
      </div>

      {/* FLOATING ACTION BUTTON */}
      {selectedTokens.size > 0 && (
          <div className="fixed bottom-24 left-4 right-4 z-40 animate-in slide-in-from-bottom-5">
            <button 
                onClick={handleBatchSwap}
                className="w-full bg-yellow-500 hover:bg-yellow-600 text-white shadow-xl shadow-yellow-500/30 py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
            >
                <Flash className="w-5 h-5" />
                Batch Swap {selectedTokens.size} Assets
            </button>
            <div className="text-[10px] text-center mt-2 text-zinc-500 font-medium">
                1 Click • 1 Signature • {selectedTokens.size * 2} Actions
            </div>
          </div>
      )}
    </div>
  );
};