"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount, useWriteContract, useSwitchChain } from "wagmi";
import { publicClient } from "~/lib/eoa-smart-account"; 
import { alchemy } from "~/lib/alchemy";
import { formatUnits, encodeFunctionData, erc20Abi, type Address, formatEther } from "viem";
import { base } from "viem/chains"; 
import { Copy, Wallet, Rocket, Check, Dollar, Refresh, Gas, User, NavArrowLeft, NavArrowRight, Download, WarningTriangle } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";
import { fetchMoralisTokens, type MoralisToken } from "~/lib/moralis-data";
import { useFrameContext } from "~/components/providers/frame-provider";
import { getZeroDevSmartAccountClient } from "~/lib/zerodev-smart-account";
import { getCoinbaseSmartAccountClient } from "~/lib/smart-account";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; 
const ITEMS_PER_PAGE = 10; 

// Helper Pagination Ringkas
const generatePagination = (current: number, total: number) => {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | string)[] = [1];
  if (current > 3) pages.push("..."); 
  let start = Math.max(2, current - 1);
  let end = Math.min(total - 1, current + 1);
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
  const sources = [token.logo, `https://tokens.1inch.io/${token.contractAddress || token.token_address}.png`].filter(Boolean);
  return <img src={src || sources[0] || "https://via.placeholder.com/30"} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />;
};

