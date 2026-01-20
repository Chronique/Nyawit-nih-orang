"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount } from "wagmi";
import { getSmartAccountClient } from "~/lib/smart-account";
import { alchemy } from "~/lib/alchemy";
import { formatUnits, encodeFunctionData, erc20Abi, type Address } from "viem";
import { Refresh, ArrowRight, Wallet, Check } from "iconoir-react";

// Alamat Native ETH untuk KyberSwap
const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const SwapView = () => {
  const { data: walletClient } = useWalletClient();
  const { address: ownerAddress } = useAccount();

  const [tokens, setTokens] = useState<any[]>([]);
  const [selectedToken, setSelectedToken] = useState<any>(null);
  const [quote, setQuote] = useState<any>(null);
  
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);

  // 1. Fetch Token List (Filter hanya token yang ada isinya & bukan ETH)
  const fetchTokens = async () => {
    if (!ownerAddress || !walletClient) return;
    setLoading(true);
    try {
      const client = await getSmartAccountClient(walletClient);
      const address = client.account?.address;
      if (!address) return;

      const balances = await alchemy.core.getTokenBalances(address);
      
      // Filter: Balance > 0
      const nonZero = balances.tokenBalances.filter(t => 
        t.tokenBalance && BigInt(t.tokenBalance) > 0n
      );

      const metadata = await Promise.all(
        nonZero.map(t => alchemy.core.getTokenMetadata(t.contractAddress))
      );

      const formatted = nonZero.map((t, i) => {
        const meta = metadata[i];
        return {
          ...t,
          name: meta.name,
          symbol: meta.symbol,
          logo: meta.logo,
          decimals: meta.decimals || 18,
          rawBalance: t.tokenBalance, // String hex
          formattedBal: formatUnits(BigInt(t.tokenBalance || 0), meta.decimals || 18)
        };
      });

      setTokens(formatted);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchTokens();
  }, [walletClient]);

  // 2. Get Quote from KyberSwap (Step 1)
  const getKyberQuote = async (token: any) => {
    if (!token) return;
    setQuote(null);
    
    try {
      // API Base URL untuk Base Mainnet
      const baseUrl = "https://aggregator-api.kyberswap.com/base/api/v1/routes";
      
      // Params
      const params = new URLSearchParams({
        tokenIn: token.contractAddress,
        tokenOut: NATIVE_ETH, // Target selalu ETH
        amountIn: BigInt(token.rawBalance).toString() // Swap Max
      });

      const res = await fetch(`${baseUrl}?${params.toString()}`);
      const data = await res.json();

      if (data.message === "Successfully" && data.data.routeSummary) {
        setQuote(data.data); // Simpan route lengkap
      } else {
        console.warn("No route found:", data);
        setQuote(null);
      }
    } catch (e) {
      console.error("Kyber API Error:", e);
    }
  };

  // Trigger quote saat token dipilih
  useEffect(() => {
    if (selectedToken) {
      getKyberQuote(selectedToken);
    }
  }, [selectedToken]);

  // 3. Execute Swap (Approve + Swap Batch)
  const handleSwap = async () => {
    if (!selectedToken || !quote || !walletClient) return;
    
    try {
      setSwapping(true);
      const client = await getSmartAccountClient(walletClient);
      const vaultAddress = client.account?.address;
      if (!vaultAddress) return;

      // --- STEP A: Build CallData dari Kyber (Step 2) ---
      // Kita harus minta "data transaksi" yang sudah di-encode oleh Kyber
      const buildRes = await fetch("https://aggregator-api.kyberswap.com/base/api/v1/route/build", {
        method: "POST",
        body: JSON.stringify({
          routeSummary: quote.routeSummary,
          sender: vaultAddress,
          recipient: vaultAddress, // Hasil swap masuk ke Vault lagi (aman)
          slippageTolerance: 100 // 1% Slippage (aman buat micin)
        })
      });
      
      const buildData = await buildRes.json();
      if (buildData.code !== 0) throw new Error("Gagal build route Kyber");

      const { data: swapCallData, routerAddress } = buildData.data;

      // --- STEP B: Siapkan UserOp (Batch) ---
      const uoCalls = [];

      // 1. Approve Token ke Router Kyber (Wajib)
      uoCalls.push({
        to: selectedToken.contractAddress as Address,
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [routerAddress as Address, BigInt(selectedToken.rawBalance)]
        })
      });

      // 2. Eksekusi Swap
      uoCalls.push({
        to: routerAddress as Address,
        value: 0n,
        data: swapCallData as `0x${string}`
      });

      console.log("Sending Batch Swap...", uoCalls);

      // --- STEP C: Kirim Gasless Tx ---
      const hash = await client.sendUserOperation({
        account: client.account,
        calls: uoCalls
      });

      console.log("Swap Hash:", hash);
      await new Promise(r => setTimeout(r, 5000)); // Tunggu mining
      
      alert("Swap Berhasil! Cek saldo ETH di Vault.");
      setSelectedToken(null);
      setQuote(null);
      fetchTokens(); // Refresh list

    } catch (e: any) {
      console.error(e);
      alert(`Swap Gagal: ${e.message}`);
    } finally {
      setSwapping(false);
    }
  };

  return (
    <div className="pb-20 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Dust Sweeper 🧹</h2>
        <button onClick={fetchTokens} className="p-2 bg-zinc-100 rounded-full hover:bg-zinc-200">
          <Refresh className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* LIST TOKEN */}
      <div className="space-y-2">
        {tokens.length === 0 && !loading && (
          <p className="text-center text-zinc-400 text-sm py-8">Tidak ada token untuk di-swap.</p>
        )}

        {tokens.map((token, i) => (
          <div 
            key={i} 
            onClick={() => setSelectedToken(token)}
            className={`p-3 rounded-xl border cursor-pointer transition-all ${
              selectedToken?.contractAddress === token.contractAddress 
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" 
              : "border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img 
                  src={token.logo || `https://tokens.1inch.io/${token.contractAddress}.png`} 
                  onError={(e) => e.currentTarget.style.display = 'none'}
                  className="w-8 h-8 rounded-full bg-zinc-200"
                />
                <div>
                  <div className="font-semibold text-sm">{token.symbol}</div>
                  <div className="text-xs text-zinc-500">{token.formattedBal}</div>
                </div>
              </div>
              
              {selectedToken?.contractAddress === token.contractAddress && (
                <div className="text-blue-600"><Check className="w-5 h-5" /></div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* QUOTE PREVIEW & ACTION */}
      {selectedToken && (
        <div className="fixed bottom-20 left-4 right-4 p-4 bg-zinc-900 text-white rounded-2xl shadow-2xl border border-zinc-700 animate-in slide-in-from-bottom-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-zinc-400">Estimasi Dapat:</div>
            <div className="font-bold text-xl text-green-400">
              {quote ? (+quote.routeSummary.amountOut / 1e18).toFixed(6) : "Loading..."} ETH
            </div>
          </div>

          <button
            disabled={!quote || swapping}
            onClick={handleSwap}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 py-3 rounded-xl font-bold flex items-center justify-center gap-2"
          >
            {swapping ? (
              <>Processing...</>
            ) : (
              <>
                Swap to ETH <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};