"use client";

import { TabType } from "~/types";
import { Map, Flame, Wheat, Sprout } from "lucide-react";

interface BottomNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export const BottomNavigation = ({ activeTab, onTabChange }: BottomNavigationProps) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-black/90 backdrop-blur-lg border-t border-zinc-200 dark:border-zinc-800 pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around items-center h-20 max-w-lg mx-auto px-2">

        {/* 1. BLUSUKAN (Deposit) */}
        <button
          id="tour-nav-deposit"
          onClick={() => onTabChange("deposit")}
          className={`flex flex-col items-center justify-center gap-1 transition-all duration-300 w-16 group ${
            activeTab === "deposit"
              ? "text-zinc-900 dark:text-white"
              : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          }`}
        >
          <div className={`p-2 rounded-2xl transition-all ${
            activeTab === "deposit" ? "bg-zinc-100 dark:bg-zinc-800 shadow-sm translate-y-[-2px]" : "bg-transparent"
          }`}>
            <Map className="w-6 h-6" strokeWidth={activeTab === "deposit" ? 2.5 : 2} />
          </div>
          <span className={`text-[10px] font-bold tracking-tight transition-all ${
            activeTab === "deposit" ? "opacity-100" : "opacity-70"
          }`}>
            Blusukan
          </span>
        </button>

        {/* 2. BAKAR WILAYAH (Swap) */}
        <button
          id="tour-nav-swap"
          onClick={() => onTabChange("swap")}
          className={`flex flex-col items-center justify-center gap-1 transition-all duration-300 w-20 group ${
            activeTab === "swap"
              ? "text-orange-600"
              : "text-zinc-400 hover:text-orange-400"
          }`}
        >
          <div className={`p-2 rounded-2xl transition-all ${
            activeTab === "swap" ? "bg-orange-50 dark:bg-orange-900/20 shadow-sm shadow-orange-500/10 translate-y-[-2px]" : "bg-transparent"
          }`}>
            <Flame className="w-6 h-6" strokeWidth={activeTab === "swap" ? 2.5 : 2} />
          </div>
          <span className={`text-[10px] font-bold tracking-tight transition-all ${
            activeTab === "swap" ? "opacity-100" : "opacity-70"
          }`}>
            Bakar Wilayah
          </span>
        </button>

        {/* 3. TANAM (Morpho Yield) */}
        <button
          id="tour-nav-tanam"
          onClick={() => onTabChange("tanam")}
          className={`flex flex-col items-center justify-center gap-1 transition-all duration-300 w-16 group ${
            activeTab === "tanam"
              ? "text-green-600"
              : "text-zinc-400 hover:text-green-500"
          }`}
        >
          <div className={`p-2 rounded-2xl transition-all ${
            activeTab === "tanam" ? "bg-green-50 dark:bg-green-900/20 shadow-sm shadow-green-500/10 translate-y-[-2px]" : "bg-transparent"
          }`}>
            <Sprout className="w-6 h-6" strokeWidth={activeTab === "tanam" ? 2.5 : 2} />
          </div>
          <span className={`text-[10px] font-bold tracking-tight transition-all ${
            activeTab === "tanam" ? "opacity-100" : "opacity-70"
          }`}>
            Tanam
          </span>
        </button>

        {/* 4. PANEN (Vault) */}
        <button
          id="tour-nav-vault"
          onClick={() => onTabChange("vault")}
          className={`flex flex-col items-center justify-center gap-1 transition-all duration-300 w-16 group ${
            activeTab === "vault"
              ? "text-yellow-600"
              : "text-zinc-400 hover:text-yellow-500"
          }`}
        >
          <div className={`p-2 rounded-2xl transition-all ${
            activeTab === "vault" ? "bg-yellow-50 dark:bg-yellow-900/20 shadow-sm shadow-yellow-500/10 translate-y-[-2px]" : "bg-transparent"
          }`}>
            <Wheat className="w-6 h-6" strokeWidth={activeTab === "vault" ? 2.5 : 2} />
          </div>
          <span className={`text-[10px] font-bold tracking-tight transition-all ${
            activeTab === "vault" ? "opacity-100" : "opacity-70"
          }`}>
            Panen
          </span>
        </button>

      </div>
    </div>
  );
};