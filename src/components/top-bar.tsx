/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import Image from "next/image";
import { useFrameContext } from "~/components/providers/frame-provider";
import { sdk } from "@farcaster/miniapp-sdk";
import { useState, useEffect } from "react";
// Import Icon dari Lucide React
import { Wallet, Sun, Moon, Share2, Pin, Github } from "lucide-react";
// Import Toast Baru
import { SimpleToast } from "~/components/ui/simple-toast";

export function TopBar() {
  const frameContext = useFrameContext();
  const [isDark, setIsDark] = useState(false);
  
  // State untuk Toast
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

  // 3. Logic Share (Ganti alert dengan Toast)
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
        // 🔥 GANTI ALERT JADI TOAST
        setToastMsg("Link copied to clipboard! 📋");
      }
    } catch (e) { console.error(e); }
  };

  // 4. Logic Profile Farcaster
  const handleProfileClick = () => {
    if (frameContext?.context && (frameContext.context as any)?.user?.fid) {
      sdk.actions.viewProfile({ fid: (frameContext.context as any).user.fid });
    }
  };

  const userPfp = frameContext?.context && (frameContext.context as any)?.user?.pfpUrl 
    ? (frameContext.context as any).user.pfpUrl 
    : undefined;

  return (
    <>
      {/* PASANG TOAST DISINI */}
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
        
        {/* --- KANAN: ACTION BUTTONS + PROFILE --- */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          
          {/* Github */}
          <a 
            href="https://github.com/Chronique/Nyawit-nih-orang" 
            target="_blank" 
            rel="noopener noreferrer"
            className="p-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-all"
            title="Source Code"
          >
             <Github className="w-4 h-4" />
          </a>

          {/* Pin App (Ganti Alert dengan Toast) */}
          <button 
            className="p-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-blue-600 hover:bg-blue-50 transition-all hidden sm:block"
            title="Pin App"
            onClick={() => setToastMsg("Add to Home Screen for faster access! 📱")} 
          >
             <Pin className="w-4 h-4" />
          </button>

          {/* Share */}
          <button 
            onClick={handleShare}
            className="p-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-green-600 hover:bg-green-50 transition-all"
            title="Share"
          >
             <Share2 className="w-4 h-4" />
          </button>

          {/* Theme Toggle */}
          <button 
            onClick={toggleTheme}
            className="p-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-yellow-600 hover:bg-yellow-50 dark:hover:text-yellow-400 transition-all mr-1"
            title="Toggle Theme"
          >
             {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Profile */}
          <div>
            {userPfp ? (
              <button
                onClick={handleProfileClick}
                className="flex-shrink-0 transition-transform active:scale-95"
              >
                <Image
                  src={userPfp as string}
                  alt="Profile"
                  width={40}
                  height={40}
                  className="w-10 h-10 rounded-full object-cover border-2 border-white dark:border-zinc-800 shadow-sm"
                />
              </button>
            ) : (
              <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400">
                 <Wallet className="w-5 h-5" />
              </div>
            )}
          </div>

        </div>

      </div>
    </>
  );
}