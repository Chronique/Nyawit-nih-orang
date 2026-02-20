"use client";

// src/components/dust/deposit-view.tsx

import { useEffect, useState, useCallback } from "react";
import { useWalletClient, useAccount, useSwitchChain } from "wagmi";
import {
  getSmartAccountClient,
  deriveVaultAddress,
  isVaultDeployed,
  publicClient,
  publicClientSepolia,
  isSupportedChain,
  getChainLabel,
} from "~/lib/smart-account";
import { alchemy } from "~/lib/alchemy";
import { formatUnits, formatEther, erc20Abi, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import { Rocket, Check, Copy, Refresh } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";

const USDC_MAINNET  = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_SEPOLIA  = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const getUsdcAddress = (chainId: number) =>
  chainId === baseSepolia.id ? USDC_SEPOLIA : USDC_MAINNET;

const TokenLogo = ({ token }: { token: any }) => {
  const [src, setSrc] = useState<string | null>(token.logo || null);
  return (
    <img
      src={src || `https://tokens.1inch.io/${token.contractAddress}.png`}
      className="w-8 h-8 rounded-full object-cover"
      onError={() => setSrc(null)}
    />
  );
};

export const DustDepositView = () => {
  const { data: walletClient } = useWalletClient();
  const { address: ownerAddress, chainId = baseSepolia.id } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const [vaultAddress, setVaultAddress] = useState<Address | null>(null);
  const [isDeployed, setIsDeployed] = useState(false);
  const [ethBalance, setEthBalance] = useState("0");
  const [usdcBalance, setUsdcBalance] = useState("0");
  const [dustTokens, setDustTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Pilih publicClient yang sesuai dengan chain aktif
  const activeClient = chainId === baseSepolia.id ? publicClientSepolia : publicClient;
  const usdcAddress = getUsdcAddress(chainId);

  // ── 1. Derive vault address sesuai chain aktif ───────────────────────────
  useEffect(() => {
    if (!ownerAddress) return;
    deriveVaultAddress(ownerAddress as Address, "eip5792", chainId).then((addr) => {
      console.log(`[DepositView] Vault address (chain ${chainId}):`, addr);
      setVaultAddress(addr);
    });
  }, [ownerAddress, chainId]);

  // ── 2. Fetch vault data ──────────────────────────────────────────────────
  const fetchVaultData = useCallback(async () => {
    if (!vaultAddress) return;
    setLoading(true);
    try {
      const [deployed, ethBal] = await Promise.all([
        isVaultDeployed(vaultAddress, chainId),
        activeClient.getBalance({ address: vaultAddress }),
      ]);

      setIsDeployed(deployed);
      setEthBalance(formatEther(ethBal));

      const balances = await alchemy.core.getTokenBalances(vaultAddress);
      const nonZero = balances.tokenBalances.filter(
        (t: any) => t.tokenBalance && BigInt(t.tokenBalance) > 0n
      );
      const metadata = await Promise.all(
        nonZero.map((t: any) => alchemy.core.getTokenMetadata(t.contractAddress))
      );
      const formatted = nonZero.map((t: any, i: number) => ({
        contractAddress: t.contractAddress,
        symbol: metadata[i].symbol || "???",
        logo: metadata[i].logo,
        decimals: metadata[i].decimals || 18,
        formattedBal: formatUnits(BigInt(t.tokenBalance || 0), metadata[i].decimals || 18),
      }));

      const usdc = formatted.find(
        (t: any) => t.contractAddress.toLowerCase() === usdcAddress.toLowerCase()
      );
      setUsdcBalance(usdc ? parseFloat(usdc.formattedBal).toFixed(2) : "0");
      setDustTokens(formatted.filter(
        (t: any) => t.contractAddress.toLowerCase() !== usdcAddress.toLowerCase()
      ));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [vaultAddress, chainId]);

  useEffect(() => { fetchVaultData(); }, [fetchVaultData]);

  // ── 3. Aktivasi vault ────────────────────────────────────────────────────
  const handleActivate = async () => {
    if (!walletClient || !vaultAddress) return;

    // Cek chain dulu
    if (!isSupportedChain(chainId)) {
      setToast({ msg: "Switch ke Base atau Base Sepolia dulu.", type: "error" });
      return;
    }

    const ethBal = await activeClient.getBalance({ address: vaultAddress });
    if (ethBal === 0n) {
      setToast({
        msg: "Isi ETH ke Vault dulu untuk bayar gas aktivasi. Minimal ~0.001 ETH.",
        type: "error",
      });
      return;
    }

    try {
      setActivating(true);
      const client = await getSmartAccountClient(walletClient);

      const txHash = await client.sendUserOperation({
        calls: [{ to: vaultAddress, value: 0n, data: "0x" }],
      });

      console.log("[Activate] UserOp hash:", txHash);
      setToast({ msg: "Activation sent! Menunggu konfirmasi...", type: "success" });

      await client.waitForUserOperationReceipt({ hash: txHash });
      setIsDeployed(true);
      setToast({ msg: "Smart Wallet aktif! 🎉", type: "success" });
      await fetchVaultData();
    } catch (e: any) {
      console.error("[Activate] Error:", e);
      const msg = e?.shortMessage || e?.message || "Unknown error";
      if (msg.includes("User rejected") || msg.includes("user denied")) {
        setToast({ msg: "Dibatalkan oleh user.", type: "error" });
      } else if (msg.includes("insufficient funds") || msg.includes("AA21")) {
        setToast({ msg: "ETH di Vault tidak cukup untuk gas. Top up dulu.", type: "error" });
      } else {
        setToast({ msg: "Activation error: " + msg, type: "error" });
      }
    } finally {
      setActivating(false);
    }
  };

  const isTestnet = chainId === baseSepolia.id;

  return (
    <div className="space-y-4">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      {/* ── CHAIN BADGE ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-1">
        <div className={`text-[10px] font-bold px-2 py-1 rounded-full border ${
          isTestnet
            ? "text-yellow-400 border-yellow-500/40 bg-yellow-500/10"
            : "text-blue-400 border-blue-500/40 bg-blue-500/10"
        }`}>
          {getChainLabel(chainId)}
        </div>
        {!isSupportedChain(chainId) && (
          <div className="text-[10px] text-red-400">
            ⚠ Chain tidak didukung. Switch ke Base atau Base Sepolia.
          </div>
        )}
      </div>

      {/* ── VAULT ADDRESS CARD ───────────────────────────────────────────── */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Smart Vault Address</span>
          <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full border ${
            isDeployed
              ? "text-green-400 border-green-500/40 bg-green-500/10"
              : "text-orange-400 border-orange-500/40 bg-orange-500/10"
          }`}>
            {isDeployed ? <Check className="w-3 h-3" /> : <Rocket className="w-3 h-3" />}
            {isDeployed ? "Active" : "Inactive"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <code className="text-sm font-mono flex-1 truncate text-zinc-700 dark:text-zinc-300">
            {vaultAddress
              ? `${vaultAddress.slice(0, 10)}...${vaultAddress.slice(-8)}`
              : "Deriving address..."}
          </code>
          <button
            onClick={() => vaultAddress && navigator.clipboard.writeText(vaultAddress)}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"
          >
            <Copy className="w-4 h-4" />
          </button>
          <button
            onClick={fetchVaultData}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"
          >
            <Refresh className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-3">
            <div className="text-[10px] text-zinc-500 mb-0.5">ETH (Gas)</div>
            <div className="text-base font-bold">{parseFloat(ethBalance).toFixed(5)}</div>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
            <div className="text-[10px] text-blue-400 mb-0.5">USDC</div>
            <div className="text-base font-bold text-blue-600 dark:text-blue-300">{usdcBalance}</div>
          </div>
        </div>

        {dustTokens.length > 0 && (
          <div className="text-xs text-zinc-400 text-center">
            {dustTokens.length} dust token{dustTokens.length > 1 ? "s" : ""} di vault
          </div>
        )}
      </div>

      {/* ── ACTIVATION SECTION ──────────────────────────────────────────── */}
      {!isDeployed && (
        <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-orange-300">Smart Wallet belum aktif.</p>
            <p className="text-xs text-zinc-400">
              Aktivasi diperlukan sebelum bisa menerima UserOp dan swap dust.
              Deposit sedikit ETH ke alamat vault di atas untuk membayar gas.
            </p>
          </div>

          {parseFloat(ethBalance) === 0 ? (
            <div className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
              ⚠ Kirim minimal <strong>0.001 ETH</strong> ke alamat vault di atas, lalu klik Aktivasi.
            </div>
          ) : (
            <div className="text-xs text-green-400 bg-green-400/10 border border-green-400/20 rounded-lg px-3 py-2">
              ✓ ETH tersedia ({parseFloat(ethBalance).toFixed(5)} ETH). Siap aktivasi.
            </div>
          )}

          <button
            onClick={handleActivate}
            disabled={activating || parseFloat(ethBalance) === 0 || !isSupportedChain(chainId)}
            className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors
              bg-orange-500 hover:bg-orange-400 text-white
              disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            {activating ? (
              <><Refresh className="w-4 h-4 animate-spin" />Deploying Wallet...</>
            ) : (
              <><Rocket className="w-4 h-4" />Activate Smart Wallet</>
            )}
          </button>
          <p className="text-[10px] text-zinc-500 text-center">
            Deploy via EIP-4337 · Gas dibayar dari ETH vault · {getChainLabel(chainId)}
          </p>
        </div>
      )}

      {/* ── ACTIVE STATE ────────────────────────────────────────────────── */}
      {isDeployed && (
        <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-4 space-y-2">
          <p className="text-sm font-semibold text-green-400 flex items-center gap-2">
            <Check className="w-4 h-4" /> Smart Wallet Aktif
          </p>
          <p className="text-xs text-zinc-400">
            Kirim token dust ke alamat vault di atas, lalu swap dari tab Swap.
          </p>
        </div>
      )}

      {/* ── DUST TOKENS IN VAULT ────────────────────────────────────────── */}
      {dustTokens.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide px-1">
            Token di Vault
          </div>
          {dustTokens.map((token, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900"
            >
              <div className="flex items-center gap-3">
                <TokenLogo token={token} />
                <div>
                  <div className="text-sm font-semibold">{token.symbol}</div>
                  <div className="text-xs text-zinc-500">{parseFloat(token.formattedBal).toFixed(4)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
