"use client";

import Image from "next/image";
import { useFrameContext } from "~/components/providers/frame-provider";
import { sdk } from "@farcaster/miniapp-sdk";
import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth"; // Import Privy
import { useAccount } from "wagmi"; // Import Wagmi status

// Import Icon dari Lucide React
import { Wallet, Sun, Moon, Share2, Pin, Github, LogOut, Loader2 } from "lucide-react";
// Import Toast Baru
import { SimpleToast } from "~/components/ui/simple-toast";

export function TopBar() {
  const frameContext = useFrameContext(); 
  const { login, logout, ready, authenticated, user } = usePrivy(); // Privy Hooks
  const { isConnected, address } = useAccount(); // Wagmi Address
  
  const [isDark, setIsDark] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // 1. Cek Tema Awal
  useEffect(() => {
    if (document.documentElement.classList.contains("dark")) {
      setIsDark(true);
    }
  }, []);

  // 2. Logic Ganti Tema
  const toggleTheme = () => {
    const newTheme = !isDark;
    setIsDark(newTheme);
    if (newTheme) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  // 3. Logic Share
  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Nyawit - Nih - Orang",
          text: "Turn small tokens into valuable assets!",
          url: window.location.href
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setToastMsg("Link copied to clipboard! 📋");
      }
    } catch (e) { console.error(e); }
  };

  // 4. Logic Connect (Manual Trigger)
  // Ini kunci strategi baru kita: Privy muncul BELAKANGAN
  const handleConnect = () => {
      login({ loginMethods: ['wallet', 'email'] }); 
  };

  const handleProfileClick = () => {
    if (frameContext?.context && (frameContext.context as any)?.user?.fid) {
      sdk.actions.viewProfile({ fid: (frameContext.context as any).user.fid });
    }
  };

  // Prioritas Tampilan Profile:
  // 1. Farcaster Context (Seamless)
  // 2. Privy User (jika login email)
  // 3. Wallet Address (jika connect wallet)
  
  const userPfp = frameContext?.context && (frameContext.context as any)?.user?.pfpUrl 
    ? (frameContext.context as any).user.pfpUrl 
    : undefined;

  return (
    <>
      <SimpleToast message={toastMsg} onClose={() => setToastMsg(null)} />

      <div className="w-full mb-6 mt-2 flex items-center justify-between">
        
        {/* --- KIRI: LOGO + ANIMASI TEKS --- */}
        <div className="flex items-center relative" id="tour-logo">
          <div className="relative z-20 bg-white dark:bg-black rounded-full p-1 shadow-lg shadow-blue-500/10">
            <Image 
              src="/nyawit.png" 
              alt="Nyawit Logo" 
              width={64} 
              height={64}
              className="w-16 h-16 object-contain drop-shadow-md hover:scale-105 transition-transform duration-300"
            />
          </div>

          <div className="relative z-10 -ml-10 pl-12 flex flex-col justify-center">
              <h1 className="text-2xl font-black tracking-tighter text-zinc-800 dark:text-white leading-none
                             animate-in slide-in-from-left-8 fade-in duration-1000 fill-mode-forwards">
                NYAWIT
              </h1>
              <p className="text-[10px] font-bold text-blue-600 tracking-widest uppercase
                            animate-in slide-in-from-left-10 fade-in duration-1000 delay-200 fill-mode-forwards">
                DUST SWEEPER
              </p>
          </div>
        </div>
        
        {/* --- KANAN: ACTION BUTTONS + CONNECT --- */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          
          <button 
            onClick={toggleTheme}
            className="p-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-yellow-600 hover:bg-yellow-50 dark:hover:text-yellow-400 transition-all mr-1"
          >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* CONNECT WALLET BUTTON (Logic Baru) */}
          <div>
            {ready && !authenticated ? (
              // BELUM LOGIN -> TAMPILKAN TOMBOL CONNECT
              <button
                onClick={handleConnect}
                className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-full text-xs font-bold hover:opacity-90 transition-all shadow-md"
              >
                 <Wallet className="w-3.5 h-3.5" />
                 Connect
              </button>
            ) : (
              // SUDAH LOGIN -> TAMPILKAN PROFILE / WALLET / FARCASTER
              <button
                onClick={logout} // Klik profile untuk logout (simple)
                className="flex-shrink-0 transition-transform active:scale-95 group relative"
              >
                {userPfp ? (
                  // Jika ada Farcaster PFP
                  <Image
                    src={userPfp as string}
                    alt="Profile"
                    width={40}
                    height={40}
                    className="w-10 h-10 rounded-full object-cover border-2 border-green-500 shadow-sm"
                  />
                ) : (
                  // Jika login wallet biasa/email (tanpa PFP)
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white border-2 border-white dark:border-zinc-800 shadow-sm">
                     <Wallet className="w-5 h-5" />
                  </div>
                )}
                
                {/* Indikator Online */}
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white dark:border-zinc-900 rounded-full"></div>
              </button>
            )}
          </div>

        </div>
      </div>
    </>
  );
}