"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount, useWriteContract, useSwitchChain } from "wagmi";
import { getUnifiedSmartAccountClient } from "~/lib/smart-account-switcher"; 
import { publicClient } from "~/lib/simple-smart-account"; 
import { alchemy } from "~/lib/alchemy";
import { formatUnits, encodeFunctionData, erc20Abi, type Address } from "viem";
import { baseSepolia } from "viem/chains"; 
import { Copy, Wallet, Refresh, Flash, ArrowRight, WarningCircle, CheckCircle, Circle, Check } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";

// ⚠️ PASTIKAN ALAMAT INI SESUAI DENGAN YANG DI DEPLOY DI REMIX
const SWAPPER_ADDRESS = "0xdBe1e97FB92E6511351FB8d01B0521ea9135Af12"; 

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // MockUSDC di Sepolia

// --- KOMPONEN LOGO (Kecil) ---
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

  // STATE UNTUK SELECT ALL
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
          setSelectedTokens(new Set()); // Deselect All
      } else {
          const all = new Set(tokens.map(t => t.contractAddress));
          setSelectedTokens(all); // Select All
      }
  };

  // --- CORE SWAP FUNCTION (REUSABLE) ---
  const executeSwapProcess = async (token: any, index: number, total: number) => {
      // 1. Approve
      setActionLoading(`(${index}/${total}) Approving ${token.symbol}...`);
      
      const executeAbi = [{
        type: 'function',
        name: 'execute',
        inputs: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }],
        outputs: [],
        stateMutability: 'payable'
      }] as const;

      const approveData = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [SWAPPER_ADDRESS as Address, BigInt(token.rawBalance)]
      });

      await writeContractAsync({
          address: vaultAddress as Address,
          abi: executeAbi,
          functionName: 'execute',
          args: [token.contractAddress as Address, 0n, approveData],
          chainId: baseSepolia.id
      });
      
      // Jeda simulasi (tunggu blok)
      await new Promise(r => setTimeout(r, 4000)); 

      // 2. Swap
      setActionLoading(`(${index}/${total}) Swapping ${token.symbol}...`);

      const swapperAbi = [{
          name: "swapTokenForETH",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [{type: "address", name: "token"}, {type: "uint256", name: "amount"}],
          outputs: []
      }] as const;

      const swapData = encodeFunctionData({
          abi: swapperAbi,
          functionName: "swapTokenForETH",
          args: [token.contractAddress as Address, BigInt(token.rawBalance)]
      });

      await writeContractAsync({
          address: vaultAddress as Address,
          abi: executeAbi,
          functionName: 'execute',
          args: [SWAPPER_ADDRESS as Address, 0n, swapData],
          chainId: baseSepolia.id
      });
  };

  // --- BATCH SWAP HANDLER ---
  const handleBatchSwap = async () => {
    if (!vaultAddress || selectedTokens.size === 0) return;
    
    // Validasi Address Swapper
    if (!SWAPPER_ADDRESS || SWAPPER_ADDRESS.includes("PASTE")) {
        alert("Harap pasang Address Contract Swapper di kodingan dulu!");
        return;
    }

    if (!window.confirm(`Swap ${selectedTokens.size} assets?\n\nNote: You will need to confirm multiple transactions in MetaMask.`)) return;

    try {
        if (chainId !== baseSepolia.id) await switchChainAsync({ chainId: baseSepolia.id });

        let i = 1;
        const total = selectedTokens.size;
        
        // LOOPING TRANSAKSI
        for (const addr of selectedTokens) {
            const token = tokens.find(t => t.contractAddress === addr);
            if (token) {
                await executeSwapProcess(token, i, total);
                i++;
            }
        }

        console.log("Batch Swap Done");
        setToast({ msg: "All Swaps Completed! 🚀", type: "success" });
        setSelectedTokens(new Set()); // Reset selection
        await new Promise(r => setTimeout(r, 3000));
        await fetchVaultData();

    } catch (e: any) {
        console.error(e);
        setToast({ msg: "Process Interrupted: " + (e.shortMessage || e.message), type: "error" });
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
              <div className="text-xs text-zinc-500">Please confirm transactions in wallet</div>
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
                            <div className={`w-6 h-6 rounded-full border flex items-center justify-center ${isSelected ? "bg-yellow-500 border-yellow-500" : "bg-white border-zinc-300"}`}>
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
                Swap {selectedTokens.size} Selected
            </button>
          </div>
      )}

      <div className="mt-20 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-xl flex gap-3 items-start">
         <WarningCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
         <div className="text-xs text-blue-800 dark:text-blue-200">
            <strong>Simulation Mode:</strong> EOA Wallet will require 2 confirmations per token (Approve + Swap).
         </div>
      </div>
    </div>
  );
};