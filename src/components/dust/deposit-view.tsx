"use client";

import { useEffect, useState, useCallback } from "react";
import { useWalletClient, useAccount, useSwitchChain, useWaitForTransactionReceipt } from "wagmi";
import {
  getSmartAccountClient,
  deriveVaultAddress,
  isVaultDeployed,
  deployVault,
  publicClient,
  publicClientSepolia,
  ACTIVE_CHAIN,
  IS_TESTNET,
} from "~/lib/smart-account";
import { baseSepolia } from "viem/chains";
import { alchemy } from "~/lib/alchemy";
import { formatUnits, formatEther, type Address } from "viem";
import { Rocket, Check, Copy, Refresh } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";

const USDC_ADDRESS = IS_TESTNET
  ? "0x036CbD53842c5426634e7929541eC2318f3dCF7e" // USDC Base Sepolia
  : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC Base mainnet

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
  const { address: ownerAddress, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const [vaultAddress, setVaultAddress] = useState<Address | null>(null);
  const [isDeployed, setIsDeployed] = useState(false);
  const [ethBalance, setEthBalance] = useState("0");
  const [usdcBalance, setUsdcBalance] = useState("0");
  const [dustTokens, setDustTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState(false);
  const [deployTxHash, setDeployTxHash] = useState<`0x${string}` | undefined>();
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Watch deploy tx confirmation
  const { isSuccess: deployConfirmed } = useWaitForTransactionReceipt({
    hash: deployTxHash,
  });

  // Auto-refresh setelah deploy confirmed
  useEffect(() => {
    if (deployConfirmed) {
      setIsDeployed(true);
      setActivating(false);
      setToast({ msg: "Smart Wallet activated! 🎉", type: "success" });
      fetchVaultData();
    }
  }, [deployConfirmed]);

  // Derive vault address
  useEffect(() => {
    if (!ownerAddress) return;
    deriveVaultAddress(ownerAddress as Address, 0n, chainId).then((addr) => {
      console.log("[DepositView] Vault address:", addr);
      setVaultAddress(addr);
    });
  }, [ownerAddress]);

  const fetchVaultData = useCallback(async () => {
    if (!vaultAddress) return;
    setLoading(true);
    try {
      // Pakai client sesuai chain — fix ETH balance salah chain
      const activeClient = chainId === baseSepolia.id ? publicClientSepolia : publicClient;
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
        (t: any) => t.contractAddress.toLowerCase() === USDC_ADDRESS.toLowerCase()
      );
      setUsdcBalance(usdc ? parseFloat(usdc.formattedBal).toFixed(2) : "0");
      setDustTokens(formatted.filter(
        (t: any) => t.contractAddress.toLowerCase() !== USDC_ADDRESS.toLowerCase()
      ));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [vaultAddress]);

  useEffect(() => { fetchVaultData(); }, [fetchVaultData]);

  // Aktivasi: EOA deploy vault langsung, bayar gas dari EOA
  // TIDAK perlu deposit ETH ke vault dulu
  const handleActivate = async () => {
    if (!walletClient) return;
    try {
      if (chainId !== ACTIVE_CHAIN.id) {
        await switchChainAsync({ chainId: ACTIVE_CHAIN.id });
      }
      setActivating(true);
      setToast({ msg: "Confirm transaction in your wallet...", type: "success" });

      // EOA memanggil factory.createAccount() langsung
      // Gas dari EOA, bukan dari vault
      const txHash = await deployVault(walletClient);
      setDeployTxHash(txHash);
      setToast({ msg: "Activation sent! Waiting for confirmation...", type: "success" });
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown error";
      if (msg.includes("User rejected") || msg.includes("user denied")) {
        setToast({ msg: "Cancelled by user.", type: "error" });
      } else {
        setToast({ msg: "Activation error: " + msg, type: "error" });
      }
      setActivating(false);
    }
  };

  return (
    <div className="space-y-4">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      {IS_TESTNET && (
        <div className="text-[10px] text-center text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-1.5">
          ⚠ Testnet Mode — Base Sepolia
        </div>
      )}

      {/* VAULT ADDRESS CARD */}
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
            <div className="text-[10px] text-zinc-500 mb-0.5">ETH Balance</div>
            <div className="text-base font-bold">{parseFloat(ethBalance).toFixed(5)}</div>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
            <div className="text-[10px] text-blue-400 mb-0.5">USDC</div>
            <div className="text-base font-bold text-blue-600 dark:text-blue-300">{usdcBalance}</div>
          </div>
        </div>

        {dustTokens.length > 0 && (
          <div className="text-xs text-zinc-400 text-center">
            {dustTokens.length} dust token{dustTokens.length > 1 ? "s" : ""} in vault
          </div>
        )}
      </div>

      {/* ACTIVATION SECTION */}
      {!isDeployed && (
        <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-orange-300">Smart Wallet not yet active.</p>
            <p className="text-xs text-zinc-400">
              Activate your Smart Vault to enable batch swaps and token management.
              Gas fee is paid from your connected wallet — no deposit required.
            </p>
          </div>

          <div className="text-xs text-blue-300 bg-blue-400/10 border border-blue-400/20 rounded-lg px-3 py-2">
            ℹ Gas will be charged from your wallet ({ownerAddress?.slice(0, 6)}...{ownerAddress?.slice(-4)})
          </div>

          <button
            onClick={handleActivate}
            disabled={activating}
            className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors
              bg-orange-500 hover:bg-orange-400 text-white
              disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            {activating ? (
              <><Refresh className="w-4 h-4 animate-spin" /> Deploying Vault...</>
            ) : (
              <><Rocket className="w-4 h-4" /> Activate Smart Wallet</>
            )}
          </button>
          <p className="text-[10px] text-zinc-500 text-center">
            One-time setup · Gas paid from your EOA wallet
          </p>
        </div>
      )}

      {/* ACTIVE STATE */}
      {isDeployed && (
        <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-4 space-y-2">
          <p className="text-sm font-semibold text-green-400 flex items-center gap-2">
            <Check className="w-4 h-4" /> Smart Wallet Active
          </p>
          <p className="text-xs text-zinc-400">
            Send dust tokens to the vault address above.
            Once received, batch swap everything from the Swap tab.
          </p>
        </div>
      )}

      {/* DUST TOKENS IN VAULT */}
      {dustTokens.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide px-1">
            Tokens in Vault
          </div>
          {dustTokens.map((token, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900">
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
