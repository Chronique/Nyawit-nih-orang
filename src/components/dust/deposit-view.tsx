"use client";

import { useEffect, useState, useCallback } from "react";
import { useWalletClient, useAccount, useSwitchChain, useWaitForTransactionReceipt } from "wagmi";
import {
  getSmartAccountClient,
  getDirectVaultClient,           // ← FIX: bukan getSelfPayingSmartAccountClient
  detectVaultAddress,
  deployVault,
  publicClient,
} from "~/lib/smart-account";
import { fetchMoralisTokens } from "~/lib/moralis-data";
import { formatUnits, formatEther, encodeFunctionData, erc20Abi, type Address } from "viem";
import { base } from "viem/chains";
import { Rocket, Check, Copy, Refresh, Shield } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";
import { useAppDialog } from "~/components/ui/app-dialog";

// ── Constants ─────────────────────────────────────────────────────────────────
const USDC_ADDRESS    = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

const KNOWN_SPENDERS: { label: string; address: Address }[] = [
  { label: "LI.FI Diamond",            address: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EAe" },
  { label: "0x ExchangeProxy",          address: "0xDef1C0ded9bec7F1a1670819833240f027b25EfF" },
  { label: "Odos Router v2",            address: "0x19cEeAd7105607Cd444F5ad10dd51356436095a1" },
  { label: "Paraswap Augustus v6",      address: "0x6A000F20005980200259B80c5102003040001068" },
  { label: "Uniswap v3 SwapRouter",    address: "0x2626664c2603336E57B271c5C0b26F421741e481" },
  { label: "Uniswap UniversalRouter",   address: "0x198EF79F1F515F02dFE9e3115eD9fC07183f02fC" },
  { label: "KyberSwap MetaAggregator",  address: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5" },
  { label: "KyberSwap Router v2",       address: "0x617Dee16B86534a5d792A4d7A62FB491B544111E" },
  { label: "Aerodrome Router",          address: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43" },
  { label: "Aerodrome Slipstream",      address: "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5" },
  { label: "BaseSwap Router",           address: "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86" },
  { label: "SwapBased Router",          address: "0xaaa3b1F1bd7BCc97fD1917c18ADE665C5D31F066" },
];

const PERMIT2_SUB_SPENDERS: { label: string; address: Address }[] = [
  { label: "Uniswap UniversalRouter (via Permit2)", address: "0x198EF79F1F515F02dFE9e3115eD9fC07183f02fC" },
  { label: "Uniswap v3 SwapRouter (via Permit2)",   address: "0x2626664c2603336E57B271c5C0b26F421741e481" },
];

const PERMIT2_ABI = [
  {
    name: "allowance", type: "function", stateMutability: "view",
    inputs:  [{ name: "user", type: "address" }, { name: "token", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }],
  },
  {
    name: "approve", type: "function", stateMutability: "nonpayable",
    inputs:  [{ name: "token", type: "address" }, { name: "spender", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }],
    outputs: [],
  },
] as const;

const GM_CONTRACT_ADDRESS = "0xce0274F873cDbC261ee684cAb428C4233bc20dC2";
const GM_ABI = [{ name: "sayGM", type: "function", stateMutability: "nonpayable", inputs: [] }] as const;

const ALLOWANCE_ABI = [
  {
    name: "allowance", type: "function", stateMutability: "view",
    inputs:  [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ── GM Cooldown helpers ───────────────────────────────────────────────────────
const getGmStorageKey        = (address: string) => `gm_last_sent_${address.toLowerCase()}`;
const todayUTC               = () => new Date().toISOString().slice(0, 10);
const msUntilNextUTCMidnight = () => { const n = new Date(); n.setUTCHours(24, 0, 0, 0); return n.getTime() - Date.now(); };
const formatCountdown        = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(v => v.toString().padStart(2, "0")).join(":");
};

// ── Hybrid vault client factory ───────────────────────────────────────────────
//
// ROOT CAUSE validateUserOp reverted:
//   SC wallet → getSelfPayingSmartAccountClient → toLightSmartAccount(SC wallet signer)
//   → UserOp dikirim → LightAccount.validateUserOp() REVERT ❌
//   Sebab: toLightSmartAccount expect ECDSA signer (EOA), bukan ERC-1271 (SC wallet)
//
// FIX: getDirectVaultClient untuk SC wallet
//   SC wallet → walletClient.writeContract(vault.execute(dest, value, data))
//   → LightAccount v2 _requireFromEntryPointOrOwner(): caller = SC wallet = owner ✅
//   → Tidak ada UserOp → tidak ada validateUserOp → tidak ada signature issue
//
// EOA → getSmartAccountClient → paymaster sponsored, tetap gratis ✅
//
async function getVaultClient(walletClient: any, ownerAddress: string) {
  try {
    const code          = await publicClient.getBytecode({ address: ownerAddress as Address });
    const isSmartWallet = !!code && code !== "0x";
    if (isSmartWallet) {
      console.log("[DustDeposit] Owner is SC wallet → direct vault.execute() as owner");
      return { client: await getDirectVaultClient(walletClient), isSponsored: false };
    }
    console.log("[DustDeposit] Owner is EOA → sponsored (paymaster) client");
    return { client: await getSmartAccountClient(walletClient), isSponsored: true };
  } catch (e) {
    console.warn("[DustDeposit] Detection failed, fallback to sponsored:", e);
    return { client: await getSmartAccountClient(walletClient), isSponsored: true };
  }
}

interface ActiveApproval {
  tokenAddress:       string;
  tokenSymbol:        string;
  spenderAddress:     string;
  spenderLabel:       string;
  allowance:          bigint;
  isPermit2Internal?: boolean;
}

export const DustDepositView = () => {
  const { data: walletClient }             = useWalletClient();
  const { address: ownerAddress, chainId } = useAccount();
  const { switchChainAsync }               = useSwitchChain();
  const { confirm }                        = useAppDialog();

  const [vaultAddress, setVaultAddress]         = useState<Address | null>(null);
  const [vaultVersion, setVaultVersion]         = useState<"v1" | "v2" | null>(null);
  const [isDeployed, setIsDeployed]             = useState(false);
  const [ethBalance, setEthBalance]             = useState("0");
  const [usdcBalance, setUsdcBalance]           = useState("0");
  const [dustTokens, setDustTokens]             = useState<any[]>([]);
  const [allVaultTokens, setAllVaultTokens]     = useState<any[]>([]);
  const [loading, setLoading]                   = useState(false);
  const [activating, setActivating]             = useState(false);
  const [deployTxHash, setDeployTxHash]         = useState<`0x${string}` | undefined>();
  const [toast, setToast]                       = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [approvals, setApprovals]               = useState<ActiveApproval[]>([]);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [revoking, setRevoking]                 = useState(false);
  const [sendingGM, setSendingGM]               = useState(false);
  const [isOwnerSmartWallet, setIsOwnerSmartWallet] = useState(false);

  // ── GM Cooldown state ─────────────────────────────────────────────────────
  const [gmDone, setGmDone]           = useState(false);
  const [gmCountdown, setGmCountdown] = useState("");

  // Detect wallet type
  useEffect(() => {
    if (!ownerAddress) return;
    publicClient.getBytecode({ address: ownerAddress as Address })
      .then(code => setIsOwnerSmartWallet(!!code && code !== "0x"))
      .catch(() => setIsOwnerSmartWallet(false));
  }, [ownerAddress]);

  useEffect(() => {
    if (!ownerAddress) return;
    setGmDone(localStorage.getItem(getGmStorageKey(ownerAddress)) === todayUTC());
  }, [ownerAddress]);

  useEffect(() => {
    if (!gmDone) { setGmCountdown(""); return; }
    const tick = () => {
      const remaining = msUntilNextUTCMidnight();
      setGmCountdown(formatCountdown(remaining));
      if (remaining <= 0) { setGmDone(false); if (ownerAddress) localStorage.removeItem(getGmStorageKey(ownerAddress)); }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [gmDone, ownerAddress]);

  // ── GM — direct walletClient.writeContract (works semua wallet) ───────────
  const handleSayGM = async () => {
    if (!walletClient || !isDeployed) { setToast({ msg: "Please activate your Smart Wallet first!", type: "error" }); return; }
    if (gmDone) { setToast({ msg: "You already said GM today! Come back after 00:00 UTC.", type: "error" }); return; }
    setSendingGM(true);
    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      const txHash = await walletClient.writeContract({
        address: GM_CONTRACT_ADDRESS as Address, abi: GM_ABI, functionName: "sayGM",
        chain: base, account: walletClient.account!,
      });
      setToast({ msg: "Sending GM...", type: "success" });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (ownerAddress) localStorage.setItem(getGmStorageKey(ownerAddress), todayUTC());
      setGmDone(true);
      setToast({ msg: "GM sent! See you tomorrow 👋", type: "success" });
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown error";
      setToast({ msg: msg.includes("rejected") ? "Cancelled." : "GM failed: " + msg, type: "error" });
    } finally { setSendingGM(false); }
  };

  // ── Deploy confirm ────────────────────────────────────────────────────────
  const { isSuccess: deployConfirmed } = useWaitForTransactionReceipt({ hash: deployTxHash });
  useEffect(() => {
    if (deployConfirmed) { setIsDeployed(true); setActivating(false); setToast({ msg: "Smart Wallet activated! 🎉", type: "success" }); fetchVaultData(); }
  }, [deployConfirmed]);

  // ── Detect vault ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ownerAddress) return;
    detectVaultAddress(ownerAddress as Address).then(({ address, version }) => { setVaultAddress(address); setVaultVersion(version); });
  }, [ownerAddress]);

  // ── Fetch vault data ──────────────────────────────────────────────────────
  const fetchVaultData = useCallback(async () => {
    if (!vaultAddress) return;
    setLoading(true);
    try {
      const [code, ethBal] = await Promise.all([
        publicClient.getBytecode({ address: vaultAddress }),
        publicClient.getBalance({ address: vaultAddress }),
      ]);
      const deployed = !!code && code !== "0x";
      setIsDeployed(deployed);
      setEthBalance(formatEther(ethBal));
      const moralisTokens = await fetchMoralisTokens(vaultAddress);
      const formatted = moralisTokens.filter(t => BigInt(t.balance) > 0n).map(t => ({
        contractAddress: t.token_address, symbol: t.symbol || "???",
        logo: t.logo || null, decimals: t.decimals || 18,
        formattedBal: formatUnits(BigInt(t.balance), t.decimals || 18),
      }));
      const usdc = formatted.find(t => t.contractAddress.toLowerCase() === USDC_ADDRESS.toLowerCase());
      setUsdcBalance(usdc ? parseFloat(usdc.formattedBal).toFixed(2) : "0");
      setDustTokens(formatted.filter(t => t.contractAddress.toLowerCase() !== USDC_ADDRESS.toLowerCase()));
      setAllVaultTokens(formatted);
      if (deployed) fetchApprovals(vaultAddress, formatted);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [vaultAddress]);

  useEffect(() => { fetchVaultData(); }, [fetchVaultData]);

  // ── Fetch approvals ───────────────────────────────────────────────────────
  const fetchApprovals = async (vault: Address, tokens: any[]) => {
    if (tokens.length === 0) return;
    setLoadingApprovals(true);
    try {
      const found: ActiveApproval[] = [];
      await Promise.all(tokens.flatMap(token => KNOWN_SPENDERS.map(async spender => {
        try {
          const allowance = await publicClient.readContract({
            address: token.contractAddress as Address, abi: ALLOWANCE_ABI,
            functionName: "allowance", args: [vault, spender.address], blockTag: "pending",
          });
          if (allowance > 0n) found.push({ tokenAddress: token.contractAddress, tokenSymbol: token.symbol, spenderAddress: spender.address, spenderLabel: spender.label, allowance });
        } catch { /* skip */ }
      })));
      await Promise.all(tokens.flatMap(token => PERMIT2_SUB_SPENDERS.map(async subSpender => {
        try {
          const [amount] = await publicClient.readContract({
            address: PERMIT2_ADDRESS, abi: PERMIT2_ABI, functionName: "allowance",
            args: [vault, token.contractAddress as Address, subSpender.address], blockTag: "pending",
          });
          if (amount > 0n) found.push({
            tokenAddress: token.contractAddress, tokenSymbol: token.symbol,
            spenderAddress: subSpender.address, spenderLabel: subSpender.label,
            allowance: BigInt(amount), isPermit2Internal: true,
          });
        } catch { /* skip */ }
      })));
      setApprovals(found);
    } catch (e) { console.error("[Revoke] Error:", e); }
    finally { setLoadingApprovals(false); }
  };

  // ── Revoke — pakai getVaultClient (auto-detect EOA vs SC wallet) ──────────
  const handleRevokeAll = async () => {
    if (!walletClient || !vaultAddress || !ownerAddress || approvals.length === 0) return;

    const ok = await confirm(
      [
        `${approvals.length} approval${approvals.length > 1 ? "s" : ""} will be revoked.`,
        isOwnerSmartWallet
          ? "Gas ~$0.0001 charged from your SC wallet (direct tx, no paymaster)."
          : "Gas is sponsored by paymaster.",
        "Some tokens may not support revocation — they will be skipped.",
      ].join("\n"),
      { title: `Revoke ${approvals.length} approval${approvals.length > 1 ? "s" : ""}?`, variant: "warning", confirmText: "Revoke" }
    );
    if (!ok) return;

    setRevoking(true);
    const { client } = await getVaultClient(walletClient, ownerAddress);

    let successCount = 0;
    const failedTokens: string[] = [];

    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });

      for (const approval of approvals) {
        setToast({ msg: `Revoking ${approval.tokenSymbol} (${successCount + failedTokens.length + 1}/${approvals.length})...`, type: "success" });
        try {
          let txHash: string;
          if (approval.isPermit2Internal) {
            txHash = await client.sendUserOperation({
              calls: [{ to: PERMIT2_ADDRESS, value: 0n, data: encodeFunctionData({ abi: PERMIT2_ABI, functionName: "approve", args: [approval.tokenAddress as Address, approval.spenderAddress as Address, 0n, 0] }) }],
            });
          } else {
            try {
              txHash = await client.sendUserOperation({
                calls: [{ to: approval.tokenAddress as Address, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [approval.spenderAddress as Address, 0n] }) }],
              });
            } catch {
              console.warn(`[Revoke] ${approval.tokenSymbol} revert on approve(0), trying approve(1)...`);
              txHash = await client.sendUserOperation({
                calls: [{ to: approval.tokenAddress as Address, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [approval.spenderAddress as Address, 1n] }) }],
              });
            }
          }
          await client.waitForUserOperationReceipt({ hash: txHash as `0x${string}` });
          successCount++;
        } catch (tokenErr: any) {
          console.error(`[Revoke] ✗ ${approval.tokenSymbol} failed:`, tokenErr?.message);
          failedTokens.push(approval.tokenSymbol);
        }
      }

      const failedAddresses = new Set(approvals.filter(a => failedTokens.includes(a.tokenSymbol)).map(a => a.tokenAddress));
      setApprovals(prev => prev.filter(a => failedAddresses.has(a.tokenAddress)));

      if (successCount > 0 && failedTokens.length === 0) {
        setToast({ msg: `✓ All ${successCount} approval${successCount > 1 ? "s" : ""} revoked!`, type: "success" });
      } else if (successCount > 0) {
        setToast({ msg: `✓ ${successCount} revoked · ${failedTokens.length} skipped (${failedTokens.join(", ")} — token restriction)`, type: "success" });
      } else {
        setToast({ msg: `All tokens have revoke restriction. Cannot set allowance to 0.`, type: "error" });
      }
      if (successCount > 0) setTimeout(() => fetchApprovals(vaultAddress, allVaultTokens), 8000);
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown";
      setToast({ msg: msg.includes("rejected") || msg.includes("denied") ? "Cancelled." : "Revoke failed: " + msg, type: "error" });
    } finally { setRevoking(false); }
  };

  // ── Activate vault ────────────────────────────────────────────────────────
  const handleActivate = async () => {
    if (!walletClient) return;
    try {
      if (chainId !== base.id) await switchChainAsync({ chainId: base.id });
      setActivating(true);
      setToast({ msg: "Confirm transaction in your wallet...", type: "success" });
      const txHash = await deployVault(walletClient);
      setDeployTxHash(txHash);
      setToast({ msg: "Activation sent! Waiting for confirmation...", type: "success" });
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown error";
      setToast({ msg: msg.includes("rejected") || msg.includes("denied") ? "Cancelled." : "Activation error: " + msg, type: "error" });
      setActivating(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      {/* VAULT ADDRESS CARD */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Smart Vault</span>
          <div className="flex items-center gap-2">
            {vaultVersion && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${vaultVersion === "v1" ? "text-zinc-400 border-zinc-600 bg-zinc-800" : "text-blue-400 border-blue-600 bg-blue-900/30"}`}>
                Light Account {vaultVersion === "v1" ? "v1.1" : "v2.0"}
              </span>
            )}
            <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full border ${isDeployed ? "text-green-400 border-green-500/40 bg-green-500/10" : "text-orange-400 border-orange-500/40 bg-orange-500/10"}`}>
              {isDeployed ? <Check className="w-3 h-3" /> : <Rocket className="w-3 h-3" />}
              {isDeployed ? "Active" : "Inactive"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <code className="text-sm font-mono flex-1 truncate text-zinc-700 dark:text-zinc-300">
            {vaultAddress ? `${vaultAddress.slice(0, 10)}...${vaultAddress.slice(-8)}` : "Deriving address..."}
          </code>
          <button onClick={() => vaultAddress && navigator.clipboard.writeText(vaultAddress)} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"><Copy className="w-4 h-4" /></button>
          <button onClick={fetchVaultData} disabled={loading} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400"><Refresh className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></button>
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
          <div className="text-xs text-zinc-400 text-center">{dustTokens.length} dust token{dustTokens.length > 1 ? "s" : ""} in vault</div>
        )}
      </div>

      {/* REVOKE SECTION */}
      {isDeployed && (approvals.length > 0 || loadingApprovals) && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-red-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-black">
                {loadingApprovals ? `Scanning ${KNOWN_SPENDERS.length} spenders...` : `${approvals.length} Active Approval${approvals.length > 1 ? "s" : ""} Found`}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                {loadingApprovals ? "Checking allowances across all known DEX routers on Base..." : "DEX routers can still spend your vault tokens. Revoke to secure your funds."}
              </p>
            </div>
          </div>

          {!loadingApprovals && approvals.length > 0 && (
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {Array.from(new Set(approvals.map(a => a.tokenAddress))).map(tokenAddr => {
                const tokenApprovals = approvals.filter(a => a.tokenAddress === tokenAddr);
                return (
                  <div key={tokenAddr} className="text-xs bg-red-500/10 rounded-lg px-2.5 py-1.5 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-black">{tokenApprovals[0]!.tokenSymbol}</span>
                      <span className="text-zinc-300 text-[10px]">{tokenApprovals.length} spender{tokenApprovals.length > 1 ? "s" : ""}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500 truncate">{tokenApprovals.map(a => a.spenderLabel).join(" · ")}</div>
                  </div>
                );
              })}
            </div>
          )}

          <button
            onClick={handleRevokeAll}
            disabled={revoking || loadingApprovals || approvals.length === 0}
            className="w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors bg-red-600 hover:bg-red-500 text-white disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            {revoking ? <><Refresh className="w-4 h-4 animate-spin" /> Revoking...</> : <><Shield className="w-4 h-4" /> Revoke All ({approvals.length}) — 1 tx per token</>}
          </button>
          <p className="text-[10px] text-zinc-500 text-center">
            {isOwnerSmartWallet
              ? `Direct tx · Gas ~$0.0001 · ${KNOWN_SPENDERS.length} spenders scanned`
              : `Gasless via paymaster · ${KNOWN_SPENDERS.length} spenders scanned`}
          </p>
        </div>
      )}

      {isDeployed && !loadingApprovals && approvals.length === 0 && allVaultTokens.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/5 border border-green-500/20">
          <Shield className="w-3.5 h-3.5 text-green-400 shrink-0" />
          <p className="text-xs text-green-400">No active approvals found across {KNOWN_SPENDERS.length} spenders. Vault is clean.</p>
        </div>
      )}

      {!isDeployed && (
        <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-orange-300">Smart Wallet not yet active.</p>
            <p className="text-xs text-zinc-400">Activate your Smart Vault to enable batch swaps and token management. Gas fee is paid from your connected wallet.</p>
          </div>
          <div className="text-xs text-blue-300 bg-blue-400/10 border border-blue-400/20 rounded-lg px-3 py-2">
            ℹ Gas will be charged from your wallet ({ownerAddress?.slice(0, 6)}...{ownerAddress?.slice(-4)})
          </div>
          <button onClick={handleActivate} disabled={activating}
            className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors bg-orange-500 hover:bg-orange-400 text-white disabled:bg-zinc-700 disabled:text-zinc-500 disabled:cursor-not-allowed">
            {activating ? <><Refresh className="w-4 h-4 animate-spin" /> Deploying Vault...</> : <><Rocket className="w-4 h-4" /> Activate Smart Wallet</>}
          </button>
          <p className="text-[10px] text-zinc-500 text-center">One-time setup · Gas paid from your EOA wallet</p>
        </div>
      )}

      {isDeployed && (
        <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-4 space-y-2">
          <p className="text-sm font-semibold text-green-400 flex items-center gap-2">
            <Check className="w-4 h-4" /> Smart Wallet Active
            {vaultVersion && <span className="text-[9px] font-normal text-green-600">({vaultVersion === "v1" ? "Light Account v1.1" : "Light Account v2.0"})</span>}
          </p>
          <p className="text-xs text-zinc-400">Send dust tokens to the vault address above. Once received, batch swap everything from the Swap tab.</p>
        </div>
      )}

      {/* ── GM ── */}
      <div className="pt-4 mt-6 border-t border-zinc-100 dark:border-zinc-800">
        <button
          onClick={handleSayGM}
          disabled={sendingGM || !isDeployed || gmDone}
          className="w-full py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 transition-all
            bg-gradient-to-r from-blue-400 to-cyan-500 hover:from-blue-500 hover:to-cyan-600
            hover:scale-[1.02] active:scale-[0.98] text-white shadow-lg shadow-blue-500/30
            disabled:grayscale disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
        >
          {sendingGM ? (
            <><Refresh className="w-6 h-6 animate-spin" /> Sending GM...</>
          ) : gmDone ? (
            <span className="flex flex-col items-center gap-0.5 leading-tight">
              <span className="text-base">GM sent today ✓</span>
              <span className="text-xs font-mono font-normal opacity-80">Next GM in {gmCountdown}</span>
            </span>
          ) : <> GM</>}
        </button>
        <p className="text-[10px] text-zinc-500 text-center mt-2 italic">
          {gmDone
            ? "Resets at 00:00 UTC · Once per day"
            : `On-chain · Base · ~$0.0001 gas · ${GM_CONTRACT_ADDRESS.slice(0, 6)}...${GM_CONTRACT_ADDRESS.slice(-4)}`}
        </p>
      </div>
    </div>
  );
};
