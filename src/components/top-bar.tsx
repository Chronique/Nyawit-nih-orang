"use client";

import Image from "next/image";
import { useFrameContext } from "~/components/providers/frame-provider";
import { sdk } from "@farcaster/miniapp-sdk";
import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { Wallet, Sun, Moon, Share2, Github } from "lucide-react";
import { SimpleToast } from "~/components/ui/simple-toast";

export function TopBar() {
  const frameContext = useFrameContext(); 
  const { login, logout, ready, authenticated } = usePrivy(); 
  const { isConnected } = useAccount(); 
  
  const [isDark, setIsDark] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    if (document.documentElement.classList.contains("dark")) setIsDark(true);
  }, []);

  const toggleTheme = () => {
    const newTheme = !isDark;
    setIsDark(newTheme);
    if (newTheme) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  };

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Nyawit",
          text: "Sweep dust tokens!",
          url: window.location.href
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setToastMsg("Copied! 📋");
      }
    } catch (e) { console.error(e); }
  };

  const handleConnect = () => {
      login({ loginMethods: ['wallet', 'email'] }); 
  };

  const handleProfileClick = () => {
    if (frameContext?.context && (frameContext.context as any)?.user?.fid) {
      sdk.actions.viewProfile({ fid: (frameContext.context as any).user.fid });
    } else {
        // Fallback logout jika diklik user non-farcaster
        logout();
    }
  };

  const userPfp = frameContext?.context && (frameContext.context as any)?.user?.pfpUrl 
    ? (frameContext.context as any).user.pfpUrl 
    : undefined;

  return (
    <>
      <SimpleToast message={toastMsg} onClose={() => setToastMsg(null)} />

      <div className="w-full flex items-center justify-between py-2">
        
        {/* --- KIRI: LOGO --- */}
        <div className="flex items-center gap-2">
          <div className="bg-white dark:bg-black rounded-full p-1 shadow-sm">
            <Image src="/nyawit.png" alt="Logo" width={40} height={40} className="w-10 h-10 object-contain" />
          </div>
          <div className="hidden sm:block leading-tight">
              <h1 className="text-xl font-black text-zinc-800 dark:text-white">NYAWIT</h1>
          </div>
        </div>
        
        {/* --- KANAN: ICON BUTTONS + CONNECT --- */}
        <div className="flex items-center gap-2">
          
          {/* Group Sosmed (Github, Share, Theme) */}
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-full">
              <a href="https://github.com/Chronique/Nyawit-nih-orang" target="_blank" className="p-2 rounded-full text-zinc-500 hover:text-black dark:hover:text-white transition-all">
                <Github className="w-4 h-4" />
              </a>
              <button onClick={handleShare} className="p-2 rounded-full text-zinc-500 hover:text-blue-500 transition-all">
                <Share2 className="w-4 h-4" />
              </button>
              <button onClick={toggleTheme} className="p-2 rounded-full text-zinc-500 hover:text-yellow-500 transition-all">
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
          </div>

          {/* Tombol Connect / Profile */}
          {ready && !authenticated ? (
             <button onClick={handleConnect} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-full text-xs font-bold hover:bg-blue-500 shadow-md transition-all active:scale-95">
                 <Wallet className="w-3.5 h-3.5" /> Connect
             </button>
          ) : (
             <button onClick={handleProfileClick} className="relative group transition-transform active:scale-95">
                {userPfp ? (
                  <Image src={userPfp as string} alt="Profile" width={36} height={36} className="w-9 h-9 rounded-full border-2 border-green-500" />
                ) : (
                  <div className="w-9 h-9 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white border-2 border-green-500 shadow-lg">
                     <Wallet className="w-4 h-4" />
                  </div>
                )}
             </button>
          )}

        </div>
      </div>
    </>
  );
}