"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount, useBalance, useSwitchChain } from "wagmi";

// Libs
import { getUnifiedSmartAccountClient } from "~/lib/smart-account-switcher"; 
import { alchemy } from "~/lib/alchemy";
import { formatUnits, encodeFunctionData, erc20Abi, type Address, parseEther, formatEther, toHex, type Hex } from "viem";
import { baseSepolia } from "viem/chains"; 

// Icons & UI
import { Copy, Refresh, Flash, ArrowRight, Check, Plus, Wallet } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";

// ✅ CONFIG ADDRESS
const SWAPPER_ADDRESS = "0xdBe1e97FB92E6511351FB8d01B0521ea9135Af12"; 
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; 

const TokenLogo = ({ token }: { token: any }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { setSrc(token.logo || null); }, [token]);
  const sources = [token.logo, `https://tokens.1inch.io/${token.contractAddress}.png`].filter(Boolean);
  if (!src && sources.length === 0) return <div className="text-[10px] font-bold">?</div>;
  return <img src={src || sources[0]} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />;
};

export const SwapView = () => {
  const { data: walletClient } = useWalletClient();
  const { address: ownerAddress, connector, chainId } = useAccount(); 
  const { switchChainAsync } = useSwitchChain();
  
  // Balance Checker
  const { data: swapperBalance, refetch: refetchSwapper } = useBalance({
    address: SWAPPER_ADDRESS as Address,
    chainId: baseSepolia.id
  });

  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [accountType, setAccountType] = useState<string>("Detecting...");
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(false); 
  const [actionLoading, setActionLoading] = useState<string | null>(null); 
  const [toast, setToast] = useState<{ msg: string, type: "success" | "error" } | null>(null);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());

  // 1. FETCH DATA (Logic Sama untuk Keduanya)
  const fetchVaultData = async () => {
    if (!walletClient) return;
    setLoading(true);
    refetchSwapper();

    try {
      const client = await getUnifiedSmartAccountClient(walletClient, connector?.id, 0n);
      if (!client.account) return;
      setVaultAddress(client.account.address);

      // Deteksi UI
      // @ts-ignore
      const isCSW = client.account.source === "coinbaseSmartAccount" || client.account.type === "coinbaseSmartAccount";
      setAccountType(isCSW ? "Coinbase Smart Wallet" : "Simple Account (EOA)");

      // Fetch Balances
      const balances = await alchemy.core.getTokenBalances(client.account.address);
      const nonZeroTokens = balances.tokenBalances.filter(t => t.tokenBalance && BigInt(t.tokenBalance) > 0n);
      const metadata = await Promise.all(nonZeroTokens.map(t => alchemy.core.getTokenMetadata(t.contractAddress)));
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
      setTokens(formatted.filter(t => t.contractAddress.toLowerCase() !== USDC_ADDRESS.toLowerCase()));

    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { if(walletClient) fetchVaultData(); }, [walletClient, connector?.id]); 

  // Selection Logic
  const toggleSelect = (addr: string) => {
      const newSet = new Set(selectedTokens);
      if (newSet.has(addr)) newSet.delete(addr); else newSet.add(addr);
      setSelectedTokens(newSet);
  };
  const toggleSelectAll = () => setSelectedTokens(selectedTokens.size === tokens.length ? new Set() : new Set(tokens.map(t => t.contractAddress)));

  const handleTopUpSwapper = async () => {
      if(!ownerAddress) return;
      const amount = prompt("Isi saldo Swapper (ETH):", "0.01");
      if(!amount) return;
      try { await walletClient?.sendTransaction({ to: SWAPPER_ADDRESS as Address, value: parseEther(amount), chain: baseSepolia }); setToast({msg: "Topup Sent!", type: "success"}); } catch(e) { console.error(e); }
  };

  // 🔥🔥🔥 HYBRID BATCH SWAP (THE SOLUTION) 🔥🔥🔥
  const handleBatchSwap = async () => {
    if (!vaultAddress || selectedTokens.size === 0) return;
    
    // Cek Bensin Swapper
    if (!swapperBalance || swapperBalance.value < parseEther("0.0001") * BigInt(selectedTokens.size)) {
        alert("⚠️ SWAPPER HABIS BENSIN! Isi ulang dulu.");
        return;
    }

    if (!window.confirm(`Swap ${selectedTokens.size} assets?\nVia: ${accountType}`)) return;

    try {
        if (chainId !== baseSepolia.id) await switchChainAsync({ chainId: baseSepolia.id });
        
        const isCoinbase = connector?.id === 'coinbaseWalletSDK';

        // ============================================
        // 🛣️ JALUR 1: COINBASE (Logic Withdraw / Native Batch)
        // ============================================
        if (isCoinbase) {
            setActionLoading("Sending to Coinbase...");
            
            const calls = [];
            for (const addr of selectedTokens) {
                const token = tokens.find(t => t.contractAddress === addr);
                if (!token) continue;

                // 1. Approve
                calls.push({
                    to: token.contractAddress as Address,
                    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SWAPPER_ADDRESS as Address, BigInt(token.rawBalance)] }),
                    value: toHex(0n) // Wajib format Hex
                });

                // 2. Swap
                const swapperAbi = [{ name: "swapTokenForETH", type: "function", stateMutability: "nonpayable", inputs: [{type: "address", name: "token"}, {type: "uint256", name: "amount"}], outputs: [] }] as const;
                calls.push({
                    to: SWAPPER_ADDRESS as Address,
                    data: encodeFunctionData({ abi: swapperAbi, functionName: "swapTokenForETH", args: [token.contractAddress as Address, BigInt(token.rawBalance)] }),
                    value: toHex(0n)
                });
            }

            // 🔥 TEMBAK LANGSUNG KE API WALLET (EIP-5792)
            // Ini bypass error Raw Sign, karena Coinbase native batching support ini.
            const id = await walletClient?.request({
                method: 'wallet_sendCalls' as any,
                params: [{
                    version: '1.0',
                    chainId: toHex(baseSepolia.id),
                    from: ownerAddress as Address,
                    calls: calls
                }] as any
            });
            console.log("Coinbase Batch ID:", id);
            
            // Tunggu sebentar (Manual delay karena wallet_sendCalls return ID, bukan receipt)
            setActionLoading("Processing...");
            await new Promise(r => setTimeout(r, 5000));
        } 
        
        // ============================================
        // 🛣️ JALUR 2: EOA / METAMASK (Logic UserOp / Permissionless)
        // ============================================
        else {
            setActionLoading("Building UserOp...");

            // Switcher akan kasih SimpleAccount Client
            const client = await getUnifiedSmartAccountClient(walletClient!, connector?.id, 0n);

            const batchCalls: { to: Address; value: bigint; data: Hex }[] = [];
            for (const addr of selectedTokens) {
                const token = tokens.find(t => t.contractAddress === addr);
                if (!token) continue;
                // Approve
                batchCalls.push({
                    to: token.contractAddress as Address,
                    value: 0n,
                    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SWAPPER_ADDRESS as Address, BigInt(token.rawBalance)] })
                });
                // Swap
                const swapperAbi = [{ name: "swapTokenForETH", type: "function", stateMutability: "nonpayable", inputs: [{type: "address", name: "token"}, {type: "uint256", name: "amount"}], outputs: [] }] as const;
                batchCalls.push({
                    to: SWAPPER_ADDRESS as Address,
                    value: 0n,
                    data: encodeFunctionData({ abi: swapperAbi, functionName: "swapTokenForETH", args: [token.contractAddress as Address, BigInt(token.rawBalance)] })
                });
            }

            // Kirim via Bundler (Gas Sponsored)
            const userOpHash = await client.sendUserOperation({
                account: client.account!,
                calls: batchCalls
            });
            
            setActionLoading("Waiting for Bundler...");
            const receipt = await client.waitForUserOperationReceipt({ hash: userOpHash });
            console.log("Receipt:", receipt);
        }

        // --- SUCCESS STATE ---
        setTokens(prev => prev.filter(t => !selectedTokens.has(t.contractAddress)));
        setSelectedTokens(new Set()); 
        setToast({ msg: "Swap Success! 🚀", type: "success" });
        refetchSwapper();

    } catch (e: any) {
        console.error("BATCH ERROR:", e);
        setToast({ msg: "Failed: " + (e.shortMessage || e.message), type: "error" });
    } finally {
        setActionLoading(null);
    }
  };

  return (
    <div className="pb-32 relative min-h-[50vh] p-4">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />
      {actionLoading && ( <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm"><div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl flex flex-col items-center gap-4"><div className="w-10 h-10 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin"></div><div className="font-bold text-yellow-500">{actionLoading}</div></div></div> )}

      <div className="p-5 bg-gradient-to-br from-yellow-900 to-amber-900 text-white rounded-2xl shadow-lg mb-6 relative overflow-hidden">
        <div className="absolute top-4 right-4 text-[10px] px-2 py-1 rounded-full border border-white/20 bg-black/20 font-medium flex items-center gap-1"><Wallet className="w-3 h-3" /> {accountType}</div>
        <div className="flex items-center gap-2 text-yellow-200 text-xs mb-1"><Flash className="w-3 h-3" /> Dust Sweeper</div>
        <h2 className="text-xl font-bold mb-2">Swap Dust to ETH</h2>
        <div className="flex items-center justify-between mt-4"><code className="text-[10px] opacity-60 font-mono">{vaultAddress || "Connecting..."}</code></div>
      </div>

      <div className="flex items-center justify-between px-1 mb-2">
        <div className="flex items-center gap-3">
            <h3 className="font-semibold text-zinc-700 dark:text-zinc-300">Assets ({tokens.length})</h3>
            {tokens.length > 0 && ( <button onClick={toggleSelectAll} className="text-xs font-bold text-blue-600 hover:text-blue-700">{selectedTokens.size === tokens.length ? "Deselect All" : "Select All"}</button> )}
        </div>
        <button onClick={fetchVaultData} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:rotate-180 transition-all duration-500"><Refresh className="w-4 h-4 text-zinc-500" /></button>
      </div>

      <div className="space-y-3">
        {loading ? ( <div className="text-center py-10 text-zinc-400 animate-pulse">Scanning Vault...</div> ) : tokens.length === 0 ? ( <div className="text-center py-10 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800 text-zinc-400 text-sm">No dust tokens found.</div> ) : (
            tokens.map((token, i) => {
                const isSelected = selectedTokens.has(token.contractAddress);
                return (
                    <div key={i} onClick={() => toggleSelect(token.contractAddress)} className={`flex items-center justify-between p-4 border rounded-2xl shadow-sm cursor-pointer ${isSelected ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-900/10 dark:border-yellow-800" : "bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800"}`}>
                        <div className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded-full border flex items-center justify-center ${isSelected ? "bg-yellow-500 border-yellow-500" : "bg-white border-zinc-300"}`}>{isSelected && <Check className="w-4 h-4 text-white" />}</div>
                            <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center overflow-hidden border border-zinc-200"><TokenLogo token={token} /></div>
                            <div><div className="font-bold text-sm">{token.symbol}</div><div className="text-xs text-zinc-500 font-mono">{parseFloat(token.formattedBal).toFixed(6)}</div></div>
                        </div>
                        <div className="flex items-center gap-2 opacity-50"><ArrowRight className="w-4 h-4 text-zinc-300" /><div className="text-xs font-bold text-zinc-400">ETH</div></div>
                    </div>
                );
            })
        )}
      </div>

      {selectedTokens.size > 0 && (
          <div className="fixed bottom-24 left-4 right-4 z-40 animate-in slide-in-from-bottom-5">
            <button onClick={handleBatchSwap} className="w-full bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-600 text-white shadow-xl py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2">
                <Flash className="w-5 h-5" /> Batch Swap {selectedTokens.size} Assets
            </button>
          </div>
      )}
    </div>
  );
};