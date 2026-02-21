"use client";

import { useConnect } from "wagmi";
import { Wallet, ShieldCheck, Zap } from "lucide-react";

export const WalletConnectPrompt = () => {
  const { connectors, connect } = useConnect();

  const handleConnect = () => {
    // Prefer injected wallet (Rabby/MetaMask), fallback to Coinbase
    const injectedConnector = connectors.find((c) => c.id === "injected");
    const coinbaseConnector = connectors.find((c) =>
      c.name.toLowerCase().includes("coinbase")
    );
    const preferred = injectedConnector ?? coinbaseConnector ?? connectors[0];
    if (preferred) connect({ connector: preferred });
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center space-y-6 animate-in fade-in zoom-in duration-500 max-w-sm mx-auto">
      {/* Icon Group */}
      <div className="flex -space-x-4">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/50 rounded-full flex items-center justify-center border-4 border-white dark:border-zinc-950 z-10">
          <Wallet className="w-8 h-8 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/50 rounded-full flex items-center justify-center border-4 border-white dark:border-zinc-950">
          <ShieldCheck className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-2xl font-bold text-zinc-800 dark:text-white">
          Connect Your Wallet
        </h3>
        <p className="text-zinc-500 text-sm leading-relaxed">
          Connect via <strong>Base App</strong>, <strong>Coinbase Smart Wallet</strong>,
          or <strong>Rabby / MetaMask</strong> to access your Smart Vault.
        </p>
      </div>

      <div className="w-full space-y-3 pt-4">
        <button
          onClick={handleConnect}
          className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          <Zap className="w-4 h-4 fill-current" />
          Connect Now
        </button>

        <p className="text-[10px] text-zinc-400">
          Secure connection via Base Smart Wallet
        </p>
      </div>
    </div>
  );
};
