"use client";

import { useEffect, useState } from "react";
import { useWalletClient } from "wagmi";
import { getSmartAccountClient } from "~/lib/smart-account";
import { alchemy } from "~/lib/alchemy";
import { encodeFunctionData, erc20Abi, type Address, formatUnits } from "viem";
import { RefreshDouble, Coins } from "iconoir-react";

// KONFIGURASI
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; 
const NATIVE_ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const DEV_WALLET = "0x40F29D1365aBC82134fB43c877511082D8B8fcD1"; 
const MIN_VALUE_USD = 0.01; 

type OutputToken = "USDC" | "ETH";

interface SwappableToken {
  address: string;
  symbol: string;
  balance: bigint;
  formattedBalance: string;
  estimatedValueUsd: number;
  decimals: number;
}

export const SwapView = () => {
  const { data: walletClient } = useWalletClient();
  const [saAddress, setSaAddress] = useState<string | null>(null);
  
  const [swappableTokens, setSwappableTokens] = useState<SwappableToken[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  
  const [scanning, setScanning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [outputToken, setOutputToken] = useState<OutputToken>("USDC");

  // 1. SCAN & FILTER LOGIC
  useEffect(() => {
    const initAndScan = async () => {
      if (!walletClient) return;
      setScanning(true);
      setStatus("Scanning vault & checking liquidity...");
      
      try {
        const client = await getSmartAccountClient(walletClient);
        
        // FIX: Pastikan account ada
        if (!client.account) return; 

        const address = client.account.address;
        setSaAddress(address);
        
        const balances = await alchemy.core.getTokenBalances(address);
        const nonZero = balances.tokenBalances.filter(t => t.tokenBalance && BigInt(t.tokenBalance) > 0n);
        
        const validTokens: SwappableToken[] = [];
        let totalUsd = 0;

        for (const t of nonZero) {
          if (t.contractAddress.toLowerCase() === USDC_ADDRESS.toLowerCase() && outputToken === "USDC") continue;

          try {
            const rawBalance = BigInt(t.tokenBalance || "0");
            
            const params = new URLSearchParams({
              sellToken: t.contractAddress,
              buyToken: USDC_ADDRESS, 
              sellAmount: rawBalance.toString(),
            });

            const res = await fetch(`https://base.api.0x.org/swap/v1/price?${params}`, {
              headers: { '0x-api-key': process.env.NEXT_PUBLIC_0X_API_KEY || '' }
            });

            if (!res.ok) continue; 

            const data = await res.json();
            const buyAmountUsdc = parseFloat(data.buyAmount) / 1000000; 

            if (buyAmountUsdc > MIN_VALUE_USD) {
              const metadata = await alchemy.core.getTokenMetadata(t.contractAddress);
              
              validTokens.push({
                address: t.contractAddress,
                symbol: metadata.symbol || "UNK",
                decimals: metadata.decimals || 18,
                balance: rawBalance,
                formattedBalance: formatUnits(rawBalance, metadata.decimals || 18),
                estimatedValueUsd: buyAmountUsdc
              });
              
              totalUsd += buyAmountUsdc;
            }
          } catch (e) { }
        }

        setSwappableTokens(validTokens);
        setTotalValue(totalUsd);
        setStatus("");

      } catch (e: any) { 
        console.error(e);
        setStatus("Error scanning wallet.");
      } finally { 
        setScanning(false); 
      }
    };

    initAndScan();
  }, [walletClient, outputToken]);

  // 2. EXECUTE BATCH SWAP (SWEEP ALL)
  const handleSweep = async () => {
    if (!walletClient || !saAddress || swappableTokens.length === 0) return;
    setProcessing(true);
    setStatus("Fetching final quotes...");

    try {
      const client = await getSmartAccountClient(walletClient);
      
      // FIX: Cek account lagi sebelum transaksi
      if (!client.account) throw new Error("Akun tidak ditemukan.");

      const batchCalls = [];

      for (const token of swappableTokens) {
        const buyTokenAddr = outputToken === "USDC" ? USDC_ADDRESS : NATIVE_ETH_ADDRESS;

        const params = new URLSearchParams({
          sellToken: token.address,
          buyToken: buyTokenAddr, 
          sellAmount: token.balance.toString(),
          taker: saAddress,
        });

        const res = await fetch(`https://base.api.0x.org/swap/v1/quote?${params}`, {
          headers: { '0x-api-key': process.env.NEXT_PUBLIC_0X_API_KEY || '' }
        });

        if (!res.ok) continue;
        const quote = await res.json();
        
        const buyAmount = BigInt(quote.buyAmount);
        const feeAmount = (buyAmount * 5n) / 100n; 

        // 1. Approve
        batchCalls.push({
          to: token.address as Address,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [quote.allowanceTarget, token.balance]
          })
        });

        // 2. Swap
        batchCalls.push({
          to: quote.to as Address,
          value: 0n,
          data: quote.data as `0x${string}`
        });

        // 3. Fee
        if (feeAmount > 0n) {
           if (outputToken === "USDC") {
             batchCalls.push({
               to: USDC_ADDRESS as Address,
               value: 0n,
               data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [DEV_WALLET as Address, feeAmount] })
             });
           } else {
             batchCalls.push({
               to: DEV_WALLET as Address,
               value: feeAmount,
               data: "0x" as `0x${string}`
             });
           }
        }
      }

      if (batchCalls.length === 0) throw new Error("No valid quotes generated.");

      setStatus("Signing & Executing Bundle...");
      
      // FIX: Pass 'account' secara eksplisit
      const userOpHash = await client.sendUserOperation({
        account: client.account,
        calls: batchCalls 
      });
      
      setStatus(`Success! Tx Hash: ${userOpHash}`);
      setSwappableTokens([]); 
      setTotalValue(0);

    } catch (e: any) { 
      console.error(e);
      setStatus(`Failed: ${e.message}`); 
    } finally { 
      setProcessing(false); 
    }
  };

  return (
    <div className="space-y-5 pb-20">
      {/* 1. OUTPUT SELECTOR */}
      <div className="bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl flex">
          <button onClick={() => setOutputToken("USDC")} className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${outputToken === "USDC" ? "bg-white dark:bg-zinc-800 shadow text-blue-600" : "text-zinc-500"}`}>
            <Coins className="w-4 h-4" /> Receive USDC
          </button>
          <button onClick={() => setOutputToken("ETH")} className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${outputToken === "ETH" ? "bg-white dark:bg-zinc-800 shadow text-purple-600" : "text-zinc-500"}`}>
            <RefreshDouble className="w-4 h-4" /> Receive ETH
          </button>
      </div>
      
      {/* 2. SUMMARY BOX */}
      <div className="p-5 border border-blue-100 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 rounded-2xl flex items-center justify-between">
        <div>
          <div className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-1 uppercase tracking-wider">Estimated Value</div>
          <div className="text-3xl font-bold text-blue-900 dark:text-blue-100">
            ${totalValue.toFixed(2)}
          </div>
        </div>
        <div className="text-right">
           <div className="text-xs text-zinc-500">Dust Assets</div>
           <div className="text-xl font-semibold">{swappableTokens.length} <span className="text-sm font-normal">tokens</span></div>
        </div>
      </div>

      {/* 3. TOKEN LIST */}
      <div className="space-y-1">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider ml-1">Assets to Sweep ({">"}$0.01)</h3>
        {scanning ? (
           <div className="text-center py-8 text-zinc-400 animate-pulse text-sm">Checking liquidity & prices...</div>
        ) : swappableTokens.length === 0 ? (
           <div className="text-center py-8 border-2 border-dashed rounded-xl text-zinc-400 text-sm">
             No valuable dust found to swap.
           </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
             {swappableTokens.map((t) => (
               <div key={t.address} className="flex items-center justify-between p-3 bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-xl">
                 <div className="flex items-center gap-3">
                   <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-xs font-bold text-zinc-500">
                     {t.symbol[0]}
                   </div>
                   <div>
                     <div className="text-sm font-semibold">{t.symbol}</div>
                     <div className="text-[10px] text-zinc-500">{parseFloat(t.formattedBalance).toFixed(4)}</div>
                   </div>
                 </div>
                 <div className="text-sm font-medium text-green-600">
                   ~${t.estimatedValueUsd.toFixed(2)}
                 </div>
               </div>
             ))}
          </div>
        )}
      </div>

      {/* 4. ACTION BUTTON */}
      <button 
          onClick={handleSweep} 
          disabled={processing || scanning || swappableTokens.length === 0} 
          className={`w-full py-4 text-white rounded-2xl font-bold text-lg shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2 ${
            processing || scanning || swappableTokens.length === 0 
              ? "bg-zinc-300 dark:bg-zinc-800 cursor-not-allowed text-zinc-500 shadow-none" 
              : "bg-blue-600 hover:bg-blue-700 shadow-blue-600/30"
          }`}
      >
          {processing ? "Sweeping Dust..." : `Sweep All to ${outputToken}`}
      </button>

      {status && (
          <div className="text-center text-xs mt-2 bg-zinc-50 dark:bg-zinc-900 p-2 rounded text-zinc-500 border border-zinc-100 dark:border-zinc-800">
            {status}
          </div>
      )}
    </div>
  );
};