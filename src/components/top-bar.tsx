"use client";

// src/components/top-bar.tsx

import Image from "next/image";
import { useFrameContext } from "~/components/providers/frame-provider";
import { sdk } from "@farcaster/miniapp-sdk";
import { useState, useEffect } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { Sun, Moon, Share2, Github } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { SimpleToast } from "~/components/ui/simple-toast";
import { Wallet } from 'iconoir-react';


export function TopBar() {
  const frameContext = useFrameContext();
  
  

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
    const appUrl = "https://nyawit-nih-orang.vercel.app";
    const castText = `🌴 Nyawit — Sweep your dust tokens into ETH!\n\nSwap all your small coins on Base to ETH in one click.\n\n${appUrl}`;
    try {
      // Farcaster miniapp: cast langsung
      await sdk.actions.openUrl(`https://warpcast.com/~/compose?text=${encodeURIComponent(castText)}`);
    } catch {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(appUrl);
        setToastMsg("Link copied! 📋");
      } catch {
        setToastMsg(appUrl);
      }
    }
  };

  

  const userPfp =
    frameContext?.context && (frameContext.context as any)?.user?.pfpUrl
      ? (frameContext.context as any).user.pfpUrl
      : undefined;

  return (
    <>
      <SimpleToast message={toastMsg} onClose={() => setToastMsg(null)} />

      <div className="w-full flex items-center justify-between py-2">


        {/* --- KIRI: LOGO + ANIMASI TEKS --- */}
        <div className="flex items-center relative" id="tour-logo">
          <div className="relative z-20 bg-white dark:bg-black rounded-full p-1 shadow-lg shadow-blue-500/10">
            <Image 
              src="/nyawit.png" 
              alt="Nyawit Logo" 
              loading="eager"
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

        {/* KANAN: ICON BUTTONS + CONNECT */}
        <div className="flex items-center gap-2">
          {/* Sosmed Group */}
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-full">
            <a
              href="https://github.com/Chronique/Nyawit-nih-orang"
              target="_blank"
              className="p-2 rounded-full text-zinc-500 hover:text-black dark:hover:text-white transition-all"
            >
              <Github className="w-4 h-4" />
            </a>
            <button onClick={handleShare} className="p-2 rounded-full text-zinc-500 hover:text-purple-500 transition-all" title="Share on Farcaster">
              <Share2 className="w-4 h-4" />
            </button>
            <button onClick={toggleTheme} className="p-2 rounded-full text-zinc-500 hover:text-yellow-500 transition-all">
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>

          {/* Connect / Profile */}
          {/* Connect / Profile / Account Modal Section */}
<ConnectButton.Custom>
  {({
    account,
    chain,
    openAccountModal,
    openChainModal,
    openConnectModal,
    mounted,
  }) => {
    const ready = mounted;
    const connected = ready && account && chain;

    return (
      <div
        {...(!ready && {
          'aria-hidden': true,
          style: {
            opacity: 0,
            pointerEvents: 'none',
            userSelect: 'none',
          },
        })}
      >
        {(() => {
          if (!connected) {
            return (
              <button
                onClick={openConnectModal}
                type="button"
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-full text-xs font-bold hover:bg-blue-500 shadow-md transition-all active:scale-95"
              >
                <Wallet className="w-3.5 h-3.5" /> Connect
              </button>
            );
          }

          if (chain.unsupported) {
            return (
              <button 
                onClick={openChainModal}
                type="button"
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-full text-xs font-bold hover:bg-red-500 shadow-md transition-all active:scale-95"
              >
                Wrong Network
              </button>
            );
          }

          return (
            <button 
              onClick={() => {
                // LOGIKA CERDAS: 
                // Jika di Farcaster, buka Profile. Jika di Web, buka Account Modal (untuk Disconnect)
                const fid = (frameContext?.context as any)?.user?.fid;
                if (fid) {
                  sdk.actions.viewProfile({ fid });
                } else {
                  openAccountModal();
                }
              }} 
              type="button"
              className="relative group transition-transform active:scale-95"
            >
              {userPfp ? (
                <Image 
                  src={userPfp} 
                  alt="Profile" 
                  width={36} 
                  height={36} 
                  className="w-9 h-9 rounded-full border-2 border-green-500 object-cover" 
                  priority // Tambahkan priority agar tidak LCP error
                />
              ) : (
                <div className="w-9 h-9 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white border-2 border-green-500 shadow-lg">
                  <Wallet className="w-4 h-4" />
                </div>
              )}
            </button>
          );
        })()}
      </div>
    );
  }}
</ConnectButton.Custom>
          
        </div>
      </div>
    </>
  );
}