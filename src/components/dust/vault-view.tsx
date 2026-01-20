"use client";

import { useEffect, useState } from "react";
import { useWalletClient } from "wagmi";
import { getSmartAccountClient, publicClient } from "~/lib/smart-account";
import { alchemy } from "~/lib/alchemy";
import { formatEther } from "viem";
import { Copy, Wallet } from "iconoir-react";

export const VaultView = () => {
  const { data: walletClient } = useWalletClient();
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [ethBalance, setEthBalance] = useState("0");
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchVaultData = async () => {
      if (!walletClient) return;
      setLoading(true);
      try {
        const client = await getSmartAccountClient(walletClient);
        const address = client.account.address;
        setVaultAddress(address);

        const bal = await publicClient.getBalance({ address });
        setEthBalance(formatEther(bal));

        const balances = await alchemy.core.getTokenBalances(address);
        const nonZeroTokens = balances.tokenBalances.filter(t => 
            t.tokenBalance && BigInt(t.tokenBalance) > 0n
        );

        const metadata = await Promise.all(
            nonZeroTokens.map(t => alchemy.core.getTokenMetadata(t.contractAddress))
        );

        const formatted = nonZeroTokens.map((t, i) => {
            const meta = metadata[i];
            const decimals = meta.decimals || 18;
            const raw = BigInt(t.tokenBalance || "0");
            const val = Number(raw) / (10 ** decimals);
            return {
                ...t,
                name: meta.name,
                symbol: meta.symbol,
                logo: meta.logo,
                formattedBal: val.toLocaleString('en-US', { maximumFractionDigits: 4 })
            };
        });

        setTokens(formatted);

      } catch (e) { console.error(e); } finally { setLoading(false); }
    };
    fetchVaultData();
  }, [walletClient]);

  return (
    <div className="pb-20 space-y-4">
      <div className="p-5 bg-zinc-900 text-white rounded-2xl shadow-lg">
        <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
            <Wallet className="w-3 h-3" /> Smart Vault Active
        </div>
        <div className="flex items-center justify-between">
            <code className="text-sm truncate max-w-[200px]">{vaultAddress || "Loading..."}</code>
            <button onClick={() => vaultAddress && navigator.clipboard.writeText(vaultAddress)}>
               <Copy className="w-4 h-4 hover:text-blue-400" />
            </button>
        </div>
        <div className="mt-4 text-2xl font-bold">
            {parseFloat(ethBalance).toFixed(4)} <span className="text-sm font-normal text-zinc-400">ETH</span>
        </div>
      </div>

      <h3 className="font-semibold px-1">Vault Assets</h3>
      
      {loading ? (
        <div className="text-center py-10 text-zinc-400">Loading...</div>
      ) : tokens.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed rounded-xl text-zinc-400">
            Vault kosong. Silakan deposit dulu.
        </div>
      ) : (
        <div className="space-y-2">
            {tokens.map((token, i) => (
                <div key={i} className="flex items-center p-3 border rounded-xl bg-white dark:bg-zinc-900">
                    <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center mr-3 overflow-hidden">
                        {token.logo ? <img src={token.logo} className="w-full" /> : token.symbol?.[0]}
                    </div>
                    <div>
                        <div className="font-semibold text-sm">{token.name}</div>
                        <div className="text-xs text-zinc-500">{token.formattedBal} {token.symbol}</div>
                    </div>
                </div>
            ))}
        </div>
      )}
    </div>
  );
};