export const VaultView = () => {
  const { data: walletClient } = useWalletClient();
  const { address: ownerAddress, connector, chainId } = useAccount(); 
  const { writeContractAsync } = useWriteContract(); 
  const { switchChainAsync } = useSwitchChain();     
  const frameContext = useFrameContext();
  
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [ethBalance, setEthBalance] = useState("0");
  const [usdcBalance, setUsdcBalance] = useState<any>(null);
  const [tokens, setTokens] = useState<any[]>([]); 
  const [ownerTokens, setOwnerTokens] = useState<MoralisToken[]>([]); 
  
  // [FIXED] Tambahkan kembali state isDeployed yang hilang
  const [isDeployed, setIsDeployed] = useState(false);

  // Legacy Recovery State
  const [legacyTokens, setLegacyTokens] = useState<any[]>([]);
  const [legacyAddress, setLegacyAddress] = useState<string | null>(null);
  const [isCheckingLegacy, setIsCheckingLegacy] = useState(false);

  const [loading, setLoading] = useState(false); 
  const [loadingOwnerTokens, setLoadingOwnerTokens] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null); 
  const [toast, setToast] = useState<{ msg: string, type: "success" | "error" } | null>(null);
  
  const [currentPage, setCurrentPage] = useState(1);       
  const [currentOwnerPage, setCurrentOwnerPage] = useState(1); 

  // 1. FETCH MAIN VAULT (Coinbase Factory - SYSTEM BARU)
  const fetchVaultData = async () => {
    if (!walletClient) return;
    setLoading(true);
    try {
      const client = await getCoinbaseSmartAccountClient(walletClient);
      const addr = client.account.address;

      const bal = await publicClient.getBalance({ address: addr });
      const code = await publicClient.getBytecode({ address: addr });

      setVaultAddress(addr);
      setEthBalance(formatEther(bal));
      // [FIXED] Update status deployed
      setIsDeployed(code !== undefined && code !== null && code !== "0x");

      const balances = await alchemy.core.getTokenBalances(addr);
      const nonZeroTokens = balances.tokenBalances.filter(t => t.tokenBalance && BigInt(t.tokenBalance) > 0n);
      const metadata = await Promise.all(nonZeroTokens.map(t => alchemy.core.getTokenMetadata(t.contractAddress)));

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

      others.sort((a, b) => parseFloat(b.formattedBal) - parseFloat(a.formattedBal));

      setUsdcBalance(usdc || null);
      setTokens(others);
      setCurrentPage(1); 

    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  // 2. [DARURAT] FETCH LEGACY VAULT (ZeroDev - SYSTEM LAMA)
  const checkLegacyVault = async () => {
    if (!walletClient) return;
    setIsCheckingLegacy(true);
    try {
        const legacyClient = await getZeroDevSmartAccountClient(walletClient);
        const addr = legacyClient.account.address;
        setLegacyAddress(addr);

        const balances = await alchemy.core.getTokenBalances(addr);
        const foundTokens = balances.tokenBalances.filter(t => t.tokenBalance && BigInt(t.tokenBalance) > 0n);
        
        if (foundTokens.length > 0) {
            const metadata = await Promise.all(foundTokens.map(t => alchemy.core.getTokenMetadata(t.contractAddress)));
            const formatted = foundTokens.map((t, i) => ({
                ...t,
                symbol: metadata[i].symbol,
                decimals: metadata[i].decimals || 18,
                rawBalance: t.tokenBalance,
                formattedBal: formatUnits(BigInt(t.tokenBalance || 0), metadata[i].decimals || 18)
            }));
            setLegacyTokens(formatted);
        } else {
            setLegacyTokens([]); 
        }
    } catch (e) { console.error("Legacy Check Error:", e); }
    finally { setIsCheckingLegacy(false); }
  };

  // 3. FETCH OWNER DATA (Moralis)
  const fetchOwnerData = async () => {
    if (!ownerAddress) return;
    setLoadingOwnerTokens(true);
    try {
        const data = await fetchMoralisTokens(ownerAddress);
        const activeTokens = data.filter(t => BigInt(t.balance) > 0n);
        activeTokens.sort((a, b) => parseFloat(formatUnits(BigInt(b.balance), b.decimals)) - parseFloat(formatUnits(BigInt(a.balance), a.decimals)));
        setOwnerTokens(activeTokens);
        setCurrentOwnerPage(1); 
    } catch (e) { console.error("Gagal fetch Moralis:", e); } finally { setLoadingOwnerTokens(false); }
  };

  useEffect(() => { 
      if(walletClient) {
          fetchVaultData(); 
          checkLegacyVault(); 
      }
  }, [walletClient]); 
  
  useEffect(() => { if(ownerAddress) fetchOwnerData(); }, [ownerAddress]);

  const ensureNetwork = async () => {
      if (chainId !== base.id) {
          try { await switchChainAsync({ chainId: base.id }); } 
          catch (e) { setToast({ msg: "Switch to Base Mainnet first!", type: "error" }); throw new Error("Wrong Network"); }
      }
  };

  // WITHDRAW DARI VAULT UTAMA (NO RAW SIGN)
  const handleWithdraw = async (token?: any) => {
    if (!walletClient || !ownerAddress || !vaultAddress) return;
    if (!window.confirm(`Withdraw ${token?.symbol || "ETH"}?`)) return;

    try {
      await ensureNetwork(); 
      setActionLoading(`Withdrawing...`); 
      
      const transferData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [ownerAddress as Address, BigInt(token.rawBalance)]
      });

      const client = await getCoinbaseSmartAccountClient(walletClient);

      const txHash = await client.sendUserOperation({
          account: client.account!,
          calls: [{ to: token.contractAddress as Address, value: 0n, data: transferData }]
      });

      console.log("UserOp Hash:", txHash);
      setToast({ msg: "Withdraw Processed!", type: "success" });
      
      await new Promise(r => setTimeout(r, 5000));
      await client.waitForUserOperationReceipt({ hash: txHash });
      await fetchVaultData();

    } catch (e: any) { 
        console.error(e);
        setToast({ msg: "Failed: " + (e.shortMessage || e.message), type: "error" });
    } finally { setActionLoading(null); }
  };

  // [DARURAT] RECOVER DARI VAULT LAMA (RAW SIGN OK)
  const handleLegacyRecover = async (token: any) => {
      if (!walletClient || !ownerAddress) return;
      if (!window.confirm(`⚠️ RECOVERY MODE\n\nAnda akan menarik ${token.symbol} dari Vault Lama (ZeroDev).\nDompet Anda (Rabby/Metamask) mungkin menampilkan peringatan "Raw Sign" atau "Blind Sign".\n\nLanjutkan?`)) return;

      try {
          await ensureNetwork();
          setActionLoading("Recovering Legacy Assets...");

          const legacyClient = await getZeroDevSmartAccountClient(walletClient);
          
          const transferData = encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [ownerAddress as Address, BigInt(token.rawBalance)]
          });

          const userOpHash = await legacyClient.sendUserOperation({
              account: legacyClient.account!,
              calls: [{ to: token.contractAddress as Address, value: 0n, data: transferData }]
          });

          console.log("Legacy Recovery Hash:", userOpHash);
          setToast({ msg: "Recovery Sent!", type: "success" });

          await new Promise(r => setTimeout(r, 8000));
          await checkLegacyVault(); // Refresh Legacy
          await fetchOwnerData(); // Refresh Owner

      } catch (e: any) {
          console.error(e);
          setToast({ msg: "Recovery Failed: " + (e.shortMessage || e.message), type: "error" });
      } finally {
          setActionLoading(null);
      }
  };

  // DEPOSIT (Owner -> Main Vault)
  const handleDeposit = async (token: MoralisToken) => {
    if (!walletClient || !ownerAddress || !vaultAddress) return;
    if (!window.confirm(`Deposit ${token.symbol} ke Vault?`)) return;

    try {
      await ensureNetwork();
      setActionLoading(`Depositing ${token.symbol}...`);

      const txHash = await writeContractAsync({
        address: token.token_address as Address, 
        abi: erc20Abi,
        functionName: "transfer",
        args: [vaultAddress as Address, BigInt(token.balance)], 
        chainId: base.id,
      });

      setToast({ msg: "Deposit Sent! Updating...", type: "success" });
      await new Promise(resolve => setTimeout(resolve, 10000));
      await Promise.all([ fetchVaultData(), fetchOwnerData() ]);

    } catch (e: any) {
      console.error(e);
      setToast({ msg: "Deposit Failed: " + (e.shortMessage || e.message), type: "error" });
    } finally { setActionLoading(null); }
  };
  
  const currentTokens = tokens.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const currentOwnerTokens = ownerTokens.slice((currentOwnerPage - 1) * ITEMS_PER_PAGE, currentOwnerPage * ITEMS_PER_PAGE);
  const totalPages = Math.ceil(tokens.length / ITEMS_PER_PAGE);
  const totalOwnerPages = Math.ceil(ownerTokens.length / ITEMS_PER_PAGE);

  return (
    <div className="pb-28 space-y-6 relative min-h-[50vh]">
      <SimpleToast message={toast?.msg || null} type={toast?.type} onClose={() => setToast(null)} />

      {actionLoading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
           <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <div className="text-sm font-bold text-center animate-pulse">{actionLoading}</div>
           </div>
        </div>
      )}

      {/* --- PANEL DARURAT (LEGACY RECOVERY) --- */}
      {legacyTokens.length > 0 && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 animate-in slide-in-from-top-5">
              <div className="flex items-center gap-2 mb-3">
                  <WarningTriangle className="w-5 h-5 text-red-600" />
                  <h3 className="font-bold text-red-700 dark:text-red-400 text-sm">Legacy Assets Found</h3>
              </div>
              <p className="text-xs text-red-600/80 mb-3">
                  Ditemukan aset di sistem lama (ZeroDev/EOA). Silakan recover ke dompet utama.
                  <br/><span className="font-mono opacity-70">{legacyAddress?.slice(0,6)}...{legacyAddress?.slice(-4)}</span>
              </p>
              <div className="space-y-2">
                  {legacyTokens.map((t, i) => (
                      <div key={i} className="flex justify-between items-center bg-white dark:bg-zinc-900 p-2 rounded-lg border border-red-100">
                          <div className="text-xs font-bold">{t.symbol} <span className="font-normal text-zinc-500">({parseFloat(t.formattedBal).toFixed(4)})</span></div>
                          <button onClick={() => handleLegacyRecover(t)} className="bg-red-600 hover:bg-red-700 text-white text-[10px] px-3 py-1.5 rounded-md font-bold transition-colors">
                              Recover
                          </button>
                      </div>
                  ))}
              </div>
          </div>
      )}

      {/* HEADER CARD (MAIN SYSTEM) */}
      <div className="p-5 bg-zinc-900 text-white rounded-2xl shadow-lg relative overflow-hidden">
        <div className={`absolute top-4 right-4 text-[10px] px-2 py-1 rounded-full border font-medium flex items-center gap-1 ${isDeployed ? "bg-green-500/20 border-green-500 text-green-400" : "bg-orange-500/20 border-orange-500 text-orange-400"}`}>
           {isDeployed ? <Check className="w-3 h-3" /> : <Rocket className="w-3 h-3" />}
           {isDeployed ? "Active" : "Inactive"}
        </div>
        <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
            <Wallet className="w-3 h-3" /> Smart Vault (Coinbase/Safe)
        </div>
        <div className="flex items-center justify-between mb-4">
            <code className="text-sm truncate max-w-[180px] opacity-80">{vaultAddress || "Loading..."}</code>
            <button onClick={() => vaultAddress && navigator.clipboard.writeText(vaultAddress)}><Copy className="w-4 h-4 hover:text-blue-400" /></button>
        </div>
        <div className="mt-4 space-y-3">
             <div className="flex items-center justify-between bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-400"><Gas className="w-5 h-5" /></div>
                    <div><div className="text-xs text-zinc-400">Gas Reserve (ETH)</div><div className="text-lg font-bold">{parseFloat(ethBalance).toFixed(5)}</div></div>
                </div>
             </div>
             <div className="flex items-center justify-between bg-blue-900/20 p-3 rounded-xl border border-blue-500/30">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white"><Dollar className="w-5 h-5" /></div>
                    <div><div className="text-xs text-blue-300">USDC Savings</div><div className="text-lg font-bold text-blue-100">{usdcBalance ? parseFloat(usdcBalance.formattedBal).toFixed(2) : "0.00"}</div></div>
                </div>
                {usdcBalance && parseFloat(usdcBalance.formattedBal) > 0 && (
                    <button onClick={() => handleWithdraw(usdcBalance)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-blue-900/20 transition-all flex items-center gap-1">Withdraw</button>
                )}
             </div>
        </div>
      </div>

      {/* --- VAULT ASSETS (PAGINATED) --- */}
      <div>
        <div className="flex items-center justify-between px-1 mb-2">
            <h3 className="font-semibold text-lg flex items-center gap-2"><Wallet className="w-5 h-5 text-blue-500"/> Vault Assets</h3>
            <button onClick={fetchVaultData} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:rotate-180 transition-all duration-500"><Refresh className="w-4 h-4 text-zinc-500" /></button>
        </div>
        <div className="space-y-2 min-h-[100px]">
          {tokens.length === 0 ? (
             <div className="text-center py-10 text-zinc-400 text-sm border border-dashed border-zinc-700 rounded-xl">{usdcBalance ? "No other assets." : "Vault is empty."}</div>
          ) : currentTokens.map((token, i) => (
            <div key={i} className="flex items-center justify-between p-3 border border-zinc-100 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 shadow-sm">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center shrink-0 overflow-hidden"><TokenLogo token={token} /></div>
                    <div><div className="font-semibold text-sm truncate max-w-[100px]">{token.symbol}</div><div className="text-xs text-zinc-500">{parseFloat(token.formattedBal).toFixed(4)}</div></div>
                </div>
                <button onClick={() => handleWithdraw(token)} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">WD</button>
            </div>
          ))}
        </div>
        
        {/* Pagination Vault */}
        {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-4 pb-2">
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))} className="p-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 disabled:opacity-30"><NavArrowLeft className="w-4 h-4" /></button>
              {generatePagination(currentPage, totalPages).map((page, idx) => (
                <button key={idx} disabled={typeof page !== 'number'} onClick={() => typeof page === 'number' && setCurrentPage(page)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold border ${currentPage === page ? "bg-blue-600 text-white border-blue-600 shadow-md scale-110" : typeof page === 'number' ? "bg-white dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50" : "border-transparent text-zinc-400"}`}>
                  {page}
                </button>
              ))}
              <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} className="p-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 disabled:opacity-30"><NavArrowRight className="w-4 h-4" /></button>
            </div>
        )}
      </div>

      {/* --- OWNER ASSETS (PAGINATED) --- */}
      <div>
        <div className="flex items-center justify-between px-1 mb-2 mt-6 border-t pt-4 border-zinc-800">
            <h3 className="font-semibold text-lg flex items-center gap-2"><User className="w-5 h-5 text-green-600 dark:text-green-500"/> Owner Wallet</h3>
            <button onClick={fetchOwnerData} className="text-xs text-green-600 hover:underline">Scan Moralis</button>
        </div>
        <div className="space-y-2">
            {loadingOwnerTokens ? <div className="text-center py-4 text-zinc-500 animate-pulse text-sm">Scanning...</div> : 
             ownerTokens.length === 0 ? <div className="text-center py-4 text-zinc-400 text-sm">No assets found.</div> :
             currentOwnerTokens.map((token, i) => (
                <div key={i} className="flex items-center justify-between p-3 border border-green-200 dark:border-green-800 rounded-xl bg-green-50/80 dark:bg-green-900/10 shadow-sm">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-10 h-10 rounded-full bg-white dark:bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden border border-green-100 dark:border-green-900">
                            {token.logo ? <img src={token.logo} className="w-full h-full object-cover"/> : <div className="text-xs font-bold text-green-600">?</div>}
                        </div>
                        <div>
                            <div className="font-semibold text-sm text-green-900 dark:text-green-100 truncate max-w-[100px]">{token.symbol}</div>
                            <div className="text-xs text-green-700 dark:text-green-400/80">{parseFloat(formatUnits(BigInt(token.balance), token.decimals)).toFixed(4)}</div>
                        </div>
                    </div>
                    <button onClick={() => handleDeposit(token)} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-green-300 text-green-700 hover:bg-green-100 transition-colors flex items-center gap-1">
                        <Download className="w-3 h-3"/> Deposit
                    </button>
                </div>
            ))}
        </div>
        
        {/* Pagination Owner */}
        {totalOwnerPages > 1 && (
            <div className="flex items-center justify-center gap-1 pt-4 pb-2">
              <button disabled={currentOwnerPage === 1} onClick={() => setCurrentOwnerPage(p => Math.max(1, p - 1))} className="p-2 rounded-lg bg-white border hover:bg-zinc-100"><NavArrowLeft className="w-4 h-4" /></button>
              {generatePagination(currentOwnerPage, totalOwnerPages).map((page, idx) => (
                <button key={idx} disabled={typeof page !== 'number'} onClick={() => typeof page === 'number' && setCurrentOwnerPage(page)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold border ${currentOwnerPage === page ? "bg-green-600 text-white" : "bg-white text-zinc-500"}`}>
                  {page}
                </button>
              ))}
              <button disabled={currentOwnerPage === totalOwnerPages} onClick={() => setCurrentOwnerPage(p => Math.min(totalOwnerPages, p + 1))} className="p-2 rounded-lg bg-white border hover:bg-zinc-100"><NavArrowRight className="w-4 h-4" /></button>
            </div>
        )}
      </div>
      
    </div>
  );
};