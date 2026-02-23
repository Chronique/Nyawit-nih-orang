"use client";

import { useEffect, useState, useCallback } from "react";
import { useWalletClient, useAccount, useSwitchChain } from "wagmi";
import { getSmartAccountClient, publicClient } from "~/lib/smart-account";
import { detectVaultAddress } from "~/lib/smart-account";
import { formatUnits, encodeFunctionData, erc20Abi, type Address, parseEther } from "viem";
import { base } from "viem/chains";
import { Sprout, RefreshCw, ArrowRight, TrendingUp, Wallet, Zap, ArrowUpDown } from "lucide-react";
import { SimpleToast } from "~/components/ui/simple-toast";
import { fetchMoralisTokens } from "~/lib/moralis-data";

// ── Constants ─────────────────────────────────────────────────────────────────
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006" as Address;
const ETH_NATIVE   = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const LIFI_API_URL = "https://li.quest/v1";
const LIFI_API_KEY = process.env.NEXT_PUBLIC_LIFI_API_KEY || "";

// ── WETH ABI ──────────────────────────────────────────────────────────────────
const WETH_ABI = [
  {
    name: "deposit", type: "function", stateMutability: "payable",
    inputs: [], outputs: [],
  },
  {
    name: "withdraw", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "wad", type: "uint256" }], outputs: [],
  },
  {
    name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ── Morpho MetaMorpho Vaults on Base ──────────────────────────────────────────
const MORPHO_VAULTS = [
  {
    id:           "gauntlet-usdc",
    name:         "Gauntlet USDC Core",
    asset:        "USDC",
    assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
    vaultAddress: "0xc0c5689e6f4D256E861F65465b691aeEcC0dEb12" as Address,
    decimals:     6,
    color:        "blue",
    description:  "USDC lending via Morpho Blue. Curated by Gauntlet.",
    morphoUrl:    "https://app.morpho.org/base/vault/0xc0c5689e6f4D256E861F65465b691aeEcC0dEb12/gauntlet-usdc-core",
  },
  {
    id:           "gauntlet-weth",
    name:         "Gauntlet WETH Core",
    asset:        "WETH",
    assetAddress: "0x4200000000000000000000000000000000000006" as Address,
    vaultAddress: "0x6b13c060F13Af1fdB319F52315BbbF3fb1D88844" as Address,
    decimals:     18,
    color:        "indigo",
    description:  "WETH lending via Morpho Blue. Curated by Gauntlet.",
    morphoUrl:    "https://app.morpho.org/base/vault/0x6b13c060F13Af1fdB319F52315BbbF3fb1D88844/gauntlet-weth-core",
  },
] as const;

const ERC4626_ABI = [
  {
    name: "deposit", type: "function", stateMutability: "nonpayable",
    inputs:  [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    name: "redeem", type: "function", stateMutability: "nonpayable",
    inputs:  [{ name: "shares", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    name: "balanceOf", type: "function", stateMutability: "view",
    inputs:  [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "convertToAssets", type: "function", stateMutability: "view",
    inputs:  [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
] as const;

const MORPHO_API = "https://blue-api.morpho.org/graphql";

interface VaultPosition {
  vaultId:     string;
  shares:      bigint;
  assetsValue: bigint;
}
interface VaultApy {
  vaultId:     string;
  apy:         number | null;
  totalAssets: string;
}
interface LifiQuote {
  transactionRequest: { to: string; data: string; value: string };
  estimate:           { approvalAddress: string; toAmount: string };
}

const colorMap = {
  blue:   { bg: "bg-blue-50 dark:bg-blue-900/20",    border: "border-blue-200 dark:border-blue-800",    text: "text-blue-600 dark:text-blue-300",    badge: "bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-200"    },
  indigo: { bg: "bg-indigo-50 dark:bg-indigo-900/20", border: "border-indigo-200 dark:border-indigo-800", text: "text-indigo-600 dark:text-indigo-300", badge: "bg-indigo-100 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-200" },
};

async function getLifiEthQuote(
  ethAmount: string,
  toToken:   string,
  fromAddress: string,
  chainId:   number,
): Promise<LifiQuote> {
  const params = new URLSearchParams({
    fromChain:     String(chainId),
    toChain:       String(chainId),
    fromToken:     ETH_NATIVE,
    toToken,
    fromAmount:    ethAmount,
    fromAddress,
    toAddress:     fromAddress,
    slippage:      "0.03",
    denyExchanges: "paraswap",
  });
  const headers: Record<string, string> = { Accept: "application/json" };
  if (LIFI_API_KEY) headers["x-lifi-api-key"] = LIFI_API_KEY;

  const res = await fetch(`${LIFI_API_URL}/quote?${params}`, { headers });
  if (!res.ok) throw new Error(`LI.FI ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();

  if ((data?.estimate?.approvalAddress || "").toLowerCase() === "0x000000000022d473030f116ddee9f6b43ac78ba3") {
    throw new Error("LI.FI: permit2 route not supported in vault");
  }
  return data as LifiQuote;
}

export const TanamView = () => {
  const { data: walletClient }              = useWalletClient();
  const { address: ownerAddress, chainId } = useAccount();
  const { switchChainAsync }               = useSwitchChain();

  const [vaultAddress, setVaultAddress]   = useState<Address | null>(null);
  const [positions, setPositions]         = useState<VaultPosition[]>([]);
  const [apyData, setApyData]             = useState<VaultApy[]>([]);
  const [vaultBalances, setVaultBalances] = useState<Record<string, string>>({});
  const [ethBalance, setEthBalance]       = useState<bigint>(0n);
  const [wethBalance, setWethBalance]     = useState<bigint>(0n);
  const [loading, setLoading]             = useState(false);
  const [depositing, setDepositing]       = useState<string | null>(null);
  const [withdrawing, setWithdrawing]     = useState<string | null>(null);
  const [swapping, setSwapping]           = useState<string | null>(null);
  const [swapProgress, setSwapProgress]   = useState("");
  const [wrapping, setWrapping]           = useState(false);
  const [unwrapping, setUnwrapping]       = useState(false);
  const [wethAction, setWethAction]       = useState("");
  const [toast, setToast]                 = useState<{ msg: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!ownerAddress) return;
    detectVaultAddress(ownerAddress as Address).then(({ address }) => setVaultAddress(address));
  }, [ownerAddress]);

  const fetchApyData = useCallback(async () => {
    try {
      const query = `{
        vaults(where: { chainId_in: [8453] }, first: 20) {
          items { address state { apy totalAssets } }
        }
      }`;
      const res = await fetch(MORPHO_API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) return;
      const json  = await res.json();
      const items = json?.data?.vaults?.items || [];
      setApyData(MORPHO_VAULTS.map(vault => {
        const found = items.find((i: any) => i.address?.toLowerCase() === vault.vaultAddress.toLowerCase());
        return {
          vaultId:     vault.id,
          apy:         found?.state?.apy ? parseFloat(found.state.apy) * 100 : null,
          totalAssets: found?.state?.totalAssets || "0",
        };
      }));
    } catch (e) {
      console.warn("[TanamView] APY fetch failed:", e);
    }
  }, []);

  const fetchPositions = useCallback(async () => {
    if (!vaultAddress) return;
    setLoading(true);
    try {
      const [posResults, tokenData, ethBal, wethBal] = await Promise.all([
        Promise.all(MORPHO_VAULTS.map(async vault => {
          try {
            const shares = await publicClient.readContract({
              address: vault.vaultAddress, abi: ERC4626_ABI, functionName: "balanceOf", args: [vaultAddress],
            });
            const assetsValue = shares > 0n
              ? await publicClient.readContract({
                  address: vault.vaultAddress, abi: ERC4626_ABI, functionName: "convertToAssets", args: [shares],
                })
              : 0n;
            return { vaultId: vault.id, shares, assetsValue } as VaultPosition;
          } catch {
            return { vaultId: vault.id, shares: 0n, assetsValue: 0n } as VaultPosition;
          }
        })),
        fetchMoralisTokens(vaultAddress),
        publicClient.getBalance({ address: vaultAddress }),
        // Read WETH balance directly from contract
        publicClient.readContract({
          address: WETH_ADDRESS, abi: WETH_ABI, functionName: "balanceOf", args: [vaultAddress],
        }).catch(() => 0n),
      ]);

      setPositions(posResults);
      setEthBalance(ethBal);
      setWethBalance(wethBal as bigint);

      const balMap: Record<string, string> = {};
      for (const vault of MORPHO_VAULTS) {
        const found = tokenData.find(t => t.token_address.toLowerCase() === vault.assetAddress.toLowerCase());
        balMap[vault.id] = found ? found.balance : "0";
      }
      setVaultBalances(balMap);
    } catch (e) {
      console.error("[TanamView] fetchPositions error:", e);
    } finally {
      setLoading(false);
    }
  }, [vaultAddress]);

  useEffect(() => {
    fetchPositions();
    fetchApyData();
  }, [fetchPositions, fetchApyData]);

  // ── Wrap ETH → WETH ───────────────────────────────────────────────────────
  // WETH.deposit() — send ETH value, receive WETH 1:1, no slippage
  const handleWrap = async () => {
    if (!walletClient || !vaultAddress || ethBalance === 0n) return;

    // Keep small ETH reserve for gas (0.0005 ETH = 500000000000000 wei)
    const GAS_RESERVE = 500000000000000n;
    const wrapAmount = ethBalance > GAS_RESERVE ? ethBalance - GAS_RESERVE : 0n;
    if (wrapAmount === 0n) {
      setToast({ msg: "Not enough ETH to wrap (keeping reserve for gas).", type: "error" });
      return;
    }

    const display = parseFloat(formatUnits(wrapAmount, 18)).toFixed(6);
    if (!window.confirm(`Wrap ${display} ETH → WETH?\n(0.0005 ETH kept as gas reserve)`)) return;

    setWrapping(true);
    setWethAction(`Wrapping ${display} ETH → WETH...`);
    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      const client = await getSmartAccountClient(walletClient);

      // Call WETH.deposit() with ETH value
      const wrapData = encodeFunctionData({ abi: WETH_ABI, functionName: "deposit", args: [] });
      const txHash = await client.sendUserOperation({
        calls: [{ to: WETH_ADDRESS, value: wrapAmount, data: wrapData }],
      });
      await client.waitForUserOperationReceipt({ hash: txHash });

      setToast({ msg: `✓ Wrapped ${display} ETH → WETH!`, type: "success" });
      await new Promise(r => setTimeout(r, 2000));
      await fetchPositions();
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown";
      setToast({
        msg: msg.includes("rejected") || msg.includes("denied") ? "Cancelled." : "Wrap failed: " + msg,
        type: "error",
      });
    } finally {
      setWrapping(false);
      setWethAction("");
    }
  };

  // ── Unwrap WETH → ETH ─────────────────────────────────────────────────────
  // WETH.withdraw(amount) — burn WETH, receive ETH 1:1
  const handleUnwrap = async () => {
    if (!walletClient || !vaultAddress || wethBalance === 0n) return;

    const display = parseFloat(formatUnits(wethBalance, 18)).toFixed(6);
    if (!window.confirm(`Unwrap ${display} WETH → ETH?\n\nETH will be in your Smart Vault (gas reserve).`)) return;

    setUnwrapping(true);
    setWethAction(`Unwrapping ${display} WETH → ETH...`);
    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      const client = await getSmartAccountClient(walletClient);

      const unwrapData = encodeFunctionData({ abi: WETH_ABI, functionName: "withdraw", args: [wethBalance] });
      const txHash = await client.sendUserOperation({
        calls: [{ to: WETH_ADDRESS, value: 0n, data: unwrapData }],
      });
      await client.waitForUserOperationReceipt({ hash: txHash });

      setToast({ msg: `✓ Unwrapped ${display} WETH → ETH!`, type: "success" });
      await new Promise(r => setTimeout(r, 2000));
      await fetchPositions();
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown";
      setToast({
        msg: msg.includes("rejected") || msg.includes("denied") ? "Cancelled." : "Unwrap failed: " + msg,
        type: "error",
      });
    } finally {
      setUnwrapping(false);
      setWethAction("");
    }
  };

  // ── Swap ETH → asset via LI.FI, then deposit ─────────────────────────────
  const handleSwapAndDeposit = async (vault: typeof MORPHO_VAULTS[number]) => {
    if (!walletClient || !vaultAddress || !chainId) return;
    const swapAmount = ethBalance;
    if (swapAmount === 0n) {
      setToast({ msg: "No ETH in vault to swap.", type: "error" });
      return;
    }

    const ethDisplay = parseFloat(formatUnits(swapAmount, 18)).toFixed(6);
    if (!window.confirm(`Swap ${ethDisplay} ETH → ${vault.asset} via LI.FI, then deposit to Morpho?`)) return;

    setSwapping(vault.id);
    setSwapProgress("Getting quote...");
    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      const client = await getSmartAccountClient(walletClient);

      const quote = await getLifiEthQuote(swapAmount.toString(), vault.assetAddress, vaultAddress, chainId);
      const expectedOut = parseFloat(formatUnits(BigInt(quote.estimate.toAmount || "0"), vault.decimals)).toFixed(4);
      console.log(`[Tanam] ETH→${vault.asset} quote: ${ethDisplay} ETH → ~${expectedOut} ${vault.asset}`);

      setSwapProgress(`Swapping ETH → ${vault.asset}...`);
      const swapTx = await client.sendUserOperation({
        calls: [{
          to:    quote.transactionRequest.to as Address,
          value: BigInt(quote.transactionRequest.value || swapAmount.toString()),
          data:  quote.transactionRequest.data as `0x${string}`,
        }],
      });
      await client.waitForUserOperationReceipt({ hash: swapTx });

      setSwapProgress("Reading received balance...");
      const tokenData  = await fetchMoralisTokens(vaultAddress);
      const received   = tokenData.find(t => t.token_address.toLowerCase() === vault.assetAddress.toLowerCase());
      const depositAmt = BigInt(received?.balance || "0");

      if (depositAmt === 0n) {
        setToast({ msg: `Swap done but no ${vault.asset} found — deposit manually.`, type: "error" });
        await fetchPositions();
        return;
      }

      const depositDisplay = parseFloat(formatUnits(depositAmt, vault.decimals)).toFixed(4);

      setSwapProgress(`Approving ${vault.asset} for Morpho...`);
      const approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault.vaultAddress, depositAmt] });
      const approveTx = await client.sendUserOperation({
        calls: [{ to: vault.assetAddress, value: 0n, data: approveData }],
      });
      await client.waitForUserOperationReceipt({ hash: approveTx });

      setSwapProgress(`Depositing ${depositDisplay} ${vault.asset}...`);
      const depositData = encodeFunctionData({ abi: ERC4626_ABI, functionName: "deposit", args: [depositAmt, vaultAddress] });
      const depositTx = await client.sendUserOperation({
        calls: [{ to: vault.vaultAddress, value: 0n, data: depositData }],
      });
      await client.waitForUserOperationReceipt({ hash: depositTx });

      setToast({ msg: `✓ Swapped ETH and deposited ${depositDisplay} ${vault.asset} to Morpho!`, type: "success" });
      await new Promise(r => setTimeout(r, 3000));
      await fetchPositions();
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown";
      setToast({
        msg: msg.includes("rejected") || msg.includes("denied") ? "Cancelled." : "Swap & deposit failed: " + msg,
        type: "error",
      });
    } finally {
      setSwapping(null);
      setSwapProgress("");
    }
  };

  // ── Deposit existing ERC20 balance ────────────────────────────────────────
  const handleDeposit = async (vault: typeof MORPHO_VAULTS[number]) => {
    if (!walletClient || !vaultAddress) return;
    const rawBalance = vaultBalances[vault.id];
    if (!rawBalance || BigInt(rawBalance) === 0n) {
      setToast({ msg: `No ${vault.asset} in vault to deposit.`, type: "error" });
      return;
    }

    const amount  = BigInt(rawBalance);
    const display = parseFloat(formatUnits(amount, vault.decimals)).toFixed(4);
    if (!window.confirm(`Deposit ${display} ${vault.asset} to Morpho ${vault.name}?\n\nFunds will earn yield automatically.`)) return;

    setDepositing(vault.id);
    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      const client = await getSmartAccountClient(walletClient);

      const approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault.vaultAddress, amount] });
      setToast({ msg: `Approving ${vault.asset}...`, type: "success" });
      const approveTx = await client.sendUserOperation({
        calls: [{ to: vault.assetAddress, value: 0n, data: approveData }],
      });
      await client.waitForUserOperationReceipt({ hash: approveTx });

      const depositData = encodeFunctionData({ abi: ERC4626_ABI, functionName: "deposit", args: [amount, vaultAddress] });
      setToast({ msg: `Depositing ${display} ${vault.asset}...`, type: "success" });
      const depositTx = await client.sendUserOperation({
        calls: [{ to: vault.vaultAddress, value: 0n, data: depositData }],
      });
      await client.waitForUserOperationReceipt({ hash: depositTx });
      setToast({ msg: `✓ ${display} ${vault.asset} deposited to Morpho!`, type: "success" });

      await new Promise(r => setTimeout(r, 3000));
      await fetchPositions();
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown";
      setToast({
        msg: msg.includes("rejected") || msg.includes("denied") ? "Cancelled." : "Deposit failed: " + msg,
        type: "error",
      });
    } finally {
      setDepositing(null);
    }
  };

  // ── Withdraw: redeem all shares ───────────────────────────────────────────
  const handleWithdraw = async (vault: typeof MORPHO_VAULTS[number]) => {
    if (!walletClient || !vaultAddress) return;
    const pos = positions.find(p => p.vaultId === vault.id);
    if (!pos || pos.shares === 0n) {
      setToast({ msg: `No ${vault.asset} position in Morpho.`, type: "error" });
      return;
    }

    const display = parseFloat(formatUnits(pos.assetsValue, vault.decimals)).toFixed(4);
    if (!window.confirm(`Withdraw ${display} ${vault.asset} from Morpho?\n\nFunds will return to your Smart Vault.`)) return;

    setWithdrawing(vault.id);
    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      const client = await getSmartAccountClient(walletClient);

      const redeemData = encodeFunctionData({
        abi: ERC4626_ABI, functionName: "redeem", args: [pos.shares, vaultAddress, vaultAddress],
      });
      const txHash = await client.sendUserOperation({
        calls: [{ to: vault.vaultAddress, value: 0n, data: redeemData }],
      });
      setToast({ msg: `Withdrawing ${display} ${vault.asset}...`, type: "success" });
      await client.waitForUserOperationReceipt({ hash: txHash });
      setToast({ msg: `✓ ${display} ${vault.asset} returned to vault!`, type: "success" });

      await new Promise(r => setTimeout(r, 3000));
      await fetchPositions();
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown";
      setToast({
        msg: msg.includes("rejected") || msg.includes("denied") ? "Cancelled." : "Withdraw failed: " + msg,
        type: "error",
      });
    } finally {
      setWithdrawing(null);
    }
  };

  const getApy      = (id: string) => apyData.find(a => a.vaultId === id);
  const getPosition = (id: string) => positions.find(p => p.vaultId === id);
  const isBusy      = (id: string) => depositing === id || withdrawing === id || swapping === id;

  const hasEth      = ethBalance > 100000000000000n; // > 0.0001 ETH
  const hasWeth     = wethBalance > 0n;
  const ethDisplay  = parseFloat(formatUnits(ethBalance, 18)).toFixed(6);
  const wethDisplay = parseFloat(formatUnits(wethBalance, 18)).toFixed(6);
  const wethBusy    = wrapping || unwrapping;

  return (
    <div className="pb-32 space-y-4">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      {/* ── Header ── */}
      <div className="bg-gradient-to-br from-green-900 to-emerald-900 border border-green-700/40 rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sprout className="w-4 h-4 text-green-400" strokeWidth={2.5} />
              Yield — Morpho
            </h3>
            <p className="text-xs text-green-300 mt-1">
              Deposit USDC or WETH from your vault to earn yield on Morpho Blue
            </p>
            <p className="text-[10px] text-green-500 mt-0.5">
              Auto-compounding · Withdraw anytime
            </p>
          </div>
          <button
            onClick={() => { fetchPositions(); fetchApyData(); }}
            disabled={loading}
            className="p-2 rounded-lg bg-green-800/50 hover:bg-green-700/50"
          >
            <RefreshCw className={`w-4 h-4 text-green-300 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {positions.some(p => p.assetsValue > 0n) && (
          <div className="mt-3 pt-3 border-t border-green-700/40">
            <div className="text-[10px] text-green-400 uppercase font-bold mb-1">Active Positions</div>
            <div className="flex gap-3">
              {MORPHO_VAULTS.map(vault => {
                const pos = getPosition(vault.id);
                if (!pos || pos.assetsValue === 0n) return null;
                return (
                  <div key={vault.id} className="text-xs text-white">
                    <span className="text-green-400 font-bold">
                      {parseFloat(formatUnits(pos.assetsValue, vault.decimals)).toFixed(4)}
                    </span>{" "}{vault.asset}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── WETH Wrap / Unwrap Card ── */}
      {(hasEth || hasWeth) && (
        <div className="rounded-2xl border border-violet-700/40 bg-violet-900/20 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-bold text-violet-300">Wrap / Unwrap</span>
            <span className="text-[10px] text-violet-500 ml-auto">ETH ↔ WETH · 1:1 · No slippage</span>
          </div>

          {/* Balances row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-black/20 rounded-xl p-2.5">
              <div className="text-[10px] text-zinc-500 mb-0.5">ETH in Vault</div>
              <div className={`text-sm font-bold font-mono ${hasEth ? "text-white" : "text-zinc-600"}`}>
                {ethDisplay}
              </div>
            </div>
            <div className="bg-black/20 rounded-xl p-2.5">
              <div className="text-[10px] text-zinc-500 mb-0.5">WETH in Vault</div>
              <div className={`text-sm font-bold font-mono ${hasWeth ? "text-violet-300" : "text-zinc-600"}`}>
                {wethDisplay}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            {/* Wrap ETH → WETH */}
            <button
              onClick={handleWrap}
              disabled={!hasEth || wethBusy}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition-colors
                bg-violet-600/20 border border-violet-500/40 text-violet-300
                hover:bg-violet-600/30 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {wrapping ? (
                <><RefreshCw className="w-3.5 h-3.5 animate-spin" /><span className="text-xs">{wethAction}</span></>
              ) : (
                <>ETH → WETH</>
              )}
            </button>

            {/* Unwrap WETH → ETH */}
            <button
              onClick={handleUnwrap}
              disabled={!hasWeth || wethBusy}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition-colors
                bg-zinc-700/40 border border-zinc-600/40 text-zinc-300
                hover:bg-zinc-700/60 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {unwrapping ? (
                <><RefreshCw className="w-3.5 h-3.5 animate-spin" /><span className="text-xs">{wethAction}</span></>
              ) : (
                <>WETH → ETH</>
              )}
            </button>
          </div>

          <p className="text-[10px] text-zinc-500 text-center">
            After unwrapping, ETH can be withdrawn from the Vault tab
          </p>
        </div>
      )}

      {/* ── ETH balance banner for LI.FI swap ── */}
      {hasEth && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-500/10 border border-blue-500/30">
          <Zap className="w-4 h-4 text-blue-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-blue-300">{ethDisplay} ETH in vault</div>
            <div className="text-[10px] text-blue-200/70">
              Use "Swap &amp; Deposit" below to convert to WETH or USDC and earn yield
            </div>
          </div>
        </div>
      )}

      {/* ── Vault cards ── */}
      <div className="space-y-3">
        {loading && positions.length === 0 ? (
          <div className="text-center py-12 animate-pulse text-zinc-500 text-xs">
            Checking Morpho positions...
          </div>
        ) : (
          MORPHO_VAULTS.map(vault => {
            const colors     = colorMap[vault.color as keyof typeof colorMap];
            const apy        = getApy(vault.id);
            const pos        = getPosition(vault.id);
            const rawBal     = vaultBalances[vault.id] || "0";
            const hasBal     = BigInt(rawBal) > 0n;
            const hasPos     = pos && pos.assetsValue > 0n;
            const balDisplay = hasBal ? parseFloat(formatUnits(BigInt(rawBal), vault.decimals)).toFixed(4) : "0";
            const posDisplay = hasPos ? parseFloat(formatUnits(pos.assetsValue, vault.decimals)).toFixed(6) : null;
            const busy       = isBusy(vault.id);

            return (
              <div key={vault.id} className={`rounded-2xl border ${colors.border} ${colors.bg} p-4 space-y-3`}>

                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${colors.text}`}>{vault.name}</span>
                      {apy?.apy != null ? (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${colors.badge} flex items-center gap-0.5`}>
                          <TrendingUp className="w-2.5 h-2.5" />
                          {apy.apy.toFixed(2)}% APY
                        </span>
                      ) : (
                        <span className="text-[10px] text-zinc-500">APY loading...</span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-0.5">{vault.description}</p>
                  </div>
                  <a href={vault.morphoUrl} target="_blank" rel="noopener noreferrer"
                    className="text-[9px] text-zinc-500 hover:text-zinc-300 underline shrink-0">
                    morpho.org ↗
                  </a>
                </div>

                <div className="flex items-center justify-between text-xs bg-white/50 dark:bg-black/20 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-1.5 text-zinc-500">
                    <Wallet className="w-3 h-3" />
                    <span>In Smart Vault</span>
                  </div>
                  <span className={`font-bold ${hasBal ? colors.text : "text-zinc-400"}`}>
                    {balDisplay} {vault.asset}
                  </span>
                </div>

                {hasPos && (
                  <div className="flex items-center justify-between text-xs bg-green-500/10 rounded-xl px-3 py-2 border border-green-500/20">
                    <div className="flex items-center gap-1.5 text-zinc-800 dark:text-zinc-100">
                      <Sprout className="w-3 h-3" strokeWidth={2.5} />
                      <span>Earning at Morpho</span>
                    </div>
                    <span className="font-bold text-zinc-800 dark:text-zinc-100">{posDisplay} {vault.asset}</span>
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  {hasEth && (
                    <button
                      onClick={() => handleSwapAndDeposit(vault)}
                      disabled={busy}
                      className="flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition-colors
                        bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600/30
                        disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {swapping === vault.id ? (
                        <><RefreshCw className="w-3.5 h-3.5 animate-spin" /><span className="text-xs">{swapProgress || "Processing..."}</span></>
                      ) : (
                        <><Zap className="w-3.5 h-3.5" /> Swap ETH → {vault.asset} &amp; Deposit</>
                      )}
                    </button>
                  )}

                  {hasBal && (
                    <button
                      onClick={() => handleDeposit(vault)}
                      disabled={busy}
                      className={`flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition-colors
                        ${colors.text} bg-white dark:bg-zinc-900 border ${colors.border} hover:opacity-80
                        disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {depositing === vault.id ? (
                        <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Depositing...</>
                      ) : (
                        <><ArrowRight className="w-3.5 h-3.5" /> Deposit {vault.asset}</>
                      )}
                    </button>
                  )}

                  {hasPos && (
                    <button
                      onClick={() => handleWithdraw(vault)}
                      disabled={busy}
                      className="px-3 py-2.5 rounded-xl font-bold text-sm text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border border-zinc-700 hover:text-zinc-200 hover:border-zinc-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {withdrawing === vault.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : "Withdraw"}
                    </button>
                  )}
                </div>

                {!hasBal && !hasPos && !hasEth && (
                  <p className="text-[10px] text-zinc-500 text-center">
                    Sweep dust tokens to WETH first, then come back to deposit.
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── How it works ── */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 space-y-1.5">
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide">How it works</p>
        <div className="space-y-1 text-xs text-zinc-500">
          <div className="flex gap-2">
            <span className="text-green-500 shrink-0">1.</span>
            <span>Sweep dust tokens to WETH in the Sweep tab</span>
          </div>
          <div className="flex gap-2">
            <span className="text-green-500 shrink-0">2.</span>
            <span>Unwrap WETH → ETH here if you want to withdraw, or deposit directly to Morpho</span>
          </div>
          <div className="flex gap-2">
            <span className="text-green-500 shrink-0">3.</span>
            <span>Yield accumulates automatically · Withdraw to vault anytime</span>
          </div>
        </div>
        <p className="text-[9px] text-zinc-600 pt-1">
          Powered by Morpho Blue · Swap via LI.FI · Non-custodial · Smart contract risk applies
        </p>
      </div>
    </div>
  );
};
