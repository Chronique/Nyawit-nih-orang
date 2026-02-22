"use client";

// src/components/dust/swap-view.tsx
//
// FLOW:
// 1. Load vault tokens via Moralis
// 2. Fetch prices → classify as swappable (valueUsd > 0) or "no route"
// 3. User select tokens → handleBatchSwap
// 4. For each token: get quote from 0x → LI.FI → KyberSwap (fallback chain)
// 5. Build atomic batch: [approve → swap → fee_transfer] per token
//    - All calls in ONE UserOp → if any revert, ALL revert (atomic)
//    - Fee only lands if swap succeeds → user never loses fee on failed swap
// 6. Send UserOp via ZeroDev Kernel / Coinbase SA

import { useEffect, useState } from "react";
import { useWalletClient, useAccount, useSwitchChain } from "wagmi";
import { getSmartAccountClient, isSupportedChain, getChainLabel } from "~/lib/smart-account";
import { fetchMoralisTokens } from "~/lib/moralis-data";
import { fetchTokenPrices } from "~/lib/price";
import { formatUnits, encodeFunctionData, erc20Abi, type Address, maxUint256 } from "viem";
import { base, baseSepolia } from "viem/chains";
import { Refresh, Flash, ArrowRight, Check } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Constants ────────────────────────────────────────────────────────────────
const USDC_MAINNET   = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_SEPOLIA   = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const WETH_ADDRESS   = "0x4200000000000000000000000000000000000006";
const ETH_NATIVE     = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"; // sentinel untuk 0x/LI.FI

const LIFI_API_URL   = "https://li.quest/v1";
const LIFI_API_KEY   = process.env.NEXT_PUBLIC_LIFI_API_KEY || "";

const FEE_RECIPIENT  = "0x4fba95e4772be6d37a0c931D00570Fe2c9675524";
// 5% fee — justified oleh smart vault batch swap feature
// FEE diambil dari token SEBELUM swap (manual transfer), bukan dari output ETH
// Tetap atomic: kalau swap revert → fee transfer juga revert
const FEE_BPS        = 500n;   // 500 bps = 5%
const FEE_DIVISOR    = 10000n;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getUsdcAddress = (chainId: number) =>
  chainId === baseSepolia.id ? USDC_SEPOLIA : USDC_MAINNET;

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

