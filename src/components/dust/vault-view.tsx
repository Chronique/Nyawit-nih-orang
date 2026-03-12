"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount, useSwitchChain } from "wagmi";
import { getSmartAccountClient, getDirectVaultClient, publicClient } from "~/lib/smart-account";
import { formatUnits, encodeFunctionData, erc20Abi, type Address, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import { Copy, Wallet, Rocket, Check, Dollar, Refresh, Gas, NavArrowLeft, NavArrowRight, Upload, Flash } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";
import { fetchMoralisTokens, type MoralisToken } from "~/lib/moralis-data";
import { fetchTokenPrices } from "~/lib/price";
import { useAppDialog } from "~/components/ui/app-dialog";

const USDC_ADDRESS     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ITEMS_PER_PAGE   = 10;
const MAX_ETH_DEPOSIT  = 0.005;
const MAX_USDC_DEPOSIT = 10;
const MIN_TOKEN_USD    = 0.001;
const MAX_TOKEN_USD    = 3.0;

const generatePagination = (current: number, total: number) => {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | string)[] = [1];
  if (current > 3) pages.push("...");
  let start = Math.max(2, current - 1);
  let end   = Math.min(total - 1, current + 1);
  if (current <= 3) end = 4;
  if (current >= total - 2) start = total - 3;
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
};

const TokenLogo = ({ token }: { token: any }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { setSrc(token.logo || null); }, [token]);
  return (
    <img
      src={src || `https://tokens.1inch.io/${token.contractAddress || token.token_address}.png`}
      className="w-full h-full object-cover"
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
};

interface VaultViewProps {
  onGoToSwap?: (token: {
    contractAddress: string;
    symbol: string;
    formattedBal: string;
    decimals: number;
    rawBalance: string;
  }) => void;
}

