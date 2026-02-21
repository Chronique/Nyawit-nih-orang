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

// ── Constants ────────────────────────────────────────────────────────────────
const USDC_ADDRESS   = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const ETH_NATIVE     = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const LIFI_API_KEY   = process.env.NEXT_PUBLIC_LIFI_API_KEY || "";
const FEE_RECIPIENT  = "0x4fba95e4772be6d37a0c931D00570Fe2c9675524";
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

  // ── All state declarations first — BEFORE any computed values ────────────
  const [tokens, setTokens]                 = useState<TokenData[]>([]);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [loading, setLoading]               = useState(false);
  const [swapping, setSwapping]             = useState(false);
  const [swapProgress, setSwapProgress]     = useState("");
  const [toast, setToast]                   = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [incomingToken, setIncomingToken]   = useState<SwapViewProps["defaultFromToken"]>(null);
  const [vaultTokens, setVaultTokens]       = useState<TokenData[]>([]);
  const [vaultPage, setVaultPage]           = useState(1);
  const [vaultAddr, setVaultAddr]           = useState<string | null>(null);
  const [scanError, setScanError]           = useState<string | null>(null);
  const [feeEnabled, setFeeEnabled]         = useState(true);
  const [targetToken, setTargetToken]       = useState<"ETH" | "USDC">("ETH");

  // ── Computed values — AFTER all state ────────────────────────────────────
  const VAULT_PER_PAGE  = 10;
  const buyToken        = targetToken === "USDC" ? USDC_ADDRESS : ETH_NATIVE;
  const buyTokenLabel   = targetToken;
  const kyberBuyToken   = buyToken === ETH_NATIVE ? WETH_ADDRESS : buyToken;
  const chainIdStr      = String(chainId || "8453");

  // ── loadDustTokens ────────────────────────────────────────────────────────
  const loadDustTokens = async () => {
    if (!walletClient) return;
    setLoading(true);
    setScanError(null);
    try {
      const client       = await getSmartAccountClient(walletClient);
      const detectedAddr = client.account.address;
      setVaultAddr(detectedAddr);
      console.log("[SwapView] Scanning vault:", detectedAddr);

      const moralisTokens = await fetchMoralisTokens(detectedAddr);
      const vaultLower    = detectedAddr.toLowerCase();

      const nonZero = moralisTokens.filter((t) => {
        const addr    = t.token_address.toLowerCase();
        const isUSDC  = addr === USDC_ADDRESS.toLowerCase();
        const isVault = addr === vaultLower;
        if (isVault) console.warn("[SwapView] Filtered out vault address:", addr);
        return !isUSDC && !isVault && BigInt(t.balance) > 0n;
      });

      if (nonZero.length === 0) { setTokens([]); setVaultTokens([]); return; }

      const addresses = nonZero.map((t) => t.token_address);
      const prices    = await fetchTokenPrices(addresses);

      const formatted: TokenData[] = nonZero.map((t) => {
        const decimals = t.decimals || 18;
        const rawBal   = t.balance;
        const fmtBal   = formatUnits(BigInt(rawBal), decimals);
        const price    = prices[t.token_address.toLowerCase()] || 0;
        return {
          contractAddress: t.token_address,
          symbol:          t.symbol || "UNKNOWN",
          logo:            t.logo || null,
          decimals,
          rawBalance:   rawBal,
          formattedBal: fmtBal,
          priceUsd:     price,
          valueUsd:     parseFloat(fmtBal) * price,
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
      let loaded = tokens;
      if (loaded.length === 0 && walletClient) {
        const result = await loadDustTokens();
        loaded = result || [];
      }
      const found = loaded.find(
        (t) => t.contractAddress.toLowerCase() === defaultFromToken.contractAddress.toLowerCase()
      );
      if (found) setSelectedTokens(new Set([found.contractAddress]));
      else setToast({ msg: `${defaultFromToken.symbol} not found in vault.`, type: "error" });
      onTokenConsumed?.();
    };
    trySelect();
  }, [defaultFromToken]);

  const toggleToken = (addr: string) => {
    const s = new Set(selectedTokens);
    s.has(addr) ? s.delete(addr) : s.add(addr);
    setSelectedTokens(s);
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
      const owner  = walletClient.account?.address as Address;
      const raw    = BigInt(Math.floor(parseFloat(amount) * 10 ** token.decimals));
      const data   = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [owner, raw] });
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

  // ── Batch swap: 3 fase ────────────────────────────────────────────────────
  const handleBatchSwap = async () => {
    if (!walletClient || selectedTokens.size === 0) return;
    setSwapping(true);
    setSwapProgress("Initializing...");
    setIncomingToken(null);

    const MAX_PER_BATCH = 10;

    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      const client       = await getSmartAccountClient(walletClient);
      const vaultAddress = client.account.address;

      const tokensToSwap = tokens
        .filter((t) => selectedTokens.has(t.contractAddress))
        .slice(0, MAX_PER_BATCH);

      // ── FASE 1: Fetch semua route parallel ───────────────────────────────
      setSwapProgress(`Fetching routes for ${tokensToSwap.length} tokens...`);

      interface RouteResult {
        data: `0x${string}`; to: string; value: string; approvalAddress: string; agg: string;
      }
      const routes = new Map<string, RouteResult>();

      await Promise.all(tokensToSwap.map(async (token) => {
        // 1. 0x backend (LI.FI fallback di dalam backend)
        try {
          const params = new URLSearchParams({
            chainId:            chainIdStr,
            sellToken:          token.contractAddress,
            buyToken:           buyToken,
            sellAmount:         token.rawBalance,
            taker:              vaultAddress,
            slippagePercentage: "0.15",
          });
          if (feeEnabled) {
            params.set("feeRecipient", FEE_RECIPIENT);
            params.set("buyTokenPercentageFee", FEE_PERCENTAGE);
          }
          const res = await fetch(`/api/0x/quote?${params}`);
          if (res.ok) {
            const q = await res.json();
            if (!q.error && q.transaction?.data) {
              routes.set(token.contractAddress, {
                data:            q.transaction.data as `0x${string}`,
                to:              q.transaction.to,
                value:           q.transaction.value || "0",
                approvalAddress: q.transaction.approvalAddress || q.transaction.to,
                agg:             q._source === "lifi" ? "LI.FI" : "0x",
              });
              return;
            }
          }
        } catch {}

        // 2. KyberSwap direct fallback
        try {
          const rRes = await fetch(
            `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${token.contractAddress}&tokenOut=${kyberBuyToken}&amountIn=${token.rawBalance}`,
            { headers: { Accept: "application/json", "x-client-id": "nyawit" } }
          );
          if (!rRes.ok) return;
          const rd = await rRes.json();
          if (!rd?.data?.routeSummary) return;

          const bRes = await fetch(
            `https://aggregator-api.kyberswap.com/base/api/v1/route/build`,
            {
              method: "POST",
              headers: { Accept: "application/json", "Content-Type": "application/json", "x-client-id": "nyawit" },
              body: JSON.stringify({
                routeSummary:      rd.data.routeSummary,
                sender:            vaultAddress,
                recipient:         vaultAddress,
                slippageTolerance: 1500,
              }),
            }
          );
          if (!bRes.ok) return;
          const bd = await bRes.json();
          if (!bd?.data?.data) return;

          routes.set(token.contractAddress, {
            data:            bd.data.data as `0x${string}`,
            to:              bd.data.routerAddress,
            value:           "0x0",
            approvalAddress: bd.data.routerAddress,
            agg:             "KyberSwap",
          });
        } catch {}
      }));

      if (routes.size === 0) {
        setToast({ msg: "No routes found for any token.", type: "error" });
        return;
      }

      const routable = tokensToSwap.filter((t) => routes.has(t.contractAddress));
      const noRoute  = tokensToSwap.filter((t) => !routes.has(t.contractAddress));
      if (noRoute.length > 0) console.log("[Swap] No route:", noRoute.map(t => t.symbol).join(", "));

      // ── FASE 2: Batch approve semua (1 tx) ───────────────────────────────
      setSwapProgress(`Approving ${routable.length} tokens (1 tx)...`);

      const vaultAddrLower = vaultAddress.toLowerCase();
      const zeroAddr       = "0x0000000000000000000000000000000000000000";

      const approvalCalls = routable
        .map((token) => {
          const route       = routes.get(token.contractAddress)!;
          const tokenAddr   = token.contractAddress.toLowerCase();
          const spenderAddr = route.approvalAddress.toLowerCase();

          if (tokenAddr === vaultAddrLower) {
            console.error(`[Approve] SKIP ${token.symbol}: token IS vault`);
            return null;
          }
          if (spenderAddr === vaultAddrLower || spenderAddr === zeroAddr) {
            console.error(`[Approve] SKIP ${token.symbol}: spender is vault/zero`);
            return null;
          }

          console.log(`[Approve] ${token.symbol}: ${tokenAddr.slice(0, 8)} → spender ${spenderAddr.slice(0, 8)}`);
          const data = encodeFunctionData({
            abi: erc20Abi, functionName: "approve",
            args: [route.approvalAddress as Address, maxUint256],
          });
          return { to: token.contractAddress as Address, value: 0n, data: data as `0x${string}` };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      if (approvalCalls.length === 0) {
        setToast({ msg: "No valid tokens to approve.", type: "error" });
        return;
      }

      const approveTx = await client.sendUserOperation({ calls: approvalCalls });
      setSwapProgress("Waiting for approvals...");
      await client.waitForUserOperationReceipt({ hash: approveTx });
      console.log("[Approve] Batch confirmed ✓");

      const validatedAddrs = new Set(approvalCalls.map(c => c.to.toLowerCase()));
      const validRotable   = routable.filter(t => validatedAddrs.has(t.contractAddress.toLowerCase()));

      // ── FASE 3: Swap satu per satu — isolasi failure ──────────────────────
      let successCount = 0;
      let failCount    = 0;

      for (const token of validRotable) {
        const routeInfo = routes.get(token.contractAddress)!;
        setSwapProgress(`[${successCount + failCount + 1}/${validRotable.length}] Swapping ${token.symbol} via ${routeInfo.agg}...`);
        try {
          // Re-fetch fresh quote sebelum swap
          let freshRoute = routeInfo;
          try {
            const params = new URLSearchParams({
              chainId:            chainIdStr,
              sellToken:          token.contractAddress,
              buyToken:           buyToken,
              sellAmount:         token.rawBalance,
              taker:              vaultAddress,
              slippagePercentage: "0.15",
            });
            if (feeEnabled) {
              params.set("feeRecipient", FEE_RECIPIENT);
              params.set("buyTokenPercentageFee", FEE_PERCENTAGE);
            }
            const res = await fetch(`/api/0x/quote?${params}`);
            if (res.ok) {
              const q = await res.json();
              if (!q.error && q.transaction?.data) {
                freshRoute = {
                  data:            q.transaction.data as `0x${string}`,
                  to:              q.transaction.to,
                  value:           q.transaction.value || "0",
                  approvalAddress: q.transaction.approvalAddress || q.transaction.to,
                  agg:             q._source === "lifi" ? "LI.FI" : "0x",
                };
              }
            }
          } catch {}

          const swapTx = await client.sendUserOperation({
            calls: [{
              to:    freshRoute.to as Address,
              value: BigInt(freshRoute.value),
              data:  freshRoute.data,
            }],
          });
          await client.waitForUserOperationReceipt({ hash: swapTx });
          console.log(`[Swap] ${token.symbol} ✓`);
          successCount++;
        } catch (e: any) {
          console.error(`[Swap] ${token.symbol} failed:`, e?.message);
          failCount++;
          setSwapProgress(`${token.symbol} failed, continuing...`);
          await new Promise(r => setTimeout(r, 500));
        }
      }

      const skipped      = routable.length - validRotable.length;
      const parts: string[] = [];
      if (successCount > 0)   parts.push(`${successCount} swapped`);
      if (failCount > 0)      parts.push(`${failCount} failed`);
      if (noRoute.length > 0) parts.push(`${noRoute.length} no route`);
      if (skipped > 0)        parts.push(`${skipped} invalid`);

      setToast({
        msg:  successCount > 0
          ? `✓ ${parts.join(", ")} → ${buyTokenLabel}`
          : `Failed: ${parts.join(", ")}`,
        type: successCount > 0 ? "success" : "error",
      });

      await new Promise(r => setTimeout(r, 2000));
      await loadDustTokens();
      setSelectedTokens(new Set());

    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown";
      setToast({
        msg:  msg.includes("rejected") || msg.includes("denied") ? "Cancelled." : "Error: " + msg,
        type: "error",
      });
    } finally {
      setSwapping(false);
      setSwapProgress("");
    }
  };

  // ── Computed UI ───────────────────────────────────────────────────────────
  const noRouteTokens   = vaultTokens.filter(t => t.valueUsd <= 0.000001);
  const totalNoRoutePgs = Math.ceil(noRouteTokens.length / VAULT_PER_PAGE);
  const selectedValue   = tokens
    .filter(t => selectedTokens.has(t.contractAddress))
    .reduce((a, b) => a + b.valueUsd, 0);

  return (
    <div className="pb-32 space-y-4">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      {/* Incoming token banner */}
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

      {/* Header card */}
      <div className="bg-gradient-to-t from-green-900 to-red-900 border border-red-800/40 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Flash className="w-4 h-4 text-yellow-400" /> Aggregator Mode
          </h3>
          <p className="text-xs text-green-200 mt-1">Auto-routing: 0x → LI.FI → KyberSwap</p>
          <p className="text-[10px] text-green-400 mt-0.5">5% platform fee applied</p>
        </div>
        <div className="bg-black/30 backdrop-blur-sm p-2 rounded-lg border border-white/20 min-w-[80px]">
          <div className="text-[10px] text-white/70 uppercase font-bold text-center">Selected</div>
          <div className="text-lg font-mono font-bold text-white text-center">
            ${selectedValue.toFixed(2)}
          </div>
        </div>
      </div>

      {/* ETH / USDC toggle */}
      <div className="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl">
        {(["ETH", "USDC"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTargetToken(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
              targetToken === t
                ? "bg-white dark:bg-zinc-900 shadow text-zinc-900 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {t === "ETH" ? "⟠ ETH" : "💵 USDC"}
          </button>
        ))}
      </div>

      {/* Token list header */}
      <div className="flex items-center justify-between px-2">
        <div className="text-sm font-bold text-zinc-500">Available Dust ({tokens.length})</div>
        <div className="flex items-center gap-2">
          <button onClick={loadDustTokens} className="text-zinc-500 hover:text-zinc-300">
            <Refresh className="w-3.5 h-3.5" />
          </button>
          <button onClick={selectAll} className="text-xs font-medium text-blue-500 hover:text-blue-400">
            {selectedTokens.size === tokens.length && tokens.length > 0 ? "Deselect All" : "Select All"}
          </button>
        </div>
      </div>

      {/* Token list */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-12 animate-pulse text-zinc-500 text-xs">Scanning vault tokens...</div>
        ) : tokens.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-xl space-y-2 p-4">
            {scanError
              ? <div className="text-red-400">⚠ {scanError}</div>
              : <div>No swappable tokens in vault.</div>
            }
            {vaultAddr && (
              <div className="text-[10px] text-zinc-600 font-mono break-all">
                Vault: {vaultAddr.slice(0, 10)}...{vaultAddr.slice(-8)}
              </div>
            )}
            <div className="text-[10px] text-zinc-600">Deposit tokens via Vault tab → Wallet Assets → Deposit</div>
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
                    ? isIncoming
                      ? "bg-orange-900/20 border-orange-500/50 shadow-md"
                      : "bg-blue-900/20 border-blue-500/50 shadow-md"
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
                    <div className="text-[10px] font-bold text-zinc-400">{buyTokenLabel}</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Deposited Dust — no route */}
      {noRouteTokens.length > 0 && (
        <div className="space-y-2 mt-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-wide flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-zinc-500 inline-block" />
              Deposited Dust ({noRouteTokens.length})
            </h3>
            {totalNoRoutePgs > 1 && (
              <span className="text-[10px] text-zinc-500">{vaultPage} / {totalNoRoutePgs}</span>
            )}
          </div>
          <div className="space-y-2">
            {noRouteTokens
              .slice((vaultPage - 1) * VAULT_PER_PAGE, vaultPage * VAULT_PER_PAGE)
              .map((token, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 opacity-70">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden">
                      <TokenLogo token={token} />
                    </div>
                    <div>
                      <div className="text-sm font-bold flex items-center gap-1.5">
                        {token.symbol}
                        <span className="text-[9px] bg-zinc-200 dark:bg-zinc-700 text-zinc-500 px-1 rounded">no route</span>
                      </div>
                      <div className="text-xs text-zinc-500">{parseFloat(token.formattedBal).toFixed(4)}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleWithdrawToken(token)}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400"
                  >
                    WD
                  </button>
                </div>
              ))}
          </div>
          {totalNoRoutePgs > 1 && (
            <div className="flex justify-center gap-1 mt-2">
              <button onClick={() => setVaultPage(p => Math.max(1, p - 1))} disabled={vaultPage === 1} className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs disabled:opacity-30">← Prev</button>
              <button onClick={() => setVaultPage(p => Math.min(totalNoRoutePgs, p + 1))} disabled={vaultPage === totalNoRoutePgs} className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs disabled:opacity-30">Next →</button>
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
              <><Flash className="w-5 h-5" />Sweep {Math.min(selectedTokens.size, 10)} Token{selectedTokens.size > 1 ? "s" : ""} → {buyTokenLabel}</>
            )}
          </button>
          <div className="text-center text-[10px] text-zinc-400 mt-2 bg-white/80 dark:bg-black/50 backdrop-blur-md py-1 rounded-full w-fit mx-auto px-3 shadow-sm border border-zinc-200 dark:border-zinc-800">
            {feeEnabled ? "5% fee" : "No fee"} · → {buyTokenLabel} via 0x & KyberSwap
          </div>
        </div>
      )}
    </div>
  );
};
