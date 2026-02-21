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
const LIFI_API_URL = "https://li.quest/v1";
const LIFI_API_KEY = process.env.NEXT_PUBLIC_LIFI_API_KEY || "";
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
  // Vault assets (semua token di vault termasuk yang tidak ada likuiditas)
  const [vaultTokens, setVaultTokens] = useState<TokenData[]>([]);
  const [vaultPage, setVaultPage] = useState(1);
  const VAULT_PER_PAGE = 10;
  const chainIdStr = String(chainId);
  const [vaultAddr, setVaultAddr] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [feeEnabled, setFeeEnabled] = useState(true);

  const loadDustTokens = async () => {
    if (!walletClient) return;
    setLoading(true);
    setScanError(null);
    try {
      const client = await getSmartAccountClient(walletClient);
      const detectedAddr = client.account.address;
      setVaultAddr(detectedAddr);
      console.log("[SwapView] Scanning vault:", detectedAddr);

      // Pakai Moralis — sama seperti vault-view, lebih reliable
      const moralisTokens = await fetchMoralisTokens(detectedAddr);
      const nonZero = moralisTokens.filter((t) => {
        const isUSDC = t.token_address.toLowerCase() === USDC_ADDRESS.toLowerCase();
        return !isUSDC && BigInt(t.balance) > 0n;
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
      setVaultPage(1);

      const validDust = formatted.filter((t) => t.valueUsd > 0.000001);
      setTokens(validDust);
      return validDust;
    } catch (e: any) {
      console.error("[SwapView] Error:", e);
      setScanError(e?.shortMessage || e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (walletClient) loadDustTokens(); }, [walletClient]);

  useEffect(() => {
    if (!defaultFromToken) return;
    setIncomingToken(defaultFromToken);
    const trySelect = async () => {
      let loadedTokens = tokens;
      if (loadedTokens.length === 0 && walletClient) {
        const result = await loadDustTokens();
        loadedTokens = result || [];
      }
      const found = loadedTokens.find(
        (t) => t.contractAddress.toLowerCase() === defaultFromToken.contractAddress.toLowerCase()
      );
      if (found) {
        setSelectedTokens(new Set([found.contractAddress]));
      } else {
        setToast({ msg: `${defaultFromToken.symbol} not found in vault — may have already been swapped.`, type: "error" });
      }
      onTokenConsumed?.();
    };
    trySelect();
  }, [defaultFromToken]);

  const toggleToken = (addr: string) => {
    const newSet = new Set(selectedTokens);
    if (newSet.has(addr)) newSet.delete(addr);
    else newSet.add(addr);
    setSelectedTokens(newSet);
    if (incomingToken) setIncomingToken(null);
  };

  const selectAll = () => {
    if (selectedTokens.size === tokens.length) setSelectedTokens(new Set());
    else setSelectedTokens(new Set(tokens.map((t) => t.contractAddress)));
    setIncomingToken(null);
  };

  const handleWithdrawToken = async (token: TokenData) => {
    if (!walletClient) return;
    const amount = prompt(`Withdraw ${token.symbol}? Enter amount:`, token.formattedBal);
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    if (!window.confirm(`Withdraw ${amount} ${token.symbol} to your wallet?`)) return;
    try {
      const client = await getSmartAccountClient(walletClient);
      const ownerAddress = walletClient.account?.address as Address;
      const rawAmount = BigInt(Math.floor(parseFloat(amount) * 10 ** token.decimals));
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ownerAddress, rawAmount] });
      const txHash = await client.sendUserOperation({
        calls: [{ to: token.contractAddress as Address, value: 0n, data }],
      });
      setToast({ msg: `Withdrawing ${token.symbol}...`, type: "success" });
      await client.waitForUserOperationReceipt({ hash: txHash });
      setToast({ msg: `${token.symbol} withdrawn!`, type: "success" });
      await loadDustTokens();
    } catch (e: any) {
      setToast({ msg: "Withdraw failed: " + (e.shortMessage || e.message), type: "error" });
    }
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
    if (!res.ok) throw new Error("0x: No route found");
    return res.json();
  };

  const getLifiQuote = async (token: TokenData, amount: string, fromAddress: string) => {
    const params = new URLSearchParams({
      fromChain:  chainIdStr,
      toChain:    chainIdStr,
      fromToken:  token.contractAddress,
      toToken:    WETH_ADDRESS,
      fromAmount: amount,
      fromAddress,
      toAddress:  fromAddress,
      slippage:   "0.10",
      // Force allowance-based DEXes only — permit2 tidak bisa dipakai dari vault
      denyExchanges: "paraswap",
    });
    if (LIFI_API_KEY && feeEnabled) {
      params.set("integrator", "nyawit");
      params.set("fee",        "0.05");
      params.set("referrer",   FEE_RECIPIENT);
    }
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (LIFI_API_KEY) headers["x-lifi-api-key"] = LIFI_API_KEY;
    const res = await fetch(`${LIFI_API_URL}/quote?${params}`, { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LI.FI ${res.status}: ${text.slice(0, 100)}`);
    }
    const data = await res.json();
    // Reject permit2 — vault tidak support off-chain signature approval
    const approvalAddr = (data?.estimate?.approvalAddress || "").toLowerCase();
    if (approvalAddr === "0x000000000022d473030f116ddee9f6b43ac78ba3") {
      throw new Error("LI.FI: permit2 route not supported in vault — skipping");
    }
    return data;
  };

  // KyberSwap — gratis, no signup, Base support bagus
  const getKyberQuote = async (token: TokenData, amount: string, fromAddress: string) => {
    // Step 1: get route
    const routeRes = await fetch(
      `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${token.contractAddress}&tokenOut=${WETH_ADDRESS}&amountIn=${amount}&saveGas=false&gasInclude=false`,
      { headers: { "Accept": "application/json", "x-client-id": "nyawit" } }
    );
    if (!routeRes.ok) throw new Error(`KyberSwap route ${routeRes.status}`);
    const routeData = await routeRes.json();
    if (!routeData?.data?.routeSummary) throw new Error("KyberSwap: no route");

    // Step 2: build tx
    const buildRes = await fetch(
      `https://aggregator-api.kyberswap.com/base/api/v1/route/build`,
      {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json", "x-client-id": "nyawit" },
        body: JSON.stringify({
          routeSummary: routeData.data.routeSummary,
          sender: fromAddress,
          recipient: fromAddress,
          slippageTolerance: 300, // 3% in bps
        }),
      }
    );
    if (!buildRes.ok) throw new Error(`KyberSwap build ${buildRes.status}`);
    const buildData = await buildRes.json();
    if (!buildData?.data?.data) throw new Error("KyberSwap: no tx data");

    return {
      transactionRequest: {
        to: buildData.data.routerAddress,
        data: buildData.data.data,
        value: "0x0",
      }
    };
  };

  const handleBatchSwap = async () => {
    if (!walletClient || selectedTokens.size === 0) return;
    setSwapping(true);
    setSwapProgress("Initializing...");
    setIncomingToken(null);
    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      const client = await getSmartAccountClient(walletClient);
      const vaultAddress = client.account.address;

      const batchCalls: any[] = [];
      const tokensToSwap = tokens.filter((t) => selectedTokens.has(t.contractAddress));
      let successCount = 0;

      for (const token of tokensToSwap) {
        setSwapProgress(`Finding route for ${token.symbol}...`);
        try {
          let txData = null;
          let toAddress = null;
          let value = 0n;

          // Try aggregators: 0x → LI.FI → KyberSwap
          // RouteResult: { data, to, value, approvalAddress }
          // approvalAddress BISA BEDA dari `to` (terutama LI.FI)
          // Harus approve ke approvalAddress, bukan ke to!
          interface RouteResult { data: string; to: string; value: string; approvalAddress: string; }

          const getRoute = async (): Promise<{ result: RouteResult; agg: string }> => {
            // 1. 0x via backend (dengan LI.FI fallback di backend)
            try {
              const params = new URLSearchParams({
                chainId:           String(chainId || "8453"),
                sellToken:         token.contractAddress,
                buyToken:          WETH_ADDRESS,
                sellAmount:        token.rawBalance,
                taker:             vaultAddress,
                slippagePercentage: "0.10", // 10% — Warpcast simulate dulu, harga bisa bergerak
                feeRecipient:          FEE_RECIPIENT,
                buyTokenPercentageFee: FEE_PERCENTAGE,
              });
              const res = await fetch(`/api/0x/quote?${params}`);
              if (!res.ok) throw new Error("0x backend: " + res.status);
              const q = await res.json();
              if (q.error) throw new Error("0x: " + q.error);
              return {
                agg: q._source === "lifi" ? "LI.FI (via backend)" : "0x",
                result: {
                  data:  q.transaction.data,
                  to:    q.transaction.to,
                  value: q.transaction.value || "0",
                  // approvalAddress ada di response kalau backend fallback ke LI.FI
                  approvalAddress: q.transaction.approvalAddress || q.transaction.to,
                },
              };
            } catch (e: any) {
              console.warn("[Swap] 0x/LI.FI backend failed:", e?.message);
            }

            // 2. KyberSwap direct
            try {
              const routeRes = await fetch(
                `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${token.contractAddress}&tokenOut=${WETH_ADDRESS}&amountIn=${token.rawBalance}`,
                { headers: { "Accept": "application/json", "x-client-id": "nyawit" } }
              );
              if (!routeRes.ok) throw new Error("Kyber route " + routeRes.status);
              const routeData = await routeRes.json();
              if (!routeData?.data?.routeSummary) throw new Error("Kyber: no route");
              const buildRes = await fetch(
                `https://aggregator-api.kyberswap.com/base/api/v1/route/build`,
                {
                  method: "POST",
                  headers: { "Accept": "application/json", "Content-Type": "application/json", "x-client-id": "nyawit" },
                  body: JSON.stringify({
                    routeSummary: routeData.data.routeSummary,
                    sender: vaultAddress, recipient: vaultAddress,
                    slippageTolerance: 1000,
                  }),
                }
              );
              if (!buildRes.ok) throw new Error("Kyber build " + buildRes.status);
              const bd = await buildRes.json();
              if (!bd?.data?.data) throw new Error("Kyber: no tx data");
              return {
                agg: "KyberSwap",
                result: {
                  data:            bd.data.data,
                  to:              bd.data.routerAddress,
                  value:           "0x0",
                  approvalAddress: bd.data.routerAddress,
                },
              };
            } catch (e: any) {
              console.warn("[Swap] KyberSwap failed:", e?.message);
            }

            throw new Error("No route from any aggregator");
          };

          const { result: route, agg: usedAgg } = await getRoute();
          txData    = route.data;
          toAddress = route.to;
          value     = BigInt(route.value);
          console.log(`[Swap] ${token.symbol} → ${usedAgg}, approvalTarget: ${route.approvalAddress}`);
          const approveTarget = route.approvalAddress;
          const routeFound    = true; void routeFound;

          if (txData && toAddress) {
            // approve MaxUint256 — hindari revert karena allowance kurang atau leftover
            // Exact amount bisa gagal kalau ada sisa allowance dari tx sebelumnya
            const approveData = encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [approveTarget as Address, maxUint256],
            });
            batchCalls.push({ to: token.contractAddress as Address, value: 0n, data: approveData });
            batchCalls.push({ to: toAddress as Address, value, data: txData });
            successCount++;
          }
        } catch (e: any) {
          console.error(`No route for ${token.symbol}:`, e?.message || e);
          setSwapProgress(`Skipping ${token.symbol}: no route`);
          await new Promise(r => setTimeout(r, 500));
        }
      }

      if (batchCalls.length === 0) {
        setToast({ msg: "No routes found for selected tokens. Try again later.", type: "error" });
        return;
      }

      setSwapProgress(`Signing batch swap (${successCount} asset${successCount > 1 ? "s" : ""})...`);
      const txHash = await client.sendUserOperation({ calls: batchCalls });

      setSwapProgress("Transaction sent! Waiting for confirmation...");
      await client.waitForUserOperationReceipt({ hash: txHash });

      setToast({ msg: `Successfully swapped ${successCount} asset${successCount > 1 ? "s" : ""} to ETH!`, type: "success" });
      await new Promise((r) => setTimeout(r, 2000));
      await loadDustTokens();
      setSelectedTokens(new Set());
    } catch (e: any) {
      console.error(e);
      setToast({ msg: "Swap failed: " + (e.shortMessage || e.message), type: "error" });
    } finally {
      setSwapping(false);
      setSwapProgress("");
    }
  };

  return (
    <div className="pb-32 space-y-4">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      {/* Banner: token from VaultView */}
      {incomingToken && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 animate-in slide-in-from-top-2 duration-300">
          <Flash className="w-4 h-4 text-orange-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-orange-300">From Vault</div>
            <div className="text-sm text-orange-100 truncate">
              {incomingToken.symbol} — {parseFloat(incomingToken.formattedBal).toFixed(4)}
            </div>
          </div>
          <button onClick={() => { setIncomingToken(null); setSelectedTokens(new Set()); }} className="text-orange-400 hover:text-orange-200 text-xs">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-t from-green-900 to-red-900 border border-red-800/40 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Flash className="w-4 h-4 text-yellow-400" /> Aggregator Mode
          </h3>
          <p className="text-xs text-green-200 mt-1">
            Auto-routing via 0x Protocol & LI.FI
            <br />
            <span className="text-green-300">5% platform fee applied.</span>
          </p>
        </div>
        <div className="bg-black/30 backdrop-blur-sm p-2 rounded-lg border border-white/20">
          <div className="text-[10px] text-white/70 uppercase font-bold text-center">Selected Value</div>
          <div className="text-lg font-mono font-bold text-white text-center">
            ${tokens.filter((t) => selectedTokens.has(t.contractAddress)).reduce((a, b) => a + b.valueUsd, 0).toFixed(2)}
          </div>
        </div>
      </div>

      {/* Token list header */}
      <div className="flex items-center justify-between px-2">
        <div className="text-sm font-bold text-zinc-500">Available Dust ({tokens.length})</div>
        <div className="flex items-center gap-2">
          <button onClick={() => loadDustTokens()} className="text-xs text-zinc-500 hover:text-zinc-300">
            <Refresh className="w-3.5 h-3.5" />
          </button>
          <button onClick={selectAll} className="text-xs font-medium text-blue-500 hover:text-blue-400">
            {selectedTokens.size === tokens.length && tokens.length > 0 ? "Deselect All" : "Select All"}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-12 animate-pulse text-zinc-500 text-xs">Scanning dust tokens...</div>
        ) : tokens.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-xl space-y-2 p-4">
            {scanError ? (
              <div className="text-red-400 text-xs">⚠ Error: {scanError}</div>
            ) : (
              <div>No dust tokens found in vault.</div>
            )}
            {vaultAddr && (
              <div className="text-[10px] text-zinc-600 font-mono break-all">
                Vault: {vaultAddr.slice(0,10)}...{vaultAddr.slice(-8)}
              </div>
            )}
            <div className="text-[10px] text-zinc-600">
              Deposit tokens via tab Panen → Wallet Assets → Deposit
            </div>
          </div>
        ) : (
          tokens.map((token, i) => {
            const isSelected = selectedTokens.has(token.contractAddress);
            const isIncoming = incomingToken?.contractAddress.toLowerCase() === token.contractAddress.toLowerCase();
            return (
              <div
                key={i}
                onClick={() => toggleToken(token.contractAddress)}
                className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                  isSelected
                    ? isIncoming ? "bg-orange-900/20 border-orange-500/50 shadow-md" : "bg-blue-900/20 border-blue-500/50 shadow-md"
                    : "bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                    isSelected
                      ? isIncoming ? "bg-orange-500 border-orange-500 text-white" : "bg-blue-500 border-blue-500 text-white"
                      : "border-zinc-600 text-transparent"
                  }`}>
                    <Check className="w-3 h-3" strokeWidth={4} />
                  </div>
                  <TokenLogo token={token} />
                  <div>
                    <div className="text-sm font-bold dark:text-white flex items-center gap-2">
                      {token.symbol}
                      {isIncoming && <span className="text-[9px] bg-orange-900/30 text-orange-400 px-1 rounded">FROM VAULT</span>}
                      {!isIncoming && token.valueUsd < 0.01 && <span className="text-[9px] bg-red-900/30 text-red-400 px-1 rounded">DUST</span>}
                    </div>
                    <div className="text-xs text-zinc-500">{parseFloat(token.formattedBal).toFixed(4)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-zinc-700 dark:text-zinc-300">${token.valueUsd.toFixed(2)}</div>
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

      {/* ── DEPOSITED DUST (token tanpa likuiditas / no route) ── */}
      {vaultTokens.filter(t => t.valueUsd <= 0.000001).length > 0 && (
        <div className="space-y-2 mt-6">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-wide flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-zinc-500 inline-block" />
              Deposited Dust ({vaultTokens.filter(t => t.valueUsd <= 0.000001).length})
            </h3>
            <span className="text-[10px] text-zinc-500">
              Page {vaultPage} / {Math.ceil(vaultTokens.filter(t => t.valueUsd <= 0.000001).length / VAULT_PER_PAGE)}
            </span>
          </div>

          <div className="space-y-2">
            {vaultTokens
              .filter(t => t.valueUsd <= 0.000001)
              .slice((vaultPage - 1) * VAULT_PER_PAGE, vaultPage * VAULT_PER_PAGE)
              .map((token, i) => {
                const isSelected = selectedTokens.has(token.contractAddress);
                const isSwappable = false; // no route tokens
                return (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden">
                        <TokenLogo token={token} />
                      </div>
                      <div>
                        <div className="text-sm font-bold flex items-center gap-1.5">
                          {token.symbol}
                          {!isSwappable && (
                            <span className="text-[9px] bg-zinc-200 dark:bg-zinc-700 text-zinc-500 px-1 rounded">no route</span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500">{parseFloat(token.formattedBal).toFixed(4)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isSwappable && (
                        <button
                          onClick={() => toggleToken(token.contractAddress)}
                          className={`px-2.5 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1 transition-colors ${
                            isSelected
                              ? "bg-blue-600 text-white"
                              : "bg-orange-50 text-orange-500 hover:bg-orange-100 dark:bg-orange-900/20 dark:text-orange-400"
                          }`}
                        >
                          <Flash className="w-3 h-3" />
                          {isSelected ? "Selected" : "Swap"}
                        </button>
                      )}
                      <button
                        onClick={() => handleWithdrawToken(token)}
                        className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 transition-colors"
                      >
                        WD
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Pagination */}
          {Math.ceil(vaultTokens.filter(t => t.valueUsd <= 0.000001).length / VAULT_PER_PAGE) > 1 && (
            <div className="flex justify-center items-center gap-1 mt-2 pb-2">
              <button
                onClick={() => setVaultPage((p) => Math.max(1, p - 1))}
                disabled={vaultPage === 1}
                className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs disabled:opacity-30"
              >
                ← Prev
              </button>
              {Array.from({ length: Math.ceil(vaultTokens.filter(t => t.valueUsd <= 0.000001).length / VAULT_PER_PAGE) }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === Math.ceil(vaultTokens.filter(t => t.valueUsd <= 0.000001).length / VAULT_PER_PAGE) || Math.abs(p - vaultPage) <= 2)
                .reduce((acc: (number | string)[], p, idx, arr) => {
                  if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("...");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === "..." ? (
                    <span key={i} className="px-2 text-zinc-400 text-xs">...</span>
                  ) : (
                    <button
                      key={i}
                      onClick={() => setVaultPage(p as number)}
                      className={`w-8 h-8 rounded-lg text-xs font-bold ${
                        vaultPage === p ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
              <button
                onClick={() => setVaultPage((p) => Math.min(Math.ceil(vaultTokens.length / VAULT_PER_PAGE), p + 1))}
                disabled={vaultPage === Math.ceil(vaultTokens.filter(t => t.valueUsd <= 0.000001).length / VAULT_PER_PAGE)}
                className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Floating swap button */}
      {selectedTokens.size > 0 && (
        <div className="fixed bottom-24 left-4 right-4 z-40 animate-in slide-in-from-bottom-5">
          <button
            onClick={handleBatchSwap}
            disabled={swapping}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white shadow-xl py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-colors"
          >
            {swapping ? (
              <><Refresh className="w-5 h-5 animate-spin" /><span className="text-sm">{swapProgress}</span></>
            ) : (
              <><Flash className="w-5 h-5" />Swap {selectedTokens.size} Asset{selectedTokens.size > 1 ? "s" : ""}</>
            )}
          </button>
          <div className="text-center text-[10px] text-zinc-400 mt-2 bg-white/80 dark:bg-black/50 backdrop-blur-md py-1 rounded-full w-fit mx-auto px-3 shadow-sm border border-zinc-200 dark:border-zinc-800">
            5% fee · Routed via 0x Protocol & LI.FI
          </div>
        </div>
      )}
    </div>
  );
};