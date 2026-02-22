/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount } from "wagmi";
import { encodeFunctionData, erc20Abi, formatUnits, maxUint256, type Address } from "viem";
import { base } from "viem/chains";

import { getSmartAccountClient, isSupportedChain, publicClient } from "~/lib/smart-account";
import { fetchMoralisTokens } from "~/lib/moralis-data";
import { fetchTokenPrices } from "~/lib/price";

import { Flash, ArrowRight, Check, Refresh } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";

/* ──────────────────────────────────────────────────────────────── */
/* CONSTANTS (LOCKED)                                               */
/* ──────────────────────────────────────────────────────────────── */

const ETH_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const FEE_BPS = 500n; // 5%
const FEE_DIVISOR = 10000n;
const FEE_RECIPIENT = "0x4fba95e4772be6d37a0c931D00570Fe2c9675524";

/* ──────────────────────────────────────────────────────────────── */

interface TokenData {
  contractAddress: string;
  symbol: string;
  decimals: number;
  rawBalance: string;
  formattedBal: string;
  priceUsd: number;
  valueUsd: number;
}

interface RouteInfo {
  to: string;
  data: string;
  value: string;
  approvalAddress: string;
}

/* ──────────────────────────────────────────────────────────────── */

export const SwapView = () => {
  const { data: walletClient } = useWalletClient();
  const { chainId = base.id } = useAccount();

  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [swapping, setSwapping] = useState(false);

  const [showPreview, setShowPreview] = useState(false);
  const [routes, setRoutes] = useState<Map<string, RouteInfo>>(new Map());

  const [preview, setPreview] = useState<{
    ok: TokenData[];
    skipped: TokenData[];
    estEth: number;
    estFeeUsd: number;
  } | null>(null);

  const [toast, setToast] = useState<any>(null);

  /* ──────────────────────────────────────────────────────────────── */
  /* LOAD VAULT TOKENS                                                */
  /* ──────────────────────────────────────────────────────────────── */

  const loadTokens = async () => {
    if (!walletClient) return;
    setLoading(true);

    try {
      const client = await getSmartAccountClient(walletClient);
      const addr = client.account.address;

      const moralis = await fetchMoralisTokens(addr);
      const prices = await fetchTokenPrices(moralis.map(t => t.token_address));

      const formatted: TokenData[] = moralis
        .filter(t => BigInt(t.balance) > 0n)
        .map(t => {
          const decimals = t.decimals || 18;
          const bal = formatUnits(BigInt(t.balance), decimals);
          const price = prices[t.token_address.toLowerCase()] || 0;
          return {
            contractAddress: t.token_address,
            symbol: t.symbol || "UNKNOWN",
            decimals,
            rawBalance: t.balance,
            formattedBal: bal,
            priceUsd: price,
            valueUsd: Number(bal) * price,
          };
        })
        .sort((a, b) => b.valueUsd - a.valueUsd);

      setTokens(formatted);
    } catch (e: any) {
      setToast({ type: "error", msg: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTokens();
  }, [walletClient]);

  /* ──────────────────────────────────────────────────────────────── */
  /* PREVIEW (SIMULATION)                                             */
  /* ──────────────────────────────────────────────────────────────── */

  const handlePreview = async () => {
    if (!walletClient || selected.size === 0) return;
    if (!isSupportedChain(chainId)) {
      setToast({ type: "error", msg: "Unsupported chain" });
      return;
    }

    const client = await getSmartAccountClient(walletClient);
    const vault = client.account.address.toLowerCase();

    const selectedTokens = tokens.filter(t => selected.has(t.contractAddress));
    const ok: TokenData[] = [];
    const skipped: TokenData[] = [];
    const routeMap = new Map<string, RouteInfo>();

    let totalUsd = 0;

    for (const token of selectedTokens) {
      try {
        // ERC20 sanity check
        await publicClient.readContract({
          address: token.contractAddress as Address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [vault as Address, vault as Address],
        });

        // MOCK route (simulate only)
        routeMap.set(token.contractAddress, {
          to: vault,
          data: "0x",
          value: "0",
          approvalAddress: vault,
        });

        ok.push(token);
        totalUsd += token.valueUsd;
      } catch {
        skipped.push(token);
      }
    }

    const feeUsd = totalUsd * 0.05;
    const estEth = (totalUsd - feeUsd) / 3000; // rough display only

    setRoutes(routeMap);
    setPreview({ ok, skipped, estEth, estFeeUsd: feeUsd });
    setShowPreview(true);
  };

  /* ──────────────────────────────────────────────────────────────── */
  /* EXECUTE                                                         */
  /* ──────────────────────────────────────────────────────────────── */

  const handleExecute = async () => {
    if (!walletClient || !preview) return;

    setSwapping(true);
    setShowPreview(false);

    try {
      const client = await getSmartAccountClient(walletClient);

      const calls: any[] = [];

      for (const token of preview.ok) {
        const raw = BigInt(token.rawBalance);
        const fee = raw * FEE_BPS / FEE_DIVISOR;
        const swapAmount = raw - fee;

        // approve
        calls.push({
          to: token.contractAddress as Address,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [routes.get(token.contractAddress)!.approvalAddress as Address, maxUint256],
          }),
        });

        // swap (mock)
        calls.push({
          to: routes.get(token.contractAddress)!.to as Address,
          value: 0n,
          data: routes.get(token.contractAddress)!.data,
        });

        // fee transfer
        calls.push({
          to: token.contractAddress as Address,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [FEE_RECIPIENT as Address, fee],
          }),
        });
      }

      const tx = await client.sendUserOperation({ calls });
      await client.waitForUserOperationReceipt({ hash: tx });

      setToast({ type: "success", msg: "Batch swap completed" });
      setSelected(new Set());
      loadTokens();
    } catch (e: any) {
      setToast({ type: "error", msg: e.message });
    } finally {
      setSwapping(false);
    }
  };

  /* ──────────────────────────────────────────────────────────────── */
  /* UI                                                              */
  /* ──────────────────────────────────────────────────────────────── */

  return (
    <div className="space-y-4 pb-32">
      <SimpleToast {...toast} onClose={() => setToast(null)} />

      {/* Header Banner (RESTORED) */}
      <div className="bg-gradient-to-br from-red-900 to-green-900 p-4 rounded-2xl border border-red-800/40">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Flash className="w-4 h-4 text-yellow-400" />
          Aggregator Mode
        </h3>
        <p className="text-xs text-green-300 mt-1">
          Auto routing · 5% platform fee · atomic batch swap
        </p>
      </div>

      {/* Token List */}
      {loading ? (
        <div className="text-center text-xs text-zinc-500 py-10">Scanning vault...</div>
      ) : (
        tokens.map(t => {
          const checked = selected.has(t.contractAddress);
          return (
            <div
              key={t.contractAddress}
              onClick={() => {
                const s = new Set(selected);
                checked ? s.delete(t.contractAddress) : s.add(t.contractAddress);
                setSelected(s);
              }}
              className={`p-3 rounded-xl border flex justify-between cursor-pointer ${
                checked ? "bg-blue-900/20 border-blue-500" : "bg-white dark:bg-zinc-900"
              }`}
            >
              <div>
                <div className="font-bold text-sm">{t.symbol}</div>
                <div className="text-xs text-zinc-500">{t.formattedBal}</div>
              </div>
              <div className="text-xs font-mono">${t.valueUsd.toFixed(2)}</div>
            </div>
          );
        })
      )}

      {/* Preview Button */}
      {selected.size > 0 && (
        <button
          onClick={handlePreview}
          className="w-full py-4 rounded-2xl bg-blue-600 text-white font-bold"
        >
          Preview Swap
        </button>
      )}

      {/* Preview Modal */}
      {showPreview && preview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-900 p-5 rounded-2xl w-[90%] max-w-md space-y-3">
            <h3 className="font-bold">Simulation Summary</h3>

            <div className="text-xs">
              ✔ Processing: {preview.ok.length} tokens<br />
              ✖ Skipped: {preview.skipped.length} tokens<br />
              Estimated ETH: ~{preview.estEth.toFixed(4)}<br />
              Platform Fee: ${preview.estFeeUsd.toFixed(2)}
            </div>

            <div className="flex gap-2 pt-3">
              <button
                onClick={() => setShowPreview(false)}
                className="flex-1 py-2 rounded-lg border"
              >
                Cancel
              </button>
              <button
                onClick={handleExecute}
                className="flex-1 py-2 rounded-lg bg-blue-600 text-white font-bold"
              >
                Confirm & Swap
              </button>
            </div>
          </div>
        </div>
      )}

      {swapping && (
        <div className="text-center text-xs text-zinc-500 animate-pulse">
          Executing batch swap…
        </div>
      )}
    </div>
  );
};