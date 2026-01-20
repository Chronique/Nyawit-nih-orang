"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount } from "wagmi";
import { getSmartAccountClient, publicClient } from "~/lib/smart-account";
import { alchemy } from "~/lib/alchemy";
import { formatEther, formatUnits, encodeFunctionData, erc20Abi, type Address } from "viem";
import { Copy, Wallet, ArrowRight, Refresh, Rocket, Check, Dollar, NavArrowLeft, NavArrowRight } from "iconoir-react";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ITEMS_PER_PAGE = 5; 

// --- KOMPONEN LOGO ---
const TokenLogo = ({ token }: { token: any }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { setSrc(token.logo || null); }, [token]);

  const sources = [
    token.logo,
    `https://tokens.1inch.io/${token.contractAddress}.png`,
    `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${token.contractAddress}/logo.png`
  ].filter(Boolean);

  if (!src && sources.length === 0) return <div className="text-xs font-bold">?</div>;

  return (
    <img 
      src={src || sources[1] || sources[2]} 
      className="w-full h-full object-cover"
      onError={(e) => {
        const t = e.target as HTMLImageElement;
        if (t.src === sources[0] && sources[1]) t.src = sources[1];
        else if (t.src === sources[1] && sources[2]) t.src = sources[2];
        else t.style.display = 'none';
      }}
    />
  );
};