export const VaultView = ({ onGoToSwap }: VaultViewProps) => {
  const { data: walletClient }             = useWalletClient();
  const { address: ownerAddress, chainId } = useAccount();
  const { switchChainAsync }               = useSwitchChain();
  const { confirm, prompt }                = useAppDialog();

  const [vaultAddress, setVaultAddress]               = useState<string | null>(null);
  const [ethBalance, setEthBalance]                   = useState("0");
  const [usdcBalance, setUsdcBalance]                 = useState<any>(null);
  const [ownerTokens, setOwnerTokens]                 = useState<MoralisToken[]>([]);
  const [ownerTokenPrices, setOwnerTokenPrices]       = useState<Record<string, number>>({});
  const [ownerEthBalance, setOwnerEthBalance]         = useState<bigint>(0n);
  const [ethDepositAmount, setEthDepositAmount]       = useState("");
  const [showEthDeposit, setShowEthDeposit]           = useState(false);
  const [isDeployed, setIsDeployed]                   = useState(false);
  const [loading, setLoading]                         = useState(false);
  const [loadingOwnerTokens, setLoadingOwnerTokens]   = useState(false);
  const [actionLoading, setActionLoading]             = useState<string | null>(null);
  const [toast, setToast]                             = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [currentOwnerPage, setCurrentOwnerPage]       = useState(1);
  const [showEthWithdraw, setShowEthWithdraw]         = useState(false);
  const [ethWithdrawAmount, setEthWithdrawAmount]     = useState("");
  const [selectedOwnerTokens, setSelectedOwnerTokens] = useState<Set<string>>(new Set());

  // ── Fetch vault data ───────────────────────────────────────────────────────
  const fetchVaultData = async () => {
    if (!walletClient) return;
    setLoading(true);
    try {
      const client = await getDirectVaultClient(walletClient);
      const addr   = client.account.address;
      const bal    = await publicClient.getBalance({ address: addr });
      const code   = await publicClient.getBytecode({ address: addr });

      setVaultAddress(addr);
      setEthBalance(formatEther(bal));
      setIsDeployed(code !== undefined && code !== null && code !== "0x");

      const moralisTokens = await fetchMoralisTokens(addr);
      const formatted = moralisTokens
        .filter((t) => BigInt(t.balance) > 0n)
        .map((t) => ({
          contractAddress: t.token_address,
          name:            t.name     || "Unknown",
          symbol:          t.symbol   || "???",
          logo:            t.logo     || null,
          decimals:        t.decimals || 18,
          rawBalance:      t.balance,
          formattedBal:    formatUnits(BigInt(t.balance), t.decimals || 18),
        }));

      const usdc = formatted.find(
        (t: any) => t.contractAddress.toLowerCase() === USDC_ADDRESS.toLowerCase()
      );
      setUsdcBalance(usdc || null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // ── Fetch owner wallet data ────────────────────────────────────────────────
  const fetchOwnerData = async () => {
    if (!ownerAddress) return;
    setLoadingOwnerTokens(true);
    try {
      const [data, ethBal] = await Promise.all([
        fetchMoralisTokens(ownerAddress),
        publicClient.getBalance({ address: ownerAddress as Address }),
      ]);
      setOwnerEthBalance(ethBal);

      const activeTokens = data.filter((t) => BigInt(t.balance) > 0n);
      if (activeTokens.length === 0) {
        setOwnerTokens([]);
        return;
      }

      // Fetch harga — best effort
      let prices: Record<string, number> = {};
      try {
        prices = await fetchTokenPrices(activeTokens.map(t => t.token_address));
        setOwnerTokenPrices(prices);
      } catch {
        setOwnerTokenPrices({});
      }

      // ── Filter: hanya dust ($0.001 – $3), token tanpa harga tetap tampil ──
      const dustTokens = activeTokens.filter(t => {
        const bal   = parseFloat(formatUnits(BigInt(t.balance), t.decimals || 18));
        const price = prices[t.token_address.toLowerCase()] ?? 0;
        const usd   = bal * price;
        if (price === 0) return true; // tidak ada harga → tetap tampil
        return usd >= MIN_TOKEN_USD && usd < MAX_TOKEN_USD;
      });

      // Sort: nilai USD desc, token tanpa harga di belakang
      dustTokens.sort((a, b) => {
        const valA = parseFloat(formatUnits(BigInt(a.balance), a.decimals)) * (prices[a.token_address.toLowerCase()] ?? 0);
        const valB = parseFloat(formatUnits(BigInt(b.balance), b.decimals)) * (prices[b.token_address.toLowerCase()] ?? 0);
        return valB - valA;
      });

      setOwnerTokens(dustTokens);
      setCurrentOwnerPage(1);
    } catch (e) {
      console.error("Failed to fetch wallet tokens:", e);
    } finally {
      setLoadingOwnerTokens(false);
    }
  };

  useEffect(() => { if (walletClient)   fetchVaultData();  }, [walletClient]);
  useEffect(() => { if (ownerAddress)   fetchOwnerData();  }, [ownerAddress]);

  const ensureNetwork = async () => {
    if (chainId !== base.id) {
      try {
        await switchChainAsync({ chainId: base.id });
      } catch {
        setToast({ msg: "Please switch to Base Mainnet first.", type: "error" });
        throw new Error("Wrong network");
      }
    }
  };

  // ── Withdraw ETH ──────────────────────────────────────────────────────────
  const handleWithdrawETH = async () => {
    if (!walletClient || !ownerAddress || !vaultAddress || !ethWithdrawAmount) return;
    if (isNaN(Number(ethWithdrawAmount)) || Number(ethWithdrawAmount) <= 0) {
      setToast({ msg: "Invalid ETH amount.", type: "error" });
      return;
    }
    try {
      await ensureNetwork();
      setActionLoading(`Withdrawing ${ethWithdrawAmount} ETH...`);
      const client = await getDirectVaultClient(walletClient);
      const txHash = await client.sendUserOperation({
        calls: [{ to: ownerAddress as Address, value: parseEther(ethWithdrawAmount), data: "0x" }],
      });
      setToast({ msg: "ETH withdrawal sent!", type: "success" });
      setEthWithdrawAmount("");
      setShowEthWithdraw(false);
      await client.waitForUserOperationReceipt({ hash: txHash });
      await fetchVaultData();
    } catch (e: any) {
      setToast({ msg: "ETH withdrawal failed: " + (e.shortMessage || e.message), type: "error" });
    } finally {
      setActionLoading(null);
    }
  };

  // ── Deposit ETH ───────────────────────────────────────────────────────────
  const handleDepositETH = async () => {
    if (!walletClient || !ownerAddress || !vaultAddress) return;
    const amount = parseFloat(ethDepositAmount);
    if (isNaN(amount) || amount <= 0) {
      setToast({ msg: "Invalid ETH amount.", type: "error" });
      return;
    }
    if (amount > MAX_ETH_DEPOSIT) {
      setToast({ msg: `Max ${MAX_ETH_DEPOSIT} ETH per deposit.`, type: "error" });
      return;
    }
    const ok = await confirm(`Deposit ${amount} ETH to vault?\n\nThis will be used as gas reserve.`, {
      title: "Deposit ETH",
      confirmText: "Deposit",
    });
    if (!ok) return;
    try {
      await ensureNetwork();
      setActionLoading(`Depositing ${amount} ETH to vault...`);
      const txHash = await walletClient.sendTransaction({
        to:      vaultAddress as Address,
        value:   parseEther(ethDepositAmount),
        chain:   base,
        account: walletClient.account!,
      });
      setToast({ msg: "ETH deposit sent!", type: "success" });
      setEthDepositAmount("");
      setShowEthDeposit(false);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await fetchVaultData();
    } catch (e: any) {
      setToast({ msg: "ETH deposit failed: " + (e.shortMessage || e.message), type: "error" });
    } finally {
      setActionLoading(null);
    }
  };

  // ── Withdraw ERC20 ────────────────────────────────────────────────────────
  const handleWithdrawToken = async (token: any) => {
    if (!walletClient || !ownerAddress || !vaultAddress) return;
    const amount = await prompt(
      `Enter amount to withdraw:`,
      token.formattedBal,
      { title: `Withdraw ${token.symbol}`, placeholder: "e.g. 1.5", confirmText: "Withdraw" }
    );
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    const ok = await confirm(`Withdraw ${amount} ${token.symbol} to your wallet?`, {
      title: "Confirm Withdrawal",
      confirmText: "Withdraw",
    });
    if (!ok) return;
    try {
      await ensureNetwork();
      setActionLoading(`Withdrawing ${token.symbol}...`);
      const rawAmount    = BigInt(Math.floor(parseFloat(amount) * 10 ** token.decimals));
      const transferData = encodeFunctionData({
        abi: erc20Abi, functionName: "transfer",
        args: [ownerAddress as Address, rawAmount],
      });
      const client = await getDirectVaultClient(walletClient);
      const txHash = await client.sendUserOperation({
        calls: [{ to: token.contractAddress as Address, value: 0n, data: transferData }],
      });
      setToast({ msg: "Withdrawal processed!", type: "success" });
      await client.waitForUserOperationReceipt({ hash: txHash });
      await fetchVaultData();
    } catch (e: any) {
      setToast({ msg: "Withdrawal failed: " + (e.shortMessage || e.message), type: "error" });
    } finally {
      setActionLoading(null);
    }
  };

  // ── Deposit single token ──────────────────────────────────────────────────
  const handleDeposit = async (token: MoralisToken) => {
    if (!walletClient || !ownerAddress || !vaultAddress) return;
    const isUsdc = token.token_address.toLowerCase() === USDC_ADDRESS.toLowerCase();
    if (isUsdc) {
      const usdcAmount = parseFloat(formatUnits(BigInt(token.balance), token.decimals || 6));
      if (usdcAmount > MAX_USDC_DEPOSIT) {
        setToast({ msg: `Max deposit is ${MAX_USDC_DEPOSIT} USDC. Split into smaller amounts.`, type: "error" });
        return;
      }
    }
    const ok = await confirm(`Deposit ${token.symbol} to vault?`, {
      title: "Confirm Deposit",
      confirmText: "Deposit",
    });
    if (!ok) return;
    try {
      await ensureNetwork();
      setActionLoading(`Depositing ${token.symbol}...`);
      const txHash = await walletClient.writeContract({
        address:      token.token_address as Address,
        abi:          erc20Abi,
        functionName: "transfer",
        args:         [vaultAddress as Address, BigInt(token.balance)],
        chain:        base,
        account:      walletClient.account!,
      });
      setToast({ msg: "Deposit sent! Updating balances...", type: "success" });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await Promise.all([fetchVaultData(), fetchOwnerData()]);
    } catch (e: any) {
      setToast({ msg: "Deposit failed: " + (e.shortMessage || e.message), type: "error" });
    } finally {
      setActionLoading(null);
    }
  };

  // ── Batch deposit ─────────────────────────────────────────────────────────
  const handleBatchDeposit = async () => {
    const tokensToDeposit = ownerTokens.filter(t => selectedOwnerTokens.has(t.token_address));
    if (tokensToDeposit.length === 0) return;
    const ok = await confirm(
      tokensToDeposit.length > 1
        ? `You will sign ${tokensToDeposit.length} transactions one by one.`
        : `Deposit ${tokensToDeposit[0].symbol} to vault?`,
      {
        title: `Deposit ${tokensToDeposit.length} token${tokensToDeposit.length > 1 ? "s" : ""} to vault?`,
        confirmText: "Deposit",
        variant: tokensToDeposit.length > 1 ? "warning" : "default",
      }
    );
    if (!ok) return;
    try {
      await ensureNetwork();
      let successCount = 0;
      for (const token of tokensToDeposit) {
        try {
          setActionLoading(`[${successCount + 1}/${tokensToDeposit.length}] Depositing ${token.symbol}...`);
          const isUsdc = token.token_address.toLowerCase() === USDC_ADDRESS.toLowerCase();
          if (isUsdc) {
            const usdcAmt = parseFloat(formatUnits(BigInt(token.balance), token.decimals || 6));
            if (usdcAmt > MAX_USDC_DEPOSIT) {
              setToast({ msg: `Skipped USDC — exceeds max ${MAX_USDC_DEPOSIT} USDC.`, type: "error" });
              continue;
            }
          }
          const txHash = await walletClient!.writeContract({
            address:      token.token_address as Address,
            abi:          erc20Abi,
            functionName: "transfer",
            args:         [vaultAddress as Address, BigInt(token.balance)],
            chain:        base,
            account:      walletClient!.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash: txHash });
          const newSet = new Set(selectedOwnerTokens);
          newSet.delete(token.token_address);
          setSelectedOwnerTokens(newSet);
          successCount++;
          setToast({ msg: `${token.symbol} deposited! (${successCount}/${tokensToDeposit.length})`, type: "success" });
        } catch (err: any) {
          console.error(`Failed to deposit ${token.symbol}:`, err);
          setToast({ msg: `Failed to deposit ${token.symbol}`, type: "error" });
          if (err.code === 4001 || err.message?.includes("rejected")) break;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (successCount > 0) {
        setToast({ msg: `Done! ${successCount} token${successCount > 1 ? "s" : ""} deposited.`, type: "success" });
        await Promise.all([fetchVaultData(), fetchOwnerData()]);
      }
    } catch (e: any) {
      setToast({ msg: "Batch deposit failed: " + e.message, type: "error" });
    } finally {
      setActionLoading(null);
    }
  };

  const toggleOwnerToken = (addr: string) => {
    const newSet = new Set(selectedOwnerTokens);
    if (newSet.has(addr)) newSet.delete(addr);
    else newSet.add(addr);
    setSelectedOwnerTokens(newSet);
  };

  const selectAllOwnerTokens = () => {
    if (selectedOwnerTokens.size === ownerTokens.length) {
      setSelectedOwnerTokens(new Set());
    } else {
      setSelectedOwnerTokens(new Set(ownerTokens.map((t) => t.token_address)));
    }
  };

  const currentOwnerTokens = ownerTokens.slice(
    (currentOwnerPage - 1) * ITEMS_PER_PAGE,
    currentOwnerPage * ITEMS_PER_PAGE
  );
  const totalOwnerPages = Math.ceil(ownerTokens.length / ITEMS_PER_PAGE);

  return (
    <div className="pb-28 space-y-6 relative min-h-[50vh]">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      {actionLoading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <div className="text-sm font-bold text-center animate-pulse">{actionLoading}</div>
          </div>
        </div>
      )}

      {/* ── HEADER CARD ─────────────────────────────────────────────────────── */}
      <div className="p-5 bg-zinc-900 text-white rounded-2xl shadow-lg relative overflow-hidden">
        <div className={`absolute top-4 right-4 text-[10px] px-2 py-1 rounded-full border font-medium flex items-center gap-1 ${
          isDeployed
            ? "bg-green-500/20 border-green-500 text-green-400"
            : "bg-orange-500/20 border-orange-500 text-orange-400"
        }`}>
          {isDeployed ? <Check className="w-3 h-3" /> : <Rocket className="w-3 h-3" />}
          {isDeployed ? "Active" : "Inactive"}
        </div>

        <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
          <Wallet className="w-3 h-3" /> Smart Vault
        </div>
        <div className="flex items-center justify-between mb-4">
          <code className="text-sm truncate max-w-[180px] opacity-80">{vaultAddress || "Loading..."}</code>
          <button onClick={() => vaultAddress && navigator.clipboard.writeText(vaultAddress)}>
            <Copy className="w-4 h-4 hover:text-blue-400" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {/* ETH Balance */}
          <div className="bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-400">
                  <Gas className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-zinc-400">Gas Reserve (ETH)</div>
                  <div className="text-lg font-bold">{parseFloat(ethBalance).toFixed(5)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowEthWithdraw(!showEthWithdraw)}
                  className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-xs font-medium border border-zinc-600"
                >
                  {showEthWithdraw ? "Cancel" : "Withdraw"}
                </button>
                <button
                  onClick={() => setShowEthDeposit(!showEthDeposit)}
                  className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded-lg text-xs font-medium border border-blue-600 text-blue-100"
                >
                  {showEthDeposit ? "Cancel" : "Deposit"}
                </button>
              </div>
            </div>

            {showEthDeposit && (
              <div className="mt-3 pt-3 border-t border-zinc-700 animate-in slide-in-from-top-2 duration-200">
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder={`Amount (max ${MAX_ETH_DEPOSIT} ETH)`}
                    value={ethDepositAmount}
                    onChange={(e) => setEthDepositAmount(e.target.value)}
                    max={MAX_ETH_DEPOSIT}
                    className="flex-1 bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 placeholder-zinc-500"
                  />
                  <button
                    onClick={handleDepositETH}
                    disabled={!ethDepositAmount}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1"
                  >
                    <Upload className="w-3 h-3" /> Send
                  </button>
                </div>
                <div className="text-[10px] text-zinc-500 mt-1 ml-1">
                  From: {ownerAddress?.slice(0, 6)}...{ownerAddress?.slice(-4)} · Max {MAX_ETH_DEPOSIT} ETH
                  {ownerEthBalance > 0n && (
                    <span className="ml-1 text-zinc-400">
                      (wallet: {parseFloat(formatUnits(ownerEthBalance, 18)).toFixed(4)} ETH)
                    </span>
                  )}
                </div>
              </div>
            )}

            {showEthWithdraw && (
              <div className="mt-3 pt-3 border-t border-zinc-700 animate-in slide-in-from-top-2 duration-200">
                <div className="flex gap-1.5 mb-2">
                  {[50, 100].map((pct) => (
                  <button
                  key={pct}
                  onClick={() => {
                  const val = parseFloat(ethBalance) * pct / 100;
                  setEthWithdrawAmount(val.toFixed(6));
                  }}
                  className="flex-1 py-1.5 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded-lg text-xs font-bold text-zinc-200"
                  >
                  {pct}%
                  </button>
                  ))}
                </div>
                
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Amount (e.g. 0.01)"
                    value={ethWithdrawAmount}
                    onChange={(e) => setEthWithdrawAmount(e.target.value)}
                    className="flex-1 bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 placeholder-zinc-500"
                  />
                  <button
                    onClick={handleWithdrawETH}
                    disabled={!ethWithdrawAmount}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1"
                  >
                    <Upload className="w-3 h-3" /> Send
                  </button>
                </div>
                <div className="text-[10px] text-zinc-500 mt-1 ml-1">
                  To: {ownerAddress?.slice(0, 6)}...{ownerAddress?.slice(-4)}
                </div>
              </div>
            )}
          </div>

          {/* USDC Balance */}
          <div className="flex items-center justify-between bg-blue-900/20 p-3 rounded-xl border border-blue-500/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white">
                <Dollar className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-blue-300">USDC Savings</div>
                <div className="text-lg font-bold text-blue-100">
                  {usdcBalance ? parseFloat(usdcBalance.formattedBal).toFixed(2) : "0.00"}
                </div>
              </div>
            </div>
            {usdcBalance && parseFloat(usdcBalance.formattedBal) > 0 && (
              <button
                onClick={() => handleWithdrawToken(usdcBalance)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold"
              >
                Withdraw
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── WALLET ASSETS ───────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between px-1 mb-2">
          <div className="flex flex-col">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Wallet className="w-5 h-5 text-green-500" /> Wallet Assets
            </h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Dust tokens · $0.001–$3 · no-price tokens included
            </p>
            {ownerTokens.length > 0 && (
              <button
                onClick={selectAllOwnerTokens}
                className="text-[10px] text-blue-500 font-bold uppercase tracking-wider text-left mt-1"
              >
                {selectedOwnerTokens.size === ownerTokens.length ? "Deselect All" : "Select All Assets"}
              </button>
            )}
          </div>
          <button
            onClick={fetchOwnerData}
            className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:rotate-180 transition-all duration-500"
          >
            <Refresh className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        <div className="space-y-2 min-h-[60px]">
          {loadingOwnerTokens ? (
            <div className="text-center py-6 animate-pulse text-zinc-400 text-sm">Scanning wallet...</div>
          ) : ownerTokens.length === 0 ? (
            <div className="text-center py-6 text-zinc-400 text-sm border border-dashed border-zinc-700 rounded-xl">
              No dust tokens in wallet.
            </div>
          ) : (
            currentOwnerTokens.map((token, i) => {
              const isSelected = selectedOwnerTokens.has(token.token_address);
              const usdVal     = ownerTokenPrices[token.token_address.toLowerCase()]
                ? parseFloat(formatUnits(BigInt(token.balance), token.decimals)) *
                  ownerTokenPrices[token.token_address.toLowerCase()]
                : null;
              return (
                <div
                  key={i}
                  onClick={() => toggleOwnerToken(token.token_address)}
                  className={`flex items-center justify-between p-3 border rounded-xl transition-all cursor-pointer ${
                    isSelected
                      ? "bg-blue-50/50 border-blue-200 dark:bg-blue-900/10 dark:border-blue-800"
                      : "bg-white dark:bg-zinc-900 border-zinc-100 dark:border-zinc-800"
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      isSelected ? "bg-blue-600 border-blue-600" : "border-zinc-300"
                    }`}>
                      {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={4} />}
                    </div>
                    <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center shrink-0 overflow-hidden">
                      <TokenLogo token={token} />
                    </div>
                    <div>
                      <div className="font-semibold text-sm truncate max-w-[100px]">{token.symbol}</div>
                      <div className="text-xs text-zinc-500">
                        {parseFloat(formatUnits(BigInt(token.balance), token.decimals)).toFixed(4)}
                        {usdVal !== null && (
                          <span className="ml-1 text-zinc-400">· ${usdVal.toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {vaultAddress && !isSelected && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeposit(token); }}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400"
                    >
                      Deposit
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {selectedOwnerTokens.size >= 1 && (
          <div className="mt-4 animate-in fade-in slide-in-from-bottom-2">
            <button
              onClick={handleBatchDeposit}
              className="w-full py-3 bg-green-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-green-500/20 flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Deposit {selectedOwnerTokens.size === 1
                ? "Selected Asset"
                : `Selected Assets (${selectedOwnerTokens.size})`}
            </button>
            {selectedOwnerTokens.size > 1 && (
              <p className="text-[9px] text-zinc-500 text-center mt-2 italic">
                ⚠ You will sign {selectedOwnerTokens.size} transactions one by one.
              </p>
            )}
          </div>
        )}

        {totalOwnerPages > 1 && (
          <div className="flex justify-center items-center gap-1 mt-3">
            <button
              onClick={() => setCurrentOwnerPage((p) => Math.max(1, p - 1))}
              disabled={currentOwnerPage === 1}
              className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 disabled:opacity-30"
            >
              <NavArrowLeft className="w-4 h-4" />
            </button>
            {generatePagination(currentOwnerPage, totalOwnerPages).map((page, i) =>
              page === "..." ? (
                <span key={i} className="px-2 text-zinc-400 text-sm">...</span>
              ) : (
                <button
                  key={i}
                  onClick={() => setCurrentOwnerPage(page as number)}
                  className={`w-8 h-8 rounded-lg text-xs font-bold ${
                    currentOwnerPage === page
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {page}
                </button>
              )
            )}
            <button
              onClick={() => setCurrentOwnerPage((p) => Math.min(totalOwnerPages, p + 1))}
              disabled={currentOwnerPage === totalOwnerPages}
              className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 disabled:opacity-30"
            >
              <NavArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};