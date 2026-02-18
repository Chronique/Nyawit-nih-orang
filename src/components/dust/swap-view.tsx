"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount, useSwitchChain } from "wagmi";
import { getUnifiedSmartAccountClient } from "~/lib/smart-account-switcher";
import { alchemy } from "~/lib/alchemy";
import { fetchTokenPrices } from "~/lib/price";
import { formatUnits, encodeFunctionData, erc20Abi, type Address } from "viem";
import { base } from "viem/chains";
import { Refresh, Flash, ArrowRight, Check } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";

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
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const LIFI_API_URL = "https://li.quest/v1";
const FEE_RECIPIENT = "0x4fba95e4772be6d37a0c931D00570Fe2c9675524";
const FEE_PERCENTAGE = "0.05";

const TokenLogo = ({ token }: { token: any }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { setSrc(token.logo || null); }, [token]);
  return (
    <img
      src={src || `https://tokens.1inch.io/${token.contractAddress}.png`}
      className="w-8 h-8 rounded-full object-cover"
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
};

export const SwapView = () => {
  const { data: walletClient } = useWalletClient();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [swapProgress, setSwapProgress] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [useLifiFallback] = useState(true);

  const loadDustTokens = async () => {
    if (!walletClient) return;
    setLoading(true);
    try {
      const client = await getUnifiedSmartAccountClient(walletClient, undefined);
      const vaultAddr = client.account.address;
      const balances = await alchemy.core.getTokenBalances(vaultAddr);
      const nonZeroTokens = balances.tokenBalances.filter((t) => {
        const isUSDC = t.contractAddress.toLowerCase() === USDC_ADDRESS.toLowerCase();
        return !isUSDC && BigInt(t.tokenBalance || "0") > 0n;
      });
      if (nonZeroTokens.length === 0) { setTokens([]); return; }

      const metadata = await Promise.all(
        nonZeroTokens.map((t) => alchemy.core.getTokenMetadata(t.contractAddress))
      );
      const addresses = nonZeroTokens.map((t) => t.contractAddress);
      const prices = await fetchTokenPrices(addresses);

      const formatted: TokenData[] = nonZeroTokens.map((t, i) => {
        const meta = metadata[i];
        const decimals = meta.decimals || 18;
        const rawBal = t.tokenBalance || "0";
        const fmtBal = formatUnits(BigInt(rawBal), decimals);
        const price = prices[t.contractAddress.toLowerCase()] || 0;
        return {
          contractAddress: t.contractAddress,
          symbol: meta.symbol || "UNKNOWN",
          logo: meta.logo || null,
          decimals,
          rawBalance: rawBal,
          formattedBal: fmtBal,
          priceUsd: price,
          valueUsd: parseFloat(fmtBal) * price,
        };
      });

      const validDust = formatted.filter((t) => t.valueUsd > 0.000001);
      validDust.sort((a, b) => b.valueUsd - a.valueUsd);
      setTokens(validDust);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (walletClient) loadDustTokens(); }, [walletClient]);

  const toggleToken = (addr: string) => {
    const newSet = new Set(selectedTokens);
    if (newSet.has(addr)) newSet.delete(addr);
    else newSet.add(addr);
    setSelectedTokens(newSet);
  };

  const selectAll = () => {
    if (selectedTokens.size === tokens.length) setSelectedTokens(new Set());
    else setSelectedTokens(new Set(tokens.map((t) => t.contractAddress)));
  };

  const getZeroExQuote = async (token: TokenData, amount: string) => {
    const params = new URLSearchParams({
      chainId: "8453",
      sellToken: token.contractAddress,
      buyToken: WETH_ADDRESS,
      sellAmount: amount,
      feeRecipient: FEE_RECIPIENT,
      buyTokenPercentageFee: FEE_PERCENTAGE,
    });
    const res = await fetch(`/api/0x/quote?${params}`);
    if (!res.ok) throw new Error("0x No Route");
    return res.json();
  };

  const getLifiQuote = async (token: TokenData, amount: string, fromAddress: string) => {
    const params = new URLSearchParams({
      fromChain: "8453",
      toChain: "8453",
      fromToken: token.contractAddress,
      toToken: WETH_ADDRESS,
      fromAmount: amount,
      fromAddress,
    });
    const res = await fetch(`${LIFI_API_URL}/quote?${params}`);
    if (!res.ok) { const err = await res.json(); throw new Error(err.message || "LI.FI No Route"); }
    return res.json();
  };

  const handleBatchSwap = async () => {
    if (!walletClient || selectedTokens.size === 0) return;
    setSwapping(true);
    setSwapProgress("Initializing...");
    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      const client = await getUnifiedSmartAccountClient(walletClient, undefined);
      const vaultAddress = client.account.address;

      const batchCalls: any[] = [];
      const tokensToSwap = tokens.filter((t) => selectedTokens.has(t.contractAddress));
      let successCount = 0;

      for (const token of tokensToSwap) {
        setSwapProgress(`Routing ${token.symbol}...`);
        try {
          let txData = null;
          let toAddress = null;
          let value = 0n;

          try {
            const quote0x = await getZeroExQuote(token, token.rawBalance);
            txData = quote0x.transaction.data;
            toAddress = quote0x.transaction.to;
            value = BigInt(quote0x.transaction.value || 0);
          } catch {
            if (useLifiFallback) {
              const quoteLifi = await getLifiQuote(token, token.rawBalance, vaultAddress);
              txData = quoteLifi.transactionRequest.data;
              toAddress = quoteLifi.transactionRequest.to;
              value = BigInt(quoteLifi.transactionRequest.value || 0);
            } else throw new Error("No route");
          }

          if (txData && toAddress) {
            const approveData = encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [toAddress as Address, BigInt(token.rawBalance)],
            });
            batchCalls.push({ to: token.contractAddress as Address, value: 0n, data: approveData });
            batchCalls.push({ to: toAddress as Address, value, data: txData });
            successCount++;
          }
        } catch (e) {
          console.error(`Failed routing ${token.symbol}:`, e);
        }
      }

      if (batchCalls.length === 0) {
        setToast({ msg: "No routes found. Try later.", type: "error" });
        return;
      }

      setSwapProgress(`Signing Batch Swap (${successCount} Assets)...`);

      // ✅ Tidak perlu account: client.account!
      const txHash = await client.sendUserOperation({ calls: batchCalls });

      setSwapProgress("Transaction Sent! Waiting...");
      await client.waitForUserOperationReceipt({ hash: txHash });

      setToast({ msg: `Swapped ${successCount} assets to ETH!`, type: "success" });
      await new Promise((r) => setTimeout(r, 2000));
      await loadDustTokens();
      setSelectedTokens(new Set());
    } catch (e: any) {
      console.error(e);
      setToast({ msg: "Swap Error: " + (e.shortMessage || e.message), type: "error" });
    } finally {
      setSwapping(false);
      setSwapProgress("");
    }
  };

  return (
    <div className="pb-32 space-y-4">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      {/* HEADER */}
      <div className="bg-gradient-to-r from-blue-900/40 to-purple-900/40 border border-blue-500/20 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Flash className="w-4 h-4 text-yellow-400" /> Aggregator Mode
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            Auto-routing via 0x & LI.FI
            <br />
            <span className="text-blue-300">5% Platform Fee applied.</span>
          </p>
        </div>
        <div className="bg-zinc-900/50 p-2 rounded-lg border border-zinc-700">
          <div className="text-[10px] text-zinc-500 uppercase font-bold text-center">Selected Value</div>
          <div className="text-lg font-mono font-bold text-white text-center">
            $
            {tokens
              .filter((t) => selectedTokens.has(t.contractAddress))
              .reduce((a, b) => a + b.valueUsd, 0)
              .toFixed(2)}
          </div>
        </div>
      </div>

      {/* TOKEN LIST HEADER */}
      <div className="flex items-center justify-between px-2">
        <div className="text-sm font-bold text-zinc-500">Available Dust ({tokens.length})</div>
        <button onClick={selectAll} className="text-xs font-medium text-blue-500 hover:text-blue-400">
          {selectedTokens.size === tokens.length ? "Deselect All" : "Select All"}
        </button>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-12 animate-pulse text-zinc-500 text-xs">Scanning Dust...</div>
        ) : tokens.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-xl">
            No dust tokens found.
          </div>
        ) : (
          tokens.map((token, i) => {
            const isSelected = selectedTokens.has(token.contractAddress);
            return (
              <div
                key={i}
                onClick={() => toggleToken(token.contractAddress)}
                className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                  isSelected
                    ? "bg-blue-900/20 border-blue-500/50 shadow-md"
                    : "bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                      isSelected ? "bg-blue-500 border-blue-500 text-white" : "border-zinc-600 text-transparent"
                    }`}
                  >
                    <Check className="w-3 h-3" strokeWidth={4} />
                  </div>
                  <TokenLogo token={token} />
                  <div>
                    <div className="text-sm font-bold dark:text-white flex items-center gap-2">
                      {token.symbol}
                      {token.valueUsd < 0.01 && (
                        <span className="text-[9px] bg-red-900/30 text-red-400 px-1 rounded">DUST</span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500">{parseFloat(token.formattedBal).toFixed(4)}</div>
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

      {/* FLOATING SWAP BUTTON */}
      {selectedTokens.size > 0 && (
        <div className="fixed bottom-24 left-4 right-4 z-40 animate-in slide-in-from-bottom-5">
          <button
            onClick={handleBatchSwap}
            disabled={swapping}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white shadow-xl py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-colors"
          >
            {swapping ? (
              <>
                <Refresh className="w-5 h-5 animate-spin" />
                <span className="text-sm">{swapProgress}</span>
              </>
            ) : (
              <>
                <Flash className="w-5 h-5" />
                Swap {selectedTokens.size} Assets
              </>
            )}
          </button>
          <div className="text-center text-[10px] text-zinc-400 mt-2 bg-white/80 dark:bg-black/50 backdrop-blur-md py-1 rounded-full w-fit mx-auto px-3 shadow-sm border border-zinc-200 dark:border-zinc-800">
            Fee 5% to Dev • Powered by 0x
          </div>
        </div>
      )}
    </div>
  );
};
