"use client";

import { useEffect, useState } from "react";
import { Refresh, Coins } from "iconoir-react";

interface TokenData {
  name: string;
  symbol: string;
  balance: string;
  logo?: string;
  contract: string;
}

export const TokenList = ({ address }: { address: string | null }) => {
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTokens = async () => {
    if (!address) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tokens?address=${address}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setTokens(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (address) fetchTokens();
  }, [address]);

  if (!address) return null;

  return (
    <div className="mt-6 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950">
        <h3 className="text-sm font-bold text-zinc-300 flex items-center gap-2">
          <Coins className="w-4 h-4 text-yellow-500"/> Assets in the Vault
        </h3>
        <button 
          onClick={fetchTokens} 
          disabled={loading}
          className="p-1.5 hover:bg-zinc-800 rounded-lg transition-all"
        >
          <Refresh className={`w-4 h-4 text-zinc-500 ${loading ? "animate-spin" : ""}`}/>
        </button>
      </div>

      {/* List */}
      <div className="p-2">
        {loading ? (
            <div className="p-8 text-center text-xs text-zinc-500 animate-pulse">Scanning Blockchain...</div>
        ) : tokens.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">No tokens (ETH only)</div>
        ) : (
            <div className="space-y-1">
                {tokens.map((token, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 hover:bg-zinc-800/50 rounded-xl transition-all">
                        <div className="flex items-center gap-3">
                            {token.logo ? (
                                <img src={token.logo} alt={token.symbol} className="w-8 h-8 rounded-full"/>
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-bold">
                                    {token.symbol[0]}
                                </div>
                            )}
                            <div>
                                <div className="text-sm font-bold text-white">{token.symbol}</div>
                                <div className="text-[10px] text-zinc-500">{token.name}</div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-sm font-mono text-white">{token.balance}</div>
                        </div>
                    </div>
                ))}
            </div>
        )}
      </div>
    </div>
  );
};