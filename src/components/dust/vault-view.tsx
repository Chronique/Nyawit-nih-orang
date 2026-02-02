"use client";

import { useEffect, useState } from "react";
import { useWalletClient, useAccount, useWriteContract, useSwitchChain } from "wagmi";
import { getUnifiedSmartAccountClient } from "~/lib/smart-account-switcher";
import { publicClient } from "~/lib/smart-account"; 
import { alchemy } from "~/lib/alchemy";
import { formatUnits, encodeFunctionData, erc20Abi, type Address, formatEther, parseEther } from "viem";
import { base } from "viem/chains"; 
import { Copy, Wallet, Rocket, Check, Dollar, Refresh, Gas, User, NavArrowLeft, NavArrowRight, Download, Upload } from "iconoir-react";
import { SimpleToast } from "~/components/ui/simple-toast";
import { fetchMoralisTokens, type MoralisToken } from "~/lib/moralis-data";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; 
const ITEMS_PER_PAGE = 10; 

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
  const { address: ownerAddress, chainId } = useAccount(); 
  const { writeContractAsync } = useWriteContract(); 
  const { switchChainAsync } = useSwitchChain();     
  
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [ethBalance, setEthBalance] = useState("0");
  const [usdcBalance, setUsdcBalance] = useState<any>(null);
  const [tokens, setTokens] = useState<any[]>([]); 
  const [ownerTokens, setOwnerTokens] = useState<MoralisToken[]>([]); 
  
  const [isDeployed, setIsDeployed] = useState(false);
  const [loading, setLoading] = useState(false); 
  const [loadingOwnerTokens, setLoadingOwnerTokens] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null); 
  const [toast, setToast] = useState<{ msg: string, type: "success" | "error" } | null>(null);
  
  const [currentPage, setCurrentPage] = useState(1);       
  const [currentOwnerPage, setCurrentOwnerPage] = useState(1); 

  const [showEthWithdraw, setShowEthWithdraw] = useState(false);
  const [ethWithdrawAmount, setEthWithdrawAmount] = useState("");

  const fetchVaultData = async () => {
    if (!walletClient) return;
    setLoading(true);
    try {
      const client = await getUnifiedSmartAccountClient(walletClient, undefined);
      const addr = client.account.address;

      const bal = await publicClient.getBalance({ address: addr });
      const code = await publicClient.getBytecode({ address: addr });

      setVaultAddress(addr);
      setEthBalance(formatEther(bal));
      setIsDeployed(code !== undefined && code !== null && code !== "0x");

      // [FIX] ALCHEMY DEBUG & LOOSE FILTER
      const balances = await alchemy.core.getTokenBalances(addr);
      console.log("Alchemy Data:", balances); // Debug log

      const nonZeroTokens = balances.tokenBalances.filter(t => t.tokenBalance && BigInt(t.tokenBalance) > 0n);
      const metadata = await Promise.all(nonZeroTokens.map(t => alchemy.core.getTokenMetadata(t.contractAddress)));

      const formatted = nonZeroTokens.map((t, i) => {
          const meta = metadata[i];
          return {
              ...t,
              name: meta.name || "Unknown",
              symbol: meta.symbol || "???",
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
      }
  }, [walletClient]); 
  
  useEffect(() => { if(ownerAddress) fetchOwnerData(); }, [ownerAddress]);

  const ensureNetwork = async () => {
      if (chainId !== base.id) {
          try { await switchChainAsync({ chainId: base.id }); } 
          catch (e) { setToast({ msg: "Switch to Base Mainnet first!", type: "error" }); throw new Error("Wrong Network"); }
      }
  };

  const handleWithdrawETH = async () => {
      if (!walletClient || !ownerAddress || !vaultAddress || !ethWithdrawAmount) return;
      if (isNaN(Number(ethWithdrawAmount)) || Number(ethWithdrawAmount) <= 0) {
          setToast({ msg: "Invalid ETH Amount", type: "error" });
          return;
      }
      try {
          await ensureNetwork();
          setActionLoading(`Withdrawing ${ethWithdrawAmount} ETH...`);
          const client = await getUnifiedSmartAccountClient(walletClient, undefined);
          const txHash = await client.sendUserOperation({
              account: client.account!,
              calls: [{ to: ownerAddress as Address, value: parseEther(ethWithdrawAmount), data: "0x" }]
          });
          setToast({ msg: "Withdraw ETH Sent!", type: "success" });
          setEthWithdrawAmount("");
          setShowEthWithdraw(false);
          await new Promise(r => setTimeout(r, 5000));
          await client.waitForUserOperationReceipt({ hash: txHash });
          await fetchVaultData();
      } catch (e: any) {
          console.error(e);
          setToast({ msg: "Withdraw ETH Failed: " + (e.shortMessage || e.message), type: "error" });
      } finally { setActionLoading(null); }
  };

  const handleWithdrawToken = async (token: any) => {
    if (!walletClient || !ownerAddress || !vaultAddress) return;
    const amount = prompt(`Withdraw ${token.symbol}? Enter amount:`, token.formattedBal);
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    if (!window.confirm(`Withdraw ${amount} ${token.symbol} to owner?`)) return;
    try {
      await ensureNetwork(); 
      setActionLoading(`Withdrawing ${token.symbol}...`); 
      const rawAmount = BigInt(Math.floor(parseFloat(amount) * (10 ** token.decimals)));
      const transferData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [ownerAddress as Address, rawAmount]
      });
      const client = await getUnifiedSmartAccountClient(walletClient, undefined);
      const txHash = await client.sendUserOperation({
          account: client.account!,
          calls: [{ to: token.contractAddress as Address, value: 0n, data: transferData }]
      });
      setToast({ msg: "Withdraw Processed!", type: "success" });
      await new Promise(r => setTimeout(r, 5000));
      await client.waitForUserOperationReceipt({ hash: txHash });
      await fetchVaultData();
    } catch (e: any) { 
        console.error(e);
        setToast({ msg: "Failed: " + (e.shortMessage || e.message), type: "error" });
    } finally { setActionLoading(null); }
  };

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
      await new Promise(resolve => setTimeout(resolve, 8000));
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
            <button onClick={() => vaultAddress && navigator.clipboard.writeText(vaultAddress)}><Copy className="w-4 h-4 hover:text-blue-400" /></button>
        </div>
        
        <div className="mt-4 space-y-3">
             {/* ETH SECTION */}
             <div className="bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-400"><Gas className="w-5 h-5" /></div>
                        <div>
                            <div className="text-xs text-zinc-400">Gas Reserve (ETH)</div>
                            <div className="text-lg font-bold">{parseFloat(ethBalance).toFixed(5)}</div>
                        </div>
                    </div>
                    <button onClick={() => setShowEthWithdraw(!showEthWithdraw)} className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-xs font-medium transition-colors border border-zinc-600">
                        {showEthWithdraw ? "Cancel" : "Withdraw"}
                    </button>
                </div>
                {showEthWithdraw && (
                    <div className="mt-3 pt-3 border-t border-zinc-700 animate-in slide-in-from-top-2 duration-200">
                        <div className="flex gap-2">
                            <input type="number" placeholder="Amount (e.g 0.01)" value={ethWithdrawAmount} onChange={(e) => setEthWithdrawAmount(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 placeholder-zinc-500" />
                            <button onClick={handleWithdrawETH} disabled={!ethWithdrawAmount} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1"><Upload className="w-3 h-3" /> Send</button>
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-1 ml-1">To Owner: {ownerAddress?.slice(0,6)}...{ownerAddress?.slice(-4)}</div>
                    </div>
                )}
             </div>

             {/* USDC SECTION */}
             <div className="flex items-center justify-between bg-blue-900/20 p-3 rounded-xl border border-blue-500/30">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white"><Dollar className="w-5 h-5" /></div>
                    <div>
                        <div className="text-xs text-blue-300">USDC Savings</div>
                        <div className="text-lg font-bold text-blue-100">{usdcBalance ? parseFloat(usdcBalance.formattedBal).toFixed(2) : "0.00"}</div>
                    </div>
                </div>
                {usdcBalance && parseFloat(usdcBalance.formattedBal) > 0 && (
                    <button onClick={() => handleWithdrawToken(usdcBalance)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shadow-lg shadow-blue-900/20 transition-all flex items-center gap-1">Withdraw</button>
                )}
             </div>
        </div>
      </div>

      {/* VAULT ASSETS */}
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
                <button onClick={() => handleWithdrawToken(token)} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">WD</button>
            </div>
          ))}
        </div>
        {/* Pagination Logic (Sama) */}
        {/* ... (Copy Pagination Logic dari sebelumnya) ... */}
      </div>

      {/* OWNER ASSETS */}
      {/* ... (Copy Owner Assets Section dari sebelumnya) ... */}
      
    </div>
  );
};