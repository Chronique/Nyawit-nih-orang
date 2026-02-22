"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount, useSwitchChain } from "wagmi";
import { getSmartAccountClient } from "~/lib/smart-account";
import { fetchMoralisTokens } from "~/lib/moralis-data";
import { fetchTokenPrices } from "~/lib/price";
import { formatUnits, encodeFunctionData, erc20Abi, type Address, maxUint256, formatEther } from "viem";
import { base } from "viem/chains";
import { Refresh, Flash, Check, ArrowRight, WarningTriangle } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";

// ── Constants ─────────────────────────────────────────────────────────────────
const USDC_ADDRESS   = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const FEE_RECIPIENT  = "0x4fba95e4772be6d37a0c931D00570Fe2c9675524";
const FEE_PERCENTAGE = "0.05";
const PLATFORM_FEE_BPS = 500n;   // 5%
const BPS_DENOM        = 10_000n;

const WETH_ABI = [
  { name: "withdraw",  type: "function", stateMutability: "nonpayable", inputs: [{ name: "wad", type: "uint256" }], outputs: [] },
  { name: "balanceOf", type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────
interface TokenData {
  contractAddress: string;
  symbol:          string;
  logo:            string | null;
  decimals:        number;
  rawBalance:      string;
  formattedBal:    string;
  priceUsd:        number;
  valueUsd:        number;
}

interface RouteResult {
  data:            `0x${string}`;
  to:              string;
  value:           string;
  approvalAddress: string;
  agg:             string;
  estimatedWethOut: bigint;  // estimasi dari quote (buyAmount)
}

interface SimItem {
  token:            TokenData;
  status:           "ok" | "skipped";
  reason?:          string;
  route?:           RouteResult;
  estimatedWethOut: bigint;
  estimatedFee:     bigint;
  netWethOut:       bigint;
}

interface SimSummary {
  items:          SimItem[];
  processable:    SimItem[];
  skipped:        SimItem[];
  totalNetWeth:   bigint;  // setelah fee
  totalFee:       bigint;
  gasEstimate:    bigint;
}

interface SwapViewProps {
  defaultFromToken?: {
    contractAddress: string; symbol: string;
    formattedBal: string; decimals: number; rawBalance: string;
  } | null;
  onTokenConsumed?: () => void;
}

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

  const [tokens, setTokens]                 = useState<TokenData[]>([]);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [loading, setLoading]               = useState(false);
  const [vaultTokens, setVaultTokens]       = useState<TokenData[]>([]);
  const [vaultPage, setVaultPage]           = useState(1);
  const [vaultAddr, setVaultAddr]           = useState<string | null>(null);
  const [scanError, setScanError]           = useState<string | null>(null);
  const [incomingToken, setIncomingToken]   = useState<SwapViewProps["defaultFromToken"]>(null);
  const [toast, setToast]                   = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Simulation state
  const [simulating, setSimulating]         = useState(false);
  const [simulation, setSimulation]         = useState<SimSummary | null>(null);

  // Execution state
  const [executing, setExecuting]           = useState(false);
  const [execProgress, setExecProgress]     = useState("");

  const VAULT_PER_PAGE = 10;
  const chainIdStr     = String(chainId || "8453");

  // ── Load dust tokens ──────────────────────────────────────────────────────
  const loadDustTokens = async () => {
    if (!walletClient) return;
    setLoading(true);
    setScanError(null);
    setSimulation(null); // reset simulation saat refresh
    try {
      const client       = await getSmartAccountClient(walletClient);
      const detectedAddr = client.account.address;
      setVaultAddr(detectedAddr);

      const moralisTokens = await fetchMoralisTokens(detectedAddr);
      const vaultLower    = detectedAddr.toLowerCase();
      const nonZero = moralisTokens.filter(t => {
        const addr    = t.token_address.toLowerCase();
        const isUSDC  = addr === USDC_ADDRESS.toLowerCase();
        const isVault = addr === vaultLower;
        if (isVault) console.warn("[SwapView] Filtered vault address:", addr);
        return !isUSDC && !isVault && BigInt(t.balance) > 0n;
      });

      if (nonZero.length === 0) { setTokens([]); setVaultTokens([]); return; }

      const prices = await fetchTokenPrices(nonZero.map(t => t.token_address));
      const formatted: TokenData[] = nonZero.map(t => {
        const decimals = t.decimals || 18;
        const fmtBal   = formatUnits(BigInt(t.balance), decimals);
        const price    = prices[t.token_address.toLowerCase()] || 0;
        return {
          contractAddress: t.token_address,
          symbol:          t.symbol || "UNKNOWN",
          logo:            t.logo || null,
          decimals, rawBalance: t.balance, formattedBal: fmtBal,
          priceUsd: price, valueUsd: parseFloat(fmtBal) * price,
        };
      });
      formatted.sort((a, b) => b.valueUsd - a.valueUsd);
      setVaultTokens(formatted);
      setVaultPage(1);

      const validDust = formatted.filter(t => t.valueUsd > 0.000001);
      setTokens(validDust);
      return validDust;
    } catch (e: any) {
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
        t => t.contractAddress.toLowerCase() === defaultFromToken.contractAddress.toLowerCase()
      );
      if (found) setSelectedTokens(new Set([found.contractAddress]));
      else setToast({ msg: `${defaultFromToken.symbol} not found in vault.`, type: "error" });
      onTokenConsumed?.();
    };
    trySelect();
  }, [defaultFromToken]);

  const toggleToken = (addr: string) => {
    const s = new Set(selectedTokens);
    if (s.has(addr)) s.delete(addr); else s.add(addr);
    setSelectedTokens(s);
    setSimulation(null); // reset preview kalau pilihan berubah
    if (incomingToken) setIncomingToken(null);
  };

  const selectAll = () => {
    if (selectedTokens.size === tokens.length) setSelectedTokens(new Set());
    else setSelectedTokens(new Set(tokens.map(t => t.contractAddress)));
    setSimulation(null);
    setIncomingToken(null);
  };

  const handleWithdrawToken = async (token: TokenData) => {
    if (!walletClient) return;
    const amount = prompt(`Withdraw ${token.symbol}? Enter amount:`, token.formattedBal);
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    if (!window.confirm(`Withdraw ${amount} ${token.symbol} to your wallet?`)) return;
    try {
      const client      = await getSmartAccountClient(walletClient);
      const ownerAddr   = walletClient.account?.address as Address;
      const rawAmount   = BigInt(Math.floor(parseFloat(amount) * 10 ** token.decimals));
      const data        = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ownerAddr, rawAmount] });
      const tx          = await client.sendUserOperation({ calls: [{ to: token.contractAddress as Address, value: 0n, data }] });
      setToast({ msg: `Withdrawing ${token.symbol}...`, type: "success" });
      await client.waitForUserOperationReceipt({ hash: tx });
      setToast({ msg: `${token.symbol} withdrawn!`, type: "success" });
      await loadDustTokens();
    } catch (e: any) {
      setToast({ msg: "Withdraw failed: " + (e.shortMessage || e.message), type: "error" });
    }
  };

  // ── SIMULATE: fetch routes, hitung fee & gas estimate ────────────────────
  // Mirip doc 5 simulateBatch — tapi pakai real quotes dari 0x/KyberSwap
  const handleSimulate = async () => {
    if (!walletClient || selectedTokens.size === 0) return;
    setSimulating(true);
    setSimulation(null);

    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      const client       = await getSmartAccountClient(walletClient);
      const vaultAddress = client.account.address;

      const tokensToSwap = tokens
        .filter(t => selectedTokens.has(t.contractAddress)
          && t.contractAddress.toLowerCase() !== WETH_ADDRESS.toLowerCase())
        .slice(0, 10);

      const items: SimItem[] = [];

      // Parallel route fetch — sama seperti FASE 1 execution
      await Promise.all(tokensToSwap.map(async (token) => {
        // Try 0x backend
        try {
          const params = new URLSearchParams({
            chainId:            chainIdStr,
            sellToken:          token.contractAddress,
            buyToken:           WETH_ADDRESS,
            sellAmount:         token.rawBalance,
            taker:              vaultAddress,
            slippagePercentage: "0.15",
            feeRecipient:          FEE_RECIPIENT,
            buyTokenPercentageFee: FEE_PERCENTAGE,
          });
          const res = await fetch(`/api/0x/quote?${params}`);
          if (res.ok) {
            const q = await res.json();
            if (!q.error && q.transaction?.data) {
              const gross = BigInt(q.buyAmount || "0");
              const fee   = (gross * PLATFORM_FEE_BPS) / BPS_DENOM;
              items.push({
                token, status: "ok",
                route: {
                  data:             q.transaction.data,
                  to:               q.transaction.to,
                  value:            q.transaction.value || "0",
                  approvalAddress:  q.transaction.approvalAddress || q.transaction.to,
                  agg:              q._source === "lifi" ? "LI.FI" : "0x",
                  estimatedWethOut: gross,
                },
                estimatedWethOut: gross,
                estimatedFee:     fee,
                netWethOut:       gross - fee,
              });
              return;
            }
          }
        } catch {}

        // Fallback KyberSwap
        try {
          const rRes = await fetch(
            `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${token.contractAddress}&tokenOut=${WETH_ADDRESS}&amountIn=${token.rawBalance}`,
            { headers: { Accept: "application/json", "x-client-id": "nyawit" } }
          );
          if (!rRes.ok) throw new Error("kyber route fail");
          const rd = await rRes.json();
          if (!rd?.data?.routeSummary) throw new Error("no summary");

          const bRes = await fetch(
            "https://aggregator-api.kyberswap.com/base/api/v1/route/build",
            {
              method: "POST",
              headers: { Accept: "application/json", "Content-Type": "application/json", "x-client-id": "nyawit" },
              body: JSON.stringify({
                routeSummary: rd.data.routeSummary,
                sender: vaultAddress, recipient: vaultAddress,
                slippageTolerance: 1500,
              }),
            }
          );
          if (!bRes.ok) throw new Error("kyber build fail");
          const bd = await bRes.json();
          if (!bd?.data?.data) throw new Error("no tx data");

          const gross = BigInt(rd.data.routeSummary.amountOut || "0");
          const fee   = (gross * PLATFORM_FEE_BPS) / BPS_DENOM;
          items.push({
            token, status: "ok",
            route: {
              data:             bd.data.data,
              to:               bd.data.routerAddress,
              value:            "0x0",
              approvalAddress:  bd.data.routerAddress,
              agg:              "KyberSwap",
              estimatedWethOut: gross,
            },
            estimatedWethOut: gross,
            estimatedFee:     fee,
            netWethOut:       gross - fee,
          });
        } catch {
          items.push({ token, status: "skipped", reason: "No route found", estimatedWethOut: 0n, estimatedFee: 0n, netWethOut: 0n });
        }
      }));

      // WETH yang dipilih langsung (unwrap saja, tidak perlu swap)
      const wethToken = tokens.find(t => t.contractAddress.toLowerCase() === WETH_ADDRESS.toLowerCase());
      if (wethToken && selectedTokens.has(wethToken.contractAddress)) {
        const gross = BigInt(wethToken.rawBalance);
        items.push({
          token: wethToken, status: "ok",
          route: undefined, // tidak perlu swap
          estimatedWethOut: gross,
          estimatedFee:     0n, // unwrap tidak kena fee platform
          netWethOut:       gross,
        });
      }

      const processable = items.filter(i => i.status === "ok");
      const skipped     = items.filter(i => i.status === "skipped");
      const totalNet    = processable.reduce((a, i) => a + i.netWethOut, 0n);
      const totalFee    = processable.reduce((a, i) => a + i.estimatedFee, 0n);

      // Gas estimate: ~150k per swap + ~50k approve + ~30k unwrap
      const gasEstimate = BigInt(processable.filter(i => i.route).length) * 200_000n + 30_000n;

      setSimulation({ items, processable, skipped, totalNetWeth: totalNet, totalFee, gasEstimate });
    } catch (e: any) {
      setToast({ msg: "Simulation failed: " + (e.message || "Unknown"), type: "error" });
    } finally {
      setSimulating(false);
    }
  };

  // ── EXECUTE: jalankan simulation yang sudah disiapkan ────────────────────
  // Fase 2: batch approve, Fase 3: sequential swaps, Fase 4: unwrap WETH
  const handleExecute = async () => {
    if (!walletClient || !simulation || simulation.processable.length === 0) return;
    setExecuting(true);
    setIncomingToken(null);

    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      const client       = await getSmartAccountClient(walletClient);
      const vaultAddress = client.account.address;
      const vaultLower   = vaultAddress.toLowerCase();
      const zeroAddr     = "0x0000000000000000000000000000000000000000";

      // Hanya token yang butuh swap (bukan WETH existing)
      const toSwap = simulation.processable.filter(i => i.route !== undefined);

      // ── FASE 2: Batch approve ────────────────────────────────────────────
      if (toSwap.length > 0) {
        setExecProgress(`Approving ${toSwap.length} tokens (1 tx)...`);

        const approvalCalls = toSwap
          .map(item => {
            const tokenAddr   = item.token.contractAddress.toLowerCase();
            const spenderAddr = item.route!.approvalAddress.toLowerCase();
            if (tokenAddr === vaultLower || spenderAddr === vaultLower || spenderAddr === zeroAddr) {
              console.error(`[Approve] SKIP ${item.token.symbol}: invalid addresses`);
              return null;
            }
            console.log(`[Approve] ${item.token.symbol}: spender ${spenderAddr.slice(0,8)}`);
            return {
              to:    item.token.contractAddress as Address,
              value: 0n,
              data:  encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [item.route!.approvalAddress as Address, maxUint256] }),
            };
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);

        if (approvalCalls.length > 0) {
          const approveTx = await client.sendUserOperation({ calls: approvalCalls });
          setExecProgress("Waiting for approvals...");
          await client.waitForUserOperationReceipt({ hash: approveTx });
        }
      }

      // ── FASE 3: Sequential swaps ─────────────────────────────────────────
      let successCount = 0;
      let failCount    = 0;

      for (const item of toSwap) {
        setExecProgress(`[${successCount + failCount + 1}/${toSwap.length}] ${item.token.symbol} → WETH via ${item.route!.agg}...`);
        try {
          // Re-fetch fresh quote tepat sebelum swap
          let freshRoute = item.route!;
          try {
            const params = new URLSearchParams({
              chainId: chainIdStr, sellToken: item.token.contractAddress,
              buyToken: WETH_ADDRESS, sellAmount: item.token.rawBalance,
              taker: vaultAddress, slippagePercentage: "0.15",
              feeRecipient: FEE_RECIPIENT, buyTokenPercentageFee: FEE_PERCENTAGE,
            });
            const res = await fetch(`/api/0x/quote?${params}`);
            if (res.ok) {
              const q = await res.json();
              if (!q.error && q.transaction?.data) {
                freshRoute = { ...freshRoute, data: q.transaction.data, to: q.transaction.to, value: q.transaction.value || "0" };
              }
            }
          } catch {}

          const swapTx = await client.sendUserOperation({
            calls: [{ to: freshRoute.to as Address, value: BigInt(freshRoute.value), data: freshRoute.data }],
          });
          await client.waitForUserOperationReceipt({ hash: swapTx });
          console.log(`[Swap] ${item.token.symbol} → WETH ✓`);
          successCount++;
        } catch (e: any) {
          console.error(`[Swap] ${item.token.symbol} failed:`, e?.message);
          failCount++;
          setExecProgress(`${item.token.symbol} failed, continuing...`);
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // ── FASE 4: Unwrap WETH → ETH ────────────────────────────────────────
      setExecProgress("Checking WETH for unwrap...");
      try {
        const { createPublicClient, http } = await import("viem");
        const pc          = createPublicClient({ chain: base, transport: http() });
        const wethBalance = await pc.readContract({
          address: WETH_ADDRESS as Address, abi: WETH_ABI, functionName: "balanceOf", args: [vaultAddress as Address],
        });
        if (wethBalance > 0n) {
          setExecProgress(`Unwrapping ${formatUnits(wethBalance, 18).slice(0, 8)} WETH → ETH...`);
          const unwrapTx = await client.sendUserOperation({
            calls: [{
              to:    WETH_ADDRESS as Address, value: 0n,
              data:  encodeFunctionData({ abi: WETH_ABI, functionName: "withdraw", args: [wethBalance] }),
            }],
          });
          await client.waitForUserOperationReceipt({ hash: unwrapTx });
          console.log("[Unwrap] WETH → ETH ✓");
        }
      } catch (e: any) {
        console.warn("[Unwrap] Failed:", e?.message);
      }

      const parts = [];
      if (successCount > 0) parts.push(`${successCount} swapped`);
      if (failCount > 0)    parts.push(`${failCount} failed`);
      if (simulation.skipped.length > 0) parts.push(`${simulation.skipped.length} no route`);
      setToast({ msg: successCount > 0 ? `✓ ${parts.join(", ")} → ETH` : `All failed: ${parts.join(", ")}`, type: successCount > 0 ? "success" : "error" });

      await new Promise(r => setTimeout(r, 2000));
      await loadDustTokens();
      setSelectedTokens(new Set());
      setSimulation(null);

    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown";
      setToast({ msg: msg.includes("rejected") || msg.includes("denied") ? "Cancelled." : "Error: " + msg, type: "error" });
    } finally {
      setExecuting(false);
      setExecProgress("");
    }
  };

  // ── UI helpers ────────────────────────────────────────────────────────────
  const noRouteTokens   = vaultTokens.filter(t => t.valueUsd <= 0.000001);
  const totalNoRoutePgs = Math.ceil(noRouteTokens.length / VAULT_PER_PAGE);
  const selectedValue   = tokens.filter(t => selectedTokens.has(t.contractAddress)).reduce((a, b) => a + b.valueUsd, 0);

  return (
    <div className="pb-36 space-y-4">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      {/* Banner incoming token */}
      {incomingToken && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 animate-in slide-in-from-top-2 duration-300">
          <Flash className="w-4 h-4 text-orange-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-orange-300">From Vault</div>
            <div className="text-sm text-orange-100 truncate">
              {incomingToken.symbol} — {parseFloat(incomingToken.formattedBal).toFixed(4)}
            </div>
          </div>
          <button onClick={() => { setIncomingToken(null); setSelectedTokens(new Set()); setSimulation(null); }} className="text-orange-400 hover:text-orange-200 text-xs">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-t from-green-900 to-red-900 border border-red-800/40 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Flash className="w-4 h-4 text-yellow-400" /> Aggregator Mode
          </h3>
          <p className="text-xs text-green-200 mt-1">Token → WETH → ETH (auto unwrap)</p>
          <p className="text-[10px] text-green-400 mt-0.5">5% platform fee · 0x & KyberSwap</p>
        </div>
        <div className="bg-black/30 p-2 rounded-lg border border-white/20 min-w-[80px]">
          <div className="text-[10px] text-white/70 uppercase font-bold text-center">Selected</div>
          <div className="text-lg font-mono font-bold text-white text-center">${selectedValue.toFixed(2)}</div>
        </div>
      </div>

      {/* Token list header */}
      <div className="flex items-center justify-between px-2">
        <div className="text-sm font-bold text-zinc-500">Available Dust ({tokens.length})</div>
        <div className="flex items-center gap-2">
          <button onClick={loadDustTokens} className="text-zinc-500 hover:text-zinc-300"><Refresh className="w-3.5 h-3.5" /></button>
          <button onClick={selectAll} className="text-xs font-medium text-blue-500 hover:text-blue-400">
            {selectedTokens.size === tokens.length && tokens.length > 0 ? "Deselect All" : "Select All"}
          </button>
        </div>
      </div>

      {/* Token list */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-12 animate-pulse text-zinc-500 text-xs">Scanning dust tokens...</div>
        ) : tokens.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 text-xs border border-dashed border-zinc-800 rounded-xl space-y-2 p-4">
            {scanError ? <div className="text-red-400">⚠ Error: {scanError}</div> : <div>No dust tokens found in vault.</div>}
            {vaultAddr && <div className="text-[10px] text-zinc-600 font-mono break-all">Vault: {vaultAddr.slice(0,10)}...{vaultAddr.slice(-8)}</div>}
          </div>
        ) : (
          tokens.map((token, i) => {
            const isSelected = selectedTokens.has(token.contractAddress);
            const isIncoming = incomingToken?.contractAddress.toLowerCase() === token.contractAddress.toLowerCase();
            const isWeth     = token.contractAddress.toLowerCase() === WETH_ADDRESS.toLowerCase();
            // Cek apakah token ini ada di simulasi result
            const simItem    = simulation?.items.find(s => s.token.contractAddress === token.contractAddress);
            const simOk      = simItem?.status === "ok";
            const simSkip    = simItem?.status === "skipped";

            return (
              <div
                key={i}
                onClick={() => toggleToken(token.contractAddress)}
                className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                  isSelected
                    ? isIncoming
                      ? "bg-orange-900/20 border-orange-500/50"
                      : simSkip
                        ? "bg-red-900/10 border-red-500/30"
                        : "bg-blue-900/20 border-blue-500/50"
                    : "bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                    isSelected
                      ? simSkip ? "bg-red-500 border-red-500 text-white" : isIncoming ? "bg-orange-500 border-orange-500 text-white" : "bg-blue-500 border-blue-500 text-white"
                      : "border-zinc-600 text-transparent"
                  }`}>
                    <Check className="w-3 h-3" strokeWidth={4} />
                  </div>
                  <TokenLogo token={token} />
                  <div>
                    <div className="text-sm font-bold dark:text-white flex items-center gap-1.5">
                      {token.symbol}
                      {isWeth && <span className="text-[9px] bg-blue-900/30 text-blue-400 px-1 rounded">UNWRAP</span>}
                      {isIncoming && <span className="text-[9px] bg-orange-900/30 text-orange-400 px-1 rounded">FROM VAULT</span>}
                      {simSkip && <span className="text-[9px] bg-red-900/30 text-red-400 px-1 rounded">NO ROUTE</span>}
                    </div>
                    <div className="text-xs text-zinc-500">{parseFloat(token.formattedBal).toFixed(4)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-zinc-700 dark:text-zinc-300">${token.valueUsd.toFixed(2)}</div>
                  {/* Tampilkan estimasi ETH kalau ada simulasi */}
                  {simOk && simItem?.netWethOut && simItem.netWethOut > 0n ? (
                    <div className="text-[10px] text-green-400 font-mono">
                      ~{parseFloat(formatEther(simItem.netWethOut)).toFixed(5)} ETH
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 justify-end opacity-50">
                      <ArrowRight className="w-3 h-3 text-zinc-300" />
                      <div className="text-[10px] font-bold text-zinc-400">ETH</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── SIMULATION SUMMARY CARD ── */}
      {simulation && (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-4 space-y-3 animate-in slide-in-from-bottom-2 duration-200">
          <div className="text-xs font-bold text-zinc-400 uppercase tracking-wide">Swap Preview</div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-zinc-800 rounded-xl p-3">
              <div className="text-[10px] text-zinc-500 mb-0.5">Will Process</div>
              <div className="text-base font-bold text-white">{simulation.processable.length} tokens</div>
            </div>
            <div className="bg-zinc-800 rounded-xl p-3">
              <div className="text-[10px] text-zinc-500 mb-0.5">Skipped</div>
              <div className={`text-base font-bold ${simulation.skipped.length > 0 ? "text-red-400" : "text-zinc-400"}`}>
                {simulation.skipped.length} tokens
              </div>
            </div>
            <div className="bg-green-900/30 border border-green-700/40 rounded-xl p-3">
              <div className="text-[10px] text-green-500 mb-0.5">Est. ETH Out</div>
              <div className="text-base font-bold text-green-300 font-mono">
                {parseFloat(formatEther(simulation.totalNetWeth)).toFixed(6)} ETH
              </div>
            </div>
            <div className="bg-zinc-800 rounded-xl p-3">
              <div className="text-[10px] text-zinc-500 mb-0.5">Platform Fee (5%)</div>
              <div className="text-base font-bold text-zinc-300 font-mono">
                {parseFloat(formatEther(simulation.totalFee)).toFixed(6)} WETH
              </div>
            </div>
          </div>

          {/* Gas estimate */}
          <div className="flex items-center justify-between text-xs text-zinc-500 px-1">
            <span>Est. gas units</span>
            <span className="font-mono">{simulation.gasEstimate.toLocaleString()}</span>
          </div>

          {/* Per-token breakdown */}
          {simulation.processable.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-zinc-500 uppercase font-bold px-1">Breakdown</div>
              {simulation.processable.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-zinc-800/50 rounded-lg px-2.5 py-1.5">
                  <span className="font-bold text-zinc-200">{item.token.symbol}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500 text-[9px]">{item.route?.agg ?? "unwrap"}</span>
                    <span className="text-green-400 font-mono">
                      {item.netWethOut > 0n ? `~${parseFloat(formatEther(item.netWethOut)).toFixed(5)} ETH` : "unwrap"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Skipped list */}
          {simulation.skipped.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-red-500 uppercase font-bold px-1 flex items-center gap-1">
                <WarningTriangle className="w-3 h-3" /> Skipped
              </div>
              {simulation.skipped.map((item, i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-red-900/10 rounded-lg px-2.5 py-1.5">
                  <span className="font-bold text-red-300">{item.token.symbol}</span>
                  <span className="text-zinc-500 text-[9px]">{item.reason}</span>
                </div>
              ))}
            </div>
          )}

          {/* Confirm button */}
          {simulation.processable.length > 0 && (
            <button
              onClick={handleExecute}
              disabled={executing}
              className="w-full py-3 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white flex items-center justify-center gap-2 transition-colors"
            >
              {executing ? (
                <><Refresh className="w-4 h-4 animate-spin" /><span>{execProgress}</span></>
              ) : (
                <><Flash className="w-4 h-4" />Confirm & Swap {simulation.processable.length} Token{simulation.processable.length > 1 ? "s" : ""}</>
              )}
            </button>
          )}
        </div>
      )}

      {/* ── Deposited Dust (no route tokens) ── */}
      {noRouteTokens.length > 0 && (
        <div className="space-y-2 mt-6">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-wide flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-zinc-500 inline-block" />
              Deposited Dust ({noRouteTokens.length})
            </h3>
            <span className="text-[10px] text-zinc-500">Page {vaultPage} / {totalNoRoutePgs}</span>
          </div>
          <div className="space-y-2">
            {noRouteTokens
              .slice((vaultPage - 1) * VAULT_PER_PAGE, vaultPage * VAULT_PER_PAGE)
              .map((token, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden">
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
            <div className="flex justify-center items-center gap-1 mt-2">
              <button onClick={() => setVaultPage(p => Math.max(1, p - 1))} disabled={vaultPage === 1} className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs disabled:opacity-30">← Prev</button>
              {Array.from({ length: totalNoRoutePgs }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalNoRoutePgs || Math.abs(p - vaultPage) <= 2)
                .reduce((acc: (number | string)[], p, idx, arr) => {
                  if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("...");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) => p === "..." ? (
                  <span key={i} className="px-2 text-zinc-400 text-xs">...</span>
                ) : (
                  <button key={i} onClick={() => setVaultPage(p as number)} className={`w-8 h-8 rounded-lg text-xs font-bold ${vaultPage === p ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"}`}>{p}</button>
                ))}
              <button onClick={() => setVaultPage(p => Math.min(totalNoRoutePgs, p + 1))} disabled={vaultPage === totalNoRoutePgs} className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs disabled:opacity-30">Next →</button>
            </div>
          )}
        </div>
      )}

      {/* ── Floating Preview button (muncul kalau ada token dipilih & belum simulate) ── */}
      {selectedTokens.size > 0 && !simulation && (
        <div className="fixed bottom-24 left-4 right-4 z-40 animate-in slide-in-from-bottom-5">
          <button
            onClick={handleSimulate}
            disabled={simulating}
            className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white shadow-xl py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-colors"
          >
            {simulating ? (
              <><Refresh className="w-5 h-5 animate-spin" /><span className="text-sm">Fetching routes...</span></>
            ) : (
              <><Flash className="w-5 h-5 text-yellow-400" />Preview Swap ({Math.min(selectedTokens.size, 10)} tokens)</>
            )}
          </button>
          <div className="text-center text-[10px] text-zinc-400 mt-2">
            Cek estimasi ETH & fee sebelum execute
          </div>
        </div>
      )}
    </div>
  );
};
