"use client";

import { useState, useEffect } from "react";
import { useConnect } from "wagmi";
import { Wallet, Hexagon, NavArrowDown, NavArrowUp } from "iconoir-react";

export const WalletConnectPrompt = () => {
  const { connectors, connect } = useConnect();
  const [showEvmList, setShowEvmList] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Hindari hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // 1. Cari Connector untuk Base Smart Wallet (biasanya Coinbase Wallet SDK)
  const baseConnector = connectors.find(
    (c) => c.id === 'coinbaseWalletSDK' || c.name.toLowerCase().includes('coinbase')
  );

  // 2. Connector sisanya (Metamask, Injected, dll)
  const evmConnectors = connectors.filter(
    (c) => c.id !== 'coinbaseWalletSDK' && !c.name.toLowerCase().includes('coinbase')
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 text-center animate-fade-in">
       {/* Header / Logo */}
       {/* Hapus class bg-blue-600 p-4 jika gambarmu sudah bulat/bagus */}
       <div className="mb-6 drop-shadow-xl">
          <img 
            src="/nyawit.png"  // <-- Ganti dengan path gambarmu (misal: /base-logo.png)
            alt="App Logo" 
            className="w-20 h-20 rounded-2xl object-cover" // Atur ukuran di sini
          />
       </div>
       
       <div className="mb-8">
         <h2 className="text-xl font-bold mb-2 text-zinc-800 dark:text-white">Nyawit Nih Orang</h2>
         <p className="text-sm text-zinc-500 max-w-[250px] mx-auto leading-relaxed">
           Connect your wallet to start earning.
         </p>
       </div>

       <div className="w-full max-w-xs space-y-3">
         
         {/* TOMBOL 1: BASE SMART WALLET (RECOMMENDED) */}
         {baseConnector && (
           <button 
             onClick={() => connect({ connector: baseConnector })}
             className="w-full flex items-center justify-between p-4 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-all group active:scale-95"
           >
             <div className="flex items-center gap-3">
               <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-sm">
                  <Hexagon className="w-6 h-6" />
               </div>
               <div className="text-left">
                 <div className="font-bold text-sm text-blue-900">Base Smart Wallet</div>
                 <div className="text-[10px] text-blue-600 font-medium">Recommended</div>
               </div>
             </div>
           </button>
         )}

         {/* TOMBOL 2: EVM WALLET (DROPDOWN) */}
         <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 transition-all">
            <button 
              onClick={() => setShowEvmList(!showEvmList)}
              className="w-full flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-600 dark:text-zinc-400">
                    <Wallet className="w-6 h-6" />
                </div>
                <div className="text-left">
                  <div className="font-bold text-sm text-zinc-700 dark:text-zinc-200">EVM Wallet</div>
                  <div className="text-[10px] text-zinc-400">Metamask, Rainbow, etc</div>
                </div>
              </div>
              {showEvmList ? <NavArrowUp className="w-5 h-5 text-zinc-400" /> : <NavArrowDown className="w-5 h-5 text-zinc-400" />}
            </button>

            {/* LIST EXTENSIONS (MUNCUL JIKA DIKLIK) */}
            {showEvmList && (
              <div className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-2 space-y-1">
                {evmConnectors.length > 0 ? (
                  evmConnectors.map((connector) => (
                    <button
                      key={connector.uid}
                      onClick={() => connect({ connector })}
                      className="w-full p-3 text-sm font-medium rounded-lg hover:bg-white dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 flex items-center justify-center gap-2 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 transition-all"
                    >
                      {/* Tampilkan Nama Walletnya (bukan cuma Connect) */}
                      {connector.name}
                    </button>
                  ))
                ) : (
                  <div className="p-3 text-xs text-center text-zinc-400">
                    Tidak ada wallet lain terdeteksi.
                  </div>
                )}
              </div>
            )}
         </div>

       </div>
    </div>
  );
};