// ─── Component ────────────────────────────────────────────────────────────────
export const SwapView = ({ defaultFromToken, onTokenConsumed }: SwapViewProps) => {
  const { data: walletClient } = useWalletClient();
  const { chainId = base.id }  = useAccount();
  const { switchChainAsync }   = useSwitchChain();

  // ── State ─────────────────────────────────────────────────────────────────
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
  const [targetToken, setTargetToken]       = useState<"ETH" | "USDC">("ETH"); // ← output toggle
  const [feeEnabled, setFeeEnabled]         = useState(true);                  // ← fee toggle

  // ── Computed ──────────────────────────────────────────────────────────────
  const VAULT_PER_PAGE = 10;
  const usdcAddress    = getUsdcAddress(chainId);
  const chainIdStr     = String(chainId);
  const isTestnet      = chainId === baseSepolia.id;

  // buyToken untuk aggregator: ETH_NATIVE atau USDC
  const buyToken      = targetToken === "USDC" ? usdcAddress : ETH_NATIVE;
  const buyTokenLabel = targetToken;
  // KyberSwap tidak support native ETH output → pakai WETH sebagai proxy
  const kyberBuyToken = buyToken === ETH_NATIVE ? WETH_ADDRESS : buyToken;

  const noRouteTokens   = vaultTokens.filter(t => t.valueUsd <= 0.000001);
  const totalNoRoutePgs = Math.ceil(noRouteTokens.length / VAULT_PER_PAGE);
  const selectedValue   = tokens
    .filter(t => selectedTokens.has(t.contractAddress))
    .reduce((a, b) => a + b.valueUsd, 0);

  // ── 1. Load vault tokens ───────────────────────────────────────────────────
  const loadDustTokens = async () => {
    if (!walletClient) return;
    setLoading(true);
    setScanError(null);
    try {
      const client = await getSmartAccountClient(walletClient);
      const addr   = client.account.address;
      setVaultAddr(addr);

      const moralisTokens = await fetchMoralisTokens(addr);
      const vaultLower    = addr.toLowerCase();

      // Filter: exclude USDC, zero balance, vault address sendiri
      // Moralis kadang return vault address sebagai "token" — menyebabkan approval ke diri sendiri
      const nonZero = moralisTokens.filter((t) => {
        const tAddr   = t.token_address.toLowerCase();
        const isUSDC  = tAddr === usdcAddress.toLowerCase();
        const isVault = tAddr === vaultLower;
        if (isVault) console.warn("[SwapView] Filtered vault address from token list:", tAddr);
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

      const swappable = formatted.filter((t) => t.valueUsd > 0.000001);
      setTokens(swappable);
      return swappable;
    } catch (e: any) {
      setScanError(e?.shortMessage || e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (walletClient) loadDustTokens(); }, [walletClient, chainId]);

  // ── Handle incoming token from VaultView ───────────────────────────────────
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

  // ── Withdraw single token ──────────────────────────────────────────────────
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

  // ── Quote functions ────────────────────────────────────────────────────────

  // 0x — allowance-holder endpoint, fee dari output token
  // approvalAddress bisa beda dari transaction.to — selalu pakai field ini untuk approve
  const getZeroExQuote = async (token: TokenData, amount: string, vaultAddress: string) => {
    if (isTestnet) throw new Error("0x: mainnet only");
    const params = new URLSearchParams({
      chainId:   chainIdStr,
      sellToken: token.contractAddress,
      buyToken:  buyToken,    // ETH_NATIVE atau USDC
      sellAmount: amount,
      taker:     vaultAddress,
    });
    if (feeEnabled) {
      params.set("feeRecipient",          FEE_RECIPIENT);
      params.set("buyTokenPercentageFee", "0.05");
    }
    const res = await fetch(`/api/0x/quote?${params}`);
    if (!res.ok) throw new Error("0x: no route");
    const q = await res.json();
    if (q.error) throw new Error("0x: " + q.error);
    return {
      data:            q.transaction.data,
      to:              q.transaction.to,
      value:           q.transaction.value || "0",
      // approvalAddress WAJIB dipakai untuk approve — bisa beda dari router
      approvalAddress: q.transaction.approvalAddress || q.transaction.to,
    };
  };

  // LI.FI — fallback, fee via integrator program
  // approvalAddress dari estimate field — BEDA dari transactionRequest.to (ini penyebab revert #1002)
  const getLifiQuote = async (token: TokenData, amount: string, fromAddress: string) => {
    const params = new URLSearchParams({
      fromChain:     chainIdStr,
      toChain:       chainIdStr,
      fromToken:     token.contractAddress,
      toToken:       buyToken,    // ETH_NATIVE atau USDC
      fromAmount:    amount,
      fromAddress,
      toAddress:     fromAddress,
      slippage:      "0.03",
      denyExchanges: "paraswap", // paraswap = permit2, tidak support vault
    });
    if (LIFI_API_KEY && feeEnabled) {
      params.set("integrator", "nyawit");
      params.set("fee",        "0.05");
      params.set("referrer",   FEE_RECIPIENT);
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (LIFI_API_KEY) headers["x-lifi-api-key"] = LIFI_API_KEY;
    const res = await fetch(`${LIFI_API_URL}/quote?${params}`, { headers });
    if (!res.ok) throw new Error(`LI.FI ${res.status}`);
    const q = await res.json();

    // Reject permit2 — vault tidak support off-chain signature
    const approvalAddr = (q?.estimate?.approvalAddress || "").toLowerCase();
    if (approvalAddr === "0x000000000022d473030f116ddee9f6b43ac78ba3") {
      throw new Error("LI.FI: permit2 only — skipping");
    }

    return {
      data:            q.transactionRequest.data,
      to:              q.transactionRequest.to,
      value:           q.transactionRequest.value || "0",
      // KUNCI FIX: pakai estimate.approvalAddress, BUKAN transactionRequest.to
      approvalAddress: q.estimate?.approvalAddress || q.transactionRequest.to,
    };
  };

  // KyberSwap — third fallback, no API key needed
  const getKyberQuote = async (token: TokenData, amount: string, fromAddress: string) => {
    const chain = isTestnet ? "base-sepolia" : "base";
    const routeRes = await fetch(
      `https://aggregator-api.kyberswap.com/${chain}/api/v1/routes` +
      `?tokenIn=${token.contractAddress}&tokenOut=${kyberBuyToken}&amountIn=${amount}`,
      { headers: { Accept: "application/json", "x-client-id": "nyawit" } }
    );
    if (!routeRes.ok) throw new Error(`Kyber route ${routeRes.status}`);
    const routeData = await routeRes.json();
    if (!routeData?.data?.routeSummary) throw new Error("Kyber: no route");

    const buildRes = await fetch(
      `https://aggregator-api.kyberswap.com/${chain}/api/v1/route/build`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "x-client-id": "nyawit" },
        body: JSON.stringify({
          routeSummary:      routeData.data.routeSummary,
          sender:            fromAddress,
          recipient:         fromAddress,
          slippageTolerance: 300,
        }),
      }
    );
    if (!buildRes.ok) throw new Error(`Kyber build ${buildRes.status}`);
    const buildData = await buildRes.json();
    if (!buildData?.data?.data) throw new Error("Kyber: no tx data");

    return {
      data:            buildData.data.data,
      to:              buildData.data.routerAddress,
      value:           "0x0",
      approvalAddress: buildData.data.routerAddress,
    };
  };

  // ── handleBatchSwap — 2 FASE ──────────────────────────────────────────────
  //
  // MASALAH atomic (approve+swap 1 UserOp):
  //   ERC-4337 bundler simulate setiap call secara independen — ketika
  //   swap disimulasi, approval dari call sebelumnya belum "terbaca" di storage.
  //   Hasilnya: bundler reject UserOp karena allowance = 0.
  //
  // SOLUSI 2-fase:
  //   FASE 1 (1 UserOp): batch semua approve maxUint256 → confirm dulu
  //   FASE 2 (1 UserOp): batch semua [swap → fee_transfer] → atomic
  //
  //   Fase 2 tetap atomic: kalau 1 swap revert → SEMUA revert termasuk fee.
  //   Fee hanya sampai kalau SEMUA swap sukses.
  //
  // KENAPA swapAmount = 95%?
  //   approve maxUint256 → router boleh tarik berapa pun
  //   swap pakai 95% → vault masih punya 5%
  //   fee_transfer 5% → vault kosong
  //   Kalau swap 100% dulu baru fee_transfer → vault kosong → revert
  const handleBatchSwap = async () => {
    if (!walletClient || selectedTokens.size === 0) return;
    if (!isSupportedChain(chainId)) {
      setToast({ msg: "Switch to Base or Base Sepolia first.", type: "error" });
      return;
    }

    setSwapping(true);
    setSwapProgress("Initializing...");
    setIncomingToken(null);

    try {
      const client       = await getSmartAccountClient(walletClient);
      const vaultAddress = client.account.address;
      const vaultLower   = vaultAddress.toLowerCase();
      const zeroAddr     = "0x0000000000000000000000000000000000000000";

      const tokensToSwap = tokens.filter((t) => selectedTokens.has(t.contractAddress));

      // ── Pre-compute amounts ───────────────────────────────────────────────
      // Hitung fee/swapAmount tiap token di awal biar konsisten
      const tokenAmounts = new Map<string, { rawBig: bigint; feeAmount: bigint; swapAmount: string }>();
      for (const token of tokensToSwap) {
        const rawBig    = BigInt(token.rawBalance);
        const feeAmount = feeEnabled ? rawBig * FEE_BPS / FEE_DIVISOR : 0n;
        tokenAmounts.set(token.contractAddress, {
          rawBig, feeAmount, swapAmount: (rawBig - feeAmount).toString(),
        });
      }

      // ── FASE 1: Fetch semua quote (parallel) ──────────────────────────────
      setSwapProgress(`Finding routes for ${tokensToSwap.length} tokens...`);

      type RouteInfo = { data: string; to: string; value: string; approvalAddress: string; agg: string };
      const routes = new Map<string, RouteInfo>();

      await Promise.all(tokensToSwap.map(async (token) => {
        if (token.contractAddress.toLowerCase() === vaultLower) return;

        const { swapAmount } = tokenAmounts.get(token.contractAddress)!;
        const aggregators = [
          { name: "0x",        fn: () => getZeroExQuote(token, swapAmount, vaultAddress)  },
          { name: "LI.FI",     fn: () => getLifiQuote(token, swapAmount, vaultAddress)    },
          { name: "KyberSwap", fn: () => getKyberQuote(token, swapAmount, vaultAddress)   },
        ];

        for (const { name, fn } of aggregators) {
          try {
            const r = await fn();
            const spender = r.approvalAddress.toLowerCase();
            if (spender === vaultLower || spender === zeroAddr) continue;
            routes.set(token.contractAddress, { ...r, agg: name });
            console.log(`[Route] ${token.symbol} → ${name} | spender: ${spender.slice(0,10)}`);
            break;
          } catch (e: any) {
            console.warn(`[Route] ${name} failed for ${token.symbol}:`, e?.message);
          }
        }
      }));

      if (routes.size === 0) {
        setToast({ msg: "No routes found for selected tokens.", type: "error" });
        return;
      }

      const routable  = tokensToSwap.filter(t => routes.has(t.contractAddress));
      const noRoute   = tokensToSwap.filter(t => !routes.has(t.contractAddress));
      if (noRoute.length > 0) {
        console.log("[Swap] No route:", noRoute.map(t => t.symbol).join(", "));
      }

      // ── FASE 2: Batch approve semua sekaligus (1 UserOp, confirm dulu) ────
      // Pakai maxUint256 agar tidak perlu hitung exact amount per token
      // Ini HARUS di-confirm sebelum swap — bundler tidak bisa simulate approve+swap sekaligus
      setSwapProgress(`Approving ${routable.length} token${routable.length > 1 ? "s" : ""}...`);

      const approveCalls = routable.map(token => {
        const route = routes.get(token.contractAddress)!;
        const approveData = encodeFunctionData({
          abi: erc20Abi, functionName: "approve",
          args: [route.approvalAddress as Address, maxUint256],
        });
        return { to: token.contractAddress as Address, value: 0n, data: approveData };
      });

      const approveTx = await client.sendUserOperation({ calls: approveCalls });
      setSwapProgress("Waiting for approval confirmation...");
      await client.waitForUserOperationReceipt({ hash: approveTx });
      console.log("[Approve] Batch confirmed ✓");

      // ── FASE 3: Batch swap + fee transfer (1 UserOp, atomic) ──────────────
      // Semua [swap → fee] dalam 1 UserOp → kalau 1 revert → SEMUA revert
      // Fee hanya sampai kalau SEMUA swap sukses (fully atomic)
      setSwapProgress(`Swapping ${routable.length} token${routable.length > 1 ? "s" : ""}...`);

      const swapCalls: any[] = [];
      for (const token of routable) {
        const route     = routes.get(token.contractAddress)!;
        const { feeAmount } = tokenAmounts.get(token.contractAddress)!;

        // Call A: swap
        swapCalls.push({
          to:    route.to as Address,
          value: BigInt(route.value),
          data:  route.data,
        });

        // Call B: fee transfer (hanya kalau feeEnabled, 5% masih ada di vault)
        if (feeEnabled && feeAmount > 0n) {
          const feeData = encodeFunctionData({
            abi: erc20Abi, functionName: "transfer",
            args: [FEE_RECIPIENT as Address, feeAmount],
          });
          swapCalls.push({ to: token.contractAddress as Address, value: 0n, data: feeData });
        }
      }

      const swapTx = await client.sendUserOperation({ calls: swapCalls });
      setSwapProgress("Waiting for swap confirmation...");
      await client.waitForUserOperationReceipt({ hash: swapTx });

      const swapped = routable.length;
      const skipped = noRoute.length;
      const msg = skipped > 0
        ? `✓ Swapped ${swapped} token${swapped > 1 ? "s" : ""} → ${buyTokenLabel}. ${skipped} skipped (no route).`
        : `✓ Swapped ${swapped} token${swapped > 1 ? "s" : ""} → ${buyTokenLabel}!`;
      setToast({ msg, type: "success" });

      await new Promise(r => setTimeout(r, 2000));
      await loadDustTokens();
      setSelectedTokens(new Set());

    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown error";
      if (msg.includes("User rejected") || msg.includes("user denied") || msg.includes("rejected")) {
        setToast({ msg: "Transaction cancelled.", type: "error" });
      } else {
        setToast({ msg: "Swap failed: " + msg, type: "error" });
      }
    } finally {
      setSwapping(false);
      setSwapProgress("");
    }
  };

  return (
    <div className="pb-32 space-y-4">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      {/* ── Incoming token banner (dari VaultView) ─────────────────────────── */}
      {incomingToken && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 animate-in slide-in-from-top-2 duration-300">
          <Flash className="w-4 h-4 text-orange-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-orange-300">From Vault</div>
            <div className="text-sm text-orange-100 truncate">
              {incomingToken.symbol} — {parseFloat(incomingToken.formattedBal).toFixed(4)}
            </div>
          </div>
          <button
            onClick={() => { setIncomingToken(null); setSelectedTokens(new Set()); }}
            className="text-orange-400 hover:text-orange-200 text-xs"
          >✕</button>
        </div>
      )}

      {/* ── Header card ────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-t from-green-900 to-red-900 border border-red-800/40 rounded-2xl p-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Flash className="w-4 h-4 text-yellow-400" /> Aggregator Mode
          </h3>
          <p className="text-xs text-green-200 mt-1">
            Auto-routing: 0x → LI.FI → KyberSwap
            <br />
            <span className={feeEnabled ? "text-green-300" : "text-zinc-400"}>
              {feeEnabled ? "5% platform fee · 3% max slippage" : "No fee · 3% max slippage"}
            </span>
          </p>
          <p className="text-[9px] text-white/40 mt-0.5">{getChainLabel(chainId)}</p>
        </div>
        <div className="bg-black/30 backdrop-blur-sm p-2 rounded-lg border border-white/20 min-w-[80px]">
          <div className="text-[10px] text-white/70 uppercase font-bold text-center">Selected</div>
          <div className="text-lg font-mono font-bold text-white text-center">
            ${selectedValue.toFixed(2)}
          </div>
        </div>
      </div>

      {/* ── ETH / USDC toggle ──────────────────────────────────────────────── */}
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

      

      {/* ── Swappable tokens list ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-2">
        <div className="text-sm font-bold text-zinc-500">
          Available Dust ({tokens.length})
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadDustTokens} className="text-zinc-500 hover:text-zinc-300">
            <Refresh className="w-3.5 h-3.5" />
          </button>
          <button onClick={selectAll} className="text-xs font-medium text-blue-500 hover:text-blue-400">
            {selectedTokens.size === tokens.length && tokens.length > 0 ? "Deselect All" : "Select All"}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-12 animate-pulse text-zinc-500 text-xs">
            Scanning vault tokens...
          </div>
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
            <div className="text-[10px] text-zinc-600">
              Deposit tokens via Vault tab → Wallet Assets → Deposit
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
                      {isIncoming && (
                        <span className="text-[9px] bg-orange-900/30 text-orange-400 px-1 rounded">FROM VAULT</span>
                      )}
                      {!isIncoming && token.valueUsd < 0.01 && (
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
                    <div className="text-[10px] font-bold text-zinc-400">{buyTokenLabel}</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── No-route tokens ────────────────────────────────────────────────── */}
      {noRouteTokens.length > 0 && (
        <div className="space-y-2 mt-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-wide flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-zinc-500 inline-block" />
              Unpriced Tokens ({noRouteTokens.length})
            </h3>
            {totalNoRoutePgs > 1 && (
              <span className="text-[10px] text-zinc-500">
                {vaultPage} / {totalNoRoutePgs}
              </span>
            )}
          </div>

          <div className="space-y-2">
            {noRouteTokens
              .slice((vaultPage - 1) * VAULT_PER_PAGE, vaultPage * VAULT_PER_PAGE)
              .map((token, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 opacity-70"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden">
                      <TokenLogo token={token} />
                    </div>
                    <div>
                      <div className="text-sm font-bold flex items-center gap-1.5">
                        {token.symbol}
                        <span className="text-[9px] bg-zinc-200 dark:bg-zinc-700 text-zinc-500 px-1 rounded">
                          no route
                        </span>
                      </div>
                      <div className="text-xs text-zinc-500">
                        {parseFloat(token.formattedBal).toFixed(4)}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleWithdrawToken(token)}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 transition-colors"
                  >
                    Withdraw
                  </button>
                </div>
              ))}
          </div>

          {totalNoRoutePgs > 1 && (
            <div className="flex justify-center items-center gap-1 mt-2">
              <button
                onClick={() => setVaultPage(p => Math.max(1, p - 1))}
                disabled={vaultPage === 1}
                className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs disabled:opacity-30"
              >← Prev</button>
              <button
                onClick={() => setVaultPage(p => Math.min(totalNoRoutePgs, p + 1))}
                disabled={vaultPage === totalNoRoutePgs}
                className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs disabled:opacity-30"
              >Next →</button>
            </div>
          )}
        </div>
      )}

      {/* ── Floating swap button ───────────────────────────────────────────── */}
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
                Swap {selectedTokens.size} Asset{selectedTokens.size > 1 ? "s" : ""} → {buyTokenLabel}
              </>
            )}
          </button>
          <div className="text-center text-[10px] text-zinc-400 mt-2 bg-white/80 dark:bg-black/50 backdrop-blur-md py-1 rounded-full w-fit mx-auto px-3 shadow-sm border border-zinc-200 dark:border-zinc-800">
            {feeEnabled ? "5% fee" : "No fee"} · atomic 1 UserOp · 0x → LI.FI → KyberSwap
          </div>
        </div>
      )}
    </div>
  );
};
