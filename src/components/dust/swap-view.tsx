"use client";

import { useEffect, useState } from "react";
import { useWalletClient } from "wagmi";
import { getSmartAccountClient } from "~/lib/smart-account";
import { alchemy } from "~/lib/alchemy";
import { encodeFunctionData, erc20Abi, type Address } from "viem";
import { RefreshDouble, Coins, WarningCircle } from "iconoir-react";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; 
const NATIVE_ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const DEV_WALLET = "0xYOUR_DEV_WALLET_ADDRESS"; // <--- GANTI INI!

type OutputToken = "USDC" | "ETH";

export const SwapView = () => {
  const { data: walletClient } = useWalletClient();
  const [saAddress, setSaAddress] = useState<string | null>(null);
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [outputToken, setOutputToken] = useState<OutputToken>("USDC");

  useEffect(() => {
    const init = async () => {
      if (!walletClient) return;
      try {
        const client = await getSmartAccountClient(walletClient);
        setSaAddress(client.account.address);
        const balances = await alchemy.core.getTokenBalances(client.account.address);
        const nonZero = balances.tokenBalances.filter(t => t.tokenBalance && BigInt(t.tokenBalance) > 0n);
        
        setTokens(nonZero.map(t => ({
            address: t.contractAddress,
            balance: BigInt(t.tokenBalance || "0")
        })));
      } catch (e) { console.error(e); }
    };
    init();
  }, [walletClient]);

  const handleSweep = async () => {
    if (!walletClient || !saAddress || tokens.length === 0) return;
    setLoading(true);
    setStatus(`Fetching quotes...`);

    try {
      const client = await getSmartAccountClient(walletClient);
      const batchCalls = [];

      for (const token of tokens) {
        if (token.address.toLowerCase() === USDC_ADDRESS.toLowerCase() && outputToken === "USDC") continue;

        const params = new URLSearchParams({
          sellToken: token.address,
          buyToken: outputToken === "USDC" ? USDC_ADDRESS : NATIVE_ETH_ADDRESS, 
          sellAmount: token.balance.toString(),
          taker: saAddress,
        });

        const res = await fetch(`https://base.api.0x.org/swap/v1/quote?${params}`, {
          headers: { '0x-api-key': process.env.NEXT_PUBLIC_0X_API_KEY || '' }
        });

        if (!res.ok) continue;
        const quote = await res.json();
        
        // Fee 5%
        const feeAmount = (BigInt(quote.buyAmount) * 5n) / 100n; 

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

      if (batchCalls.length === 0) throw new Error("No valid swaps");

      setStatus("Signing transaction...");
      const hash = await client.sendUserOperation({ calls: batchCalls });
      setStatus(`Success! Hash: ${hash}`);

    } catch (e: any) { setStatus(`Error: ${e.message}`); } 
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div className="bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl flex">
          <button onClick={() => setOutputToken("USDC")} className={`flex-1 py-3 text-sm font-bold rounded-lg ${outputToken === "USDC" ? "bg-white shadow text-blue-600" : "text-zinc-500"}`}>Receive USDC</button>
          <button onClick={() => setOutputToken("ETH")} className={`flex-1 py-3 text-sm font-bold rounded-lg ${outputToken === "ETH" ? "bg-white shadow text-purple-600" : "text-zinc-500"}`}>Receive ETH</button>
      </div>
      
      <div className="p-4 border border-blue-100 bg-blue-50 rounded-xl text-sm text-blue-800 flex items-start gap-3">
        <WarningCircle className="w-5 h-5 shrink-0 mt-0.5" />
        <div>Found {tokens.length} assets ready to swap.</div>
      </div>

      <button onClick={handleSweep} disabled={loading || tokens.length === 0} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 disabled:bg-zinc-400">
          {loading ? "Processing..." : `Sweep All`}
      </button>
      {status && <div className="text-center text-xs mt-2 bg-zinc-100 p-2 rounded">{status}</div>}
    </div>
  );
};