"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount, useSwitchChain } from "wagmi";
import { getSmartAccountClient } from "~/lib/smart-account";
import { fetchMoralisTokens } from "~/lib/moralis-data";
import { fetchTokenPrices } from "~/lib/price";
import { formatUnits, encodeFunctionData, erc20Abi, type Address, maxUint256 } from "viem";
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

interface SwapViewProps {
  defaultFromToken?: {
    contractAddress: string;
    symbol: string;
    formattedBal: string;
    decimals: number;
    rawBalance: string;
  } | null;
  onTokenConsumed?: () => void;
}

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
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

export const SwapView = ({ defaultFromToken, onTokenConsumed }: SwapViewProps) => {
  const { data: walletClient } = useWalletClient();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [swapProgress, setSwapProgress] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [incomingToken, setIncomingToken] = useState<SwapViewProps["defaultFromToken"]>(null);
  const [vaultTokens, setVaultTokens] = useState<TokenData[]>([]);
  const [vaultPage, setVaultPage] = useState(1);
  const VAULT_PER_PAGE = 10;
  const [vaultAddr, setVaultAddr] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const loadDustTokens = async () => {
    if (!walletClient) return;
    setLoading(true);
    setScanError(null);
    try {
      const client = await getSmartAccountClient(walletClient);
      const detectedAddr = client.account.address;
      setVaultAddr(detectedAddr);

      const moralisTokens = await fetchMoralisTokens(detectedAddr);
      const vaultLower = detectedAddr.toLowerCase();
      const nonZero = moralisTokens.filter((t) => {
        const addr = t.token_address.toLowerCase();
        return addr !== USDC_ADDRESS.toLowerCase() && addr !== vaultLower && BigInt(t.balance) > 0n;
      });

      if (nonZero.length === 0) { setTokens([]); setVaultTokens([]); return; }

      const addresses = nonZero.map((t) => t.token_address);
      const prices = await fetchTokenPrices(addresses);

      const formatted: TokenData[] = nonZero.map((t) => {
        const decimals = t.decimals || 18;
        const rawBal = t.balance;
        const fmtBal = formatUnits(BigInt(rawBal), decimals);
        const price = prices[t.token_address.toLowerCase()] || 0;
        return {
          contractAddress: t.token_address,
          symbol: t.symbol || "UNKNOWN",
          logo: t.logo || null,
          decimals,
          rawBalance: rawBal,
          formattedBal: fmtBal,
          priceUsd: price,
          valueUsd: parseFloat(fmtBal) * price,
        };
      });

      formatted.sort((a, b) => b.valueUsd - a.valueUsd);
      setVaultTokens(formatted);
      setTokens(formatted.filter((t) => t.valueUsd > 0.000001));
    } catch (e: any) {
      setScanError(e?.message || "Unknown error");
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

  // --- LOGIKA UTAMA: BATCH SWAP DENGAN FILTER & UNWRAP ---
  const handleBatchSwap = async () => {
    if (!walletClient || selectedTokens.size === 0) return;
    setSwapping(true);
    setSwapProgress("Scanning routes...");

    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      const client = await getSmartAccountClient(walletClient);
      const vaultAddress = client.account.address;

      const tokensToSwap = tokens.filter((t) => selectedTokens.has(t.contractAddress));
      const validRoutes: { token: TokenData; quote: any }[] = [];

      // 1. FASE SCANNING (Pre-check)
      for (const token of tokensToSwap) {
        setSwapProgress(`Scanning ${token.symbol}...`);
        try {
          const params = new URLSearchParams({
            chainId: "8453",
            sellToken: token.contractAddress,
            buyToken: WETH_ADDRESS,
            sellAmount: token.rawBalance,
            taker: vaultAddress,
            slippagePercentage: "0.03",
            feeRecipient: FEE_RECIPIENT,
            buyTokenPercentageFee: FEE_PERCENTAGE,
          });
          const res = await fetch(`/api/0x/quote?${params}`);
          const quote = await res.json();

          if (quote && quote.transaction && quote.transaction.data && quote.transaction.approvalAddress) {
            validRoutes.push({ token, quote });
          }
        } catch (e) {
          console.warn(`Skipping ${token.symbol}: No route found.`);
        }
      }

      if (validRoutes.length === 0) {
        setToast({ msg: "No swappable routes found.", type: "error" });
        return;
      }

      // 2. FASE CONSTRUCT CALLS (Approve -> Swap -> Unwrap)
      const allCalls: { to: Address; value: bigint; data: `0x${string}` }[] = [];

      // Batch Approvals
      validRoutes.forEach(({ token, quote }) => {
        allCalls.push({
          to: token.contractAddress as Address,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [quote.transaction.approvalAddress as Address, maxUint256],
          }),
        });
      });

      // Batch Swaps
      validRoutes.forEach(({ quote }) => {
        allCalls.push({
          to: quote.transaction.to as Address,
          value: BigInt(quote.transaction.value || 0),
          data: quote.transaction.data as `0x${string}`,
        });
      });

      // Final Step: Unwrap WETH to ETH Native
      const unwrapData = encodeFunctionData({
        abi: [{ name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'wad', type: 'uint256' }], outputs: [] }],
        functionName: 'withdraw',
        args: [maxUint256], // Menarik semua WETH hasil swap
      });

      allCalls.push({
        to: WETH_ADDRESS as Address,
        value: 0n,
        data: unwrapData as `0x${string}`,
      });

      // 3. FASE EKSEKUSI
      setSwapProgress(`Executing ${validRoutes.length} swaps...`);
      const txHash = await client.sendUserOperation({ calls: allCalls });
      await client.waitForUserOperationReceipt({ hash: txHash });

      setToast({ msg: `Successfully swept ${validRoutes.length} tokens to ETH!`, type: "success" });
      await loadDustTokens();
      setSelectedTokens(new Set());

    } catch (e: any) {
      setToast({ msg: "Batch failed: " + (e.shortMessage || e.message), type: "error" });
    } finally {
      setSwapping(false);
      setSwapProgress("");
    }
  };

  return (
    <div className="pb-32 space-y-4">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      <div className="bg-gradient-to-t from-green-900 to-red-900 border border-red-800/40 rounded-2xl p-4 flex items-center justify-between text-white">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2"><Flash className="w-4 h-4 text-yellow-400" /> Aggregator Mode</h3>
          <p className="text-xs mt-1 text-green-200">Auto-routing to ETH via WETH liquidity pools.</p>
        </div>
        <div className="bg-black/30 p-2 rounded-lg border border-white/20 text-center">
          <div className="text-[10px] opacity-70">Selected</div>
          <div className="text-lg font-mono font-bold">
            ${tokens.filter(t => selectedTokens.has(t.contractAddress)).reduce((a, b) => a + b.valueUsd, 0).toFixed(2)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-2 text-sm">
        <div className="font-bold text-zinc-500">Available Dust ({tokens.length})</div>
        <button onClick={selectAll} className="text-blue-500 font-medium">
          {selectedTokens.size === tokens.length ? "Deselect All" : "Select All"}
        </button>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-12 animate-pulse text-zinc-500 text-xs">Scanning vault...</div>
        ) : (
          tokens.map((token, i) => (
            <div
              key={i}
              onClick={() => toggleToken(token.contractAddress)}
              className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                selectedTokens.has(token.contractAddress) ? "bg-blue-900/20 border-blue-500/50" : "bg-zinc-900 border-zinc-800"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${selectedTokens.has(token.contractAddress) ? "bg-blue-500 text-white" : "text-transparent"}`}>
                  <Check className="w-3 h-3" strokeWidth={4} />
                </div>
                <TokenLogo token={token} />
                <div>
                  <div className="text-sm font-bold text-white">{token.symbol}</div>
                  <div className="text-xs text-zinc-500">{parseFloat(token.formattedBal).toFixed(4)}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-zinc-300">${token.valueUsd.toFixed(2)}</div>
                <div className="text-[10px] text-zinc-500">→ ETH</div>
              </div>
            </div>
          ))
        )}
      </div>

      {selectedTokens.size > 0 && (
        <div className="fixed bottom-24 left-4 right-4 z-40">
          <button
            onClick={handleBatchSwap}
            disabled={swapping}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 shadow-xl"
          >
            {swapping ? (
              <><Refresh className="w-5 h-5 animate-spin" /><span className="text-sm">{swapProgress}</span></>
            ) : (
              <><Flash className="w-5 h-5" />Sweep to ETH</>
            )}
          </button>
        </div>
      )}
    </div>
  );
};