// 🔥 PASTIKAN NAMA EXPORT INI ADALAH 'VaultView'
export const VaultView = () => {
  const { data: walletClient } = useWalletClient();
  const { address: ownerAddress } = useAccount(); 
  
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [ethBalance, setEthBalance] = useState("0");
  const [usdcBalance, setUsdcBalance] = useState<any>(null);
  
  const [tokens, setTokens] = useState<any[]>([]);
  const [isDeployed, setIsDeployed] = useState(false);
  const [loading, setLoading] = useState(false); 
  const [actionLoading, setActionLoading] = useState<string | null>(null); 
  
  const [currentPage, setCurrentPage] = useState(1);

  const fetchVaultData = async () => {
    if (!walletClient) return;
    setLoading(true);
    try {
      const client = await getSmartAccountClient(walletClient);
      if (!client.account) return;

      const address = client.account.address;
      setVaultAddress(address);

      const bal = await publicClient.getBalance({ address });
      setEthBalance(formatEther(bal));

      const code = await publicClient.getBytecode({ address });
      setIsDeployed(code !== undefined && code !== null && code !== "0x");

      const balances = await alchemy.core.getTokenBalances(address);
      const nonZeroTokens = balances.tokenBalances.filter(t => 
          t.tokenBalance && BigInt(t.tokenBalance) > 0n
      );

      const metadata = await Promise.all(
          nonZeroTokens.map(t => alchemy.core.getTokenMetadata(t.contractAddress))
      );

      const formatted = nonZeroTokens.map((t, i) => {
          const meta = metadata[i];
          return {
              ...t,
              name: meta.name,
              symbol: meta.symbol,
              logo: meta.logo,
              contractAddress: t.contractAddress,
              decimals: meta.decimals || 18,
              rawBalance: t.tokenBalance,
              formattedBal: formatUnits(BigInt(t.tokenBalance || 0), meta.decimals || 18)
          };
      });

      const usdc = formatted.find(t => t.contractAddress.toLowerCase() === USDC_ADDRESS.toLowerCase());
      const others = formatted.filter(t => t.contractAddress.toLowerCase() !== USDC_ADDRESS.toLowerCase());

      setUsdcBalance(usdc || null);
      setTokens(others);
      setCurrentPage(1); 

    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchVaultData();
  }, [walletClient]);

  const handleWithdraw = async (token?: any) => {
    if (!walletClient || !ownerAddress) return;
    const name = !token ? "ETH" : token.symbol;
    if (!window.confirm(`Withdraw ${name} ke wallet utama?`)) return;

    try {
      setActionLoading(`Withdrawing ${name}...`); 
      const client = await getSmartAccountClient(walletClient);
      if (!client.account) throw new Error("Akun error");

      let callData: any;
      if (!token) {
        const balance = await publicClient.getBalance({ address: client.account.address });
        callData = { to: ownerAddress, value: balance, data: "0x" };
      } else {
        callData = {
          to: token.contractAddress as Address,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [ownerAddress, token.rawBalance]
          })
        };
      }

      await client.sendUserOperation({
        account: client.account,
        calls: [callData]
      });

      await new Promise(resolve => setTimeout(resolve, 5000));
      await fetchVaultData();
    } catch (e: any) { alert(`Gagal: ${e.message}`); } finally { setActionLoading(null); }
  };

  const totalPages = Math.ceil(tokens.length / ITEMS_PER_PAGE);
  const currentTokens = tokens.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  return (
    <div className="pb-20 space-y-4 relative min-h-[50vh]">
      {actionLoading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
           <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <div className="text-sm font-bold text-center animate-pulse">{actionLoading}</div>
           </div>
        </div>
      )}

      {/* HEADER CARD */}
      <div className="p-5 bg-zinc-900 text-white rounded-2xl shadow-lg relative overflow-hidden">
        <div className={`absolute top-4 right-4 text-[10px] px-2 py-1 rounded-full border font-medium flex items-center gap-1 ${isDeployed ? "bg-green-500/20 border-green-500 text-green-400" : "bg-orange-500/20 border-orange-500 text-orange-400"}`}>
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

        {/* --- WITHDRAW SECTION --- */}
        <div className="mt-4 space-y-3">
          {/* 1. ETH WITHDRAW */}
          <div className="flex items-center justify-between bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50">
             <div>
                <div className="text-xs text-zinc-400">ETH Balance</div>
                <div className="text-lg font-bold">{parseFloat(ethBalance).toFixed(5)}</div>
             </div>
             {isDeployed && parseFloat(ethBalance) > 0.00001 && (
                <button onClick={() => handleWithdraw()} className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-xs font-medium transition-all">
                  Withdraw
                </button>
             )}
          </div>

          {/* 2. USDC WITHDRAW */}
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
             {isDeployed && usdcBalance && parseFloat(usdcBalance.formattedBal) > 0 && (
                <button 
                  onClick={() => handleWithdraw(usdcBalance)} 
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-blue-900/20 transition-all"
                >
                  Withdraw
                </button>
             )}
          </div>
          
          {/* NOTICE IF NOT DEPLOYED */}
          {!isDeployed && (
             <div className="text-[10px] text-orange-400 text-center mt-2 bg-orange-900/20 p-2 rounded-lg border border-orange-500/20">
               ⚠️ Vault belum aktif. Silakan ke tab <b>Deposit</b> untuk aktivasi gratis.
             </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <h3 className="font-semibold">Dust Assets ({tokens.length})</h3>
        <button onClick={fetchVaultData} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:rotate-180 transition-all duration-500">
           <Refresh className="w-4 h-4 text-zinc-500" />
        </button>
      </div>
      
      {/* ASSET LIST WITH PAGINATION */}
      <div className="space-y-2 min-h-[300px]">
        {tokens.length === 0 ? (
           <div className="text-center py-10 text-zinc-400 text-sm">Vault kosong.</div>
        ) : (
          currentTokens.map((token, i) => (
            <div key={i} className="flex items-center justify-between p-3 border border-zinc-100 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 shadow-sm animate-in slide-in-from-bottom-2">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center shrink-0 overflow-hidden">
                        <TokenLogo token={token} />
                    </div>
                    <div>
                        <div className="font-semibold text-sm">{token.symbol}</div>
                        <div className="text-xs text-zinc-500">{token.formattedBal}</div>
                    </div>
                </div>
                <button 
                  onClick={() => handleWithdraw(token)}
                  disabled={!isDeployed}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${!isDeployed ? "bg-zinc-100 text-zinc-400" : "text-blue-600 bg-blue-50 hover:bg-blue-100"}`}
                >
                  WD
                </button>
            </div>
          ))
        )}
      </div>

      {/* PAGINATION CONTROLS */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-4 border-t">
          <button 
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            className="p-2 rounded-full hover:bg-zinc-100 disabled:opacity-30"
          >
            <NavArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-zinc-500">
            Page {currentPage} of {totalPages}
          </span>
          <button 
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            className="p-2 rounded-full hover:bg-zinc-100 disabled:opacity-30"
          >
            <NavArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
};