"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount } from "wagmi";
import { Copy, Refresh, ShieldCheck, User, Rocket } from "iconoir-react";

import { getUnifiedSmartAccountClient } from "~/lib/smart-account-switcher";
import { publicClient } from "~/lib/smart-account";
import { useFrameContext } from "~/components/providers/frame-provider";
import { SimpleToast } from "~/components/ui/simple-toast";
import { SimpleAccountDeposit } from "./simple-account-deposit";
import { TokenList } from "./token-list";

export const DustDepositView = () => {
  const { data: walletClient } = useWalletClient();
  const { address: ownerAddress } = useAccount();
  const frameContext = useFrameContext();

  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [isDeployed, setIsDeployed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const refreshStatus = async () => {
    if (!walletClient) return;
    setLoading(true);
    try {
      const client = await getUnifiedSmartAccountClient(walletClient, undefined);
      const addr = client.account.address;
      setVaultAddress(addr);

      // Cek apakah kontrak sudah di-deploy (aktif)
      const code = await publicClient.getBytecode({ address: addr });
      setIsDeployed(code !== undefined && code !== null && code !== "0x");
    } catch (e) {
      console.error("Status Check Error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (walletClient) refreshStatus();
  }, [walletClient]);

  // ── Aktivasi Smart Wallet via UserOp ──────────────────────────────────────
  // Kirim dummy UserOp (0 ETH ke diri sendiri) untuk men-deploy kontrak smart wallet
  // Ini memicu factory untuk deploy CoinbaseSmartAccount di-chain
  const handleActivate = async () => {
    if (!walletClient || !vaultAddress) return;
    setActivating(true);
    try {
      const client = await getUnifiedSmartAccountClient(walletClient, undefined);

      setToast({ msg: "Deploying Smart Wallet... please sign", type: "success" });

      const txHash = await client.sendUserOperation({
        calls: [
          {
            // Kirim 0 ETH ke vault address sendiri — cukup untuk deploy kontrak
            to: vaultAddress as `0x${string}`,
            value: 0n,
            data: "0x",
          },
        ],
      });

      setToast({ msg: "Activation sent! Waiting for confirmation...", type: "success" });
      await client.waitForUserOperationReceipt({ hash: txHash });

      setToast({ msg: "Smart Wallet activated! ✅", type: "success" });
      await refreshStatus();
    } catch (e: any) {
      console.error("Activation Error:", e);
      setToast({
        msg: "Activation Failed: " + (e.shortMessage || e.message),
        type: "error",
      });
    } finally {
      setActivating(false);
    }
  };

  if (!walletClient) {
    return (
      <div className="text-center py-20 text-zinc-500 animate-pulse">
        Initializing Wallet...
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto pb-24">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      {/* HEADER */}
      <div className="text-center mb-6 pt-4 space-y-4">

        {/* VAULT ADDRESS */}
        <div>
          <div className="flex justify-center mb-2">
            <div className="px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-bold flex items-center gap-1.5 border border-blue-200 dark:border-blue-800">
              <ShieldCheck className="w-3 h-3" /> Unified Vault
            </div>
          </div>
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">
            Active Vault Address
          </div>
          <div className="text-xl font-mono font-bold flex justify-center items-center gap-2">
            {loading ? (
              <Refresh className="w-5 h-5 animate-spin" />
            ) : vaultAddress ? (
              vaultAddress.slice(0, 6) + "..." + vaultAddress.slice(-4)
            ) : (
              "..."
            )}
            {vaultAddress && (
              <Copy
                className="w-4 h-4 text-zinc-500 cursor-pointer hover:text-white"
                onClick={() => navigator.clipboard.writeText(vaultAddress)}
              />
            )}
          </div>

          {/* STATUS BADGE */}
          <div className="flex justify-center mt-2">
            <div
              className={`text-[10px] px-2 py-1 rounded-full border font-medium flex items-center gap-1 ${
                isDeployed
                  ? "bg-green-500/20 border-green-500 text-green-600 dark:text-green-400"
                  : "bg-orange-500/20 border-orange-500 text-orange-600 dark:text-orange-400"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${isDeployed ? "bg-green-500" : "bg-orange-500"}`} />
              {isDeployed ? "Smart Wallet Active" : "Smart Wallet Inactive"}
            </div>
          </div>
        </div>

        {/* OWNER ADDRESS (DEBUG) */}
        <div className="bg-zinc-100 dark:bg-zinc-900/50 rounded-lg p-2 max-w-[200px] mx-auto border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-500 mb-1">
            <User className="w-3 h-3" /> Owner (Signer) Address
          </div>
          <div className="font-mono text-xs text-zinc-700 dark:text-zinc-400 break-all">
            {ownerAddress
              ? ownerAddress.slice(0, 6) + "..." + ownerAddress.slice(-4)
              : "Not Connected"}
          </div>
        </div>

        {/* TOMBOL AKTIVASI — hanya muncul kalau belum aktif */}
        {!isDeployed && vaultAddress && (
          <div className="max-w-xs mx-auto">
            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-4 space-y-3">
              <div className="text-xs text-orange-700 dark:text-orange-300 text-center leading-relaxed">
                <strong>Smart Wallet belum aktif.</strong>
                <br />
                Aktivasi dulu agar bisa menerima UserOp dan swap dust.
                <br />
                <span className="text-[10px] opacity-70">
                  (Kamu butuh sedikit ETH di vault untuk gas pertama)
                </span>
              </div>
              <button
                onClick={handleActivate}
                disabled={activating}
                className="w-full py-2.5 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
              >
                {activating ? (
                  <>
                    <Refresh className="w-4 h-4 animate-spin" />
                    Activating...
                  </>
                ) : (
                  <>
                    <Rocket className="w-4 h-4" />
                    Activate Smart Wallet
                  </>
                )}
              </button>
              <p className="text-[10px] text-center text-zinc-400">
                Proses ini men-deploy kontrak wallet kamu on-chain via UserOp
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="animate-in fade-in duration-500">
        {/* DEPOSIT FORM */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm mb-6">
          <h3 className="text-sm font-bold mb-4 text-zinc-800 dark:text-white flex items-center gap-2">
            Deposit Asset
          </h3>
          <SimpleAccountDeposit
            vaultAddress={vaultAddress}
            isDeployed={isDeployed}
            onUpdate={refreshStatus}
          />
        </div>

        {/* TOKEN LIST */}
        <TokenList address={vaultAddress} />
      </div>
    </div>
  );
};
