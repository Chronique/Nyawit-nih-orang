"use client";

import { useAccount, useDisconnect } from "wagmi";
import { LogOut } from "iconoir-react";

export const AuthButton = () => {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  if (!isConnected || !address) return null;

  return (
    <button
      onClick={() => disconnect()}
      className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-full text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all group"
    >
      <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
      <span className="font-mono">
        {address.slice(0, 4)}...{address.slice(-4)}
      </span>
      <LogOut className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 -ml-2 group-hover:ml-0 transition-all" />
    </button>
  );
};
