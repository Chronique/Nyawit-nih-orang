"use client";

import { TabType } from "~/types";
// Import icon Peta, Api, dan Gandum
import { Map, Flame, Wheat } from "lucide-react";

interface BottomNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export const BottomNavigation = ({ activeTab, onTabChange }: BottomNavigationProps) => {
  return (
    <div className="flex justify-around items-center py-4 bg-white/90 dark:bg-black/90 backdrop-blur-lg border-t border-zinc-200 dark:border-zinc-800 safe-area-pb">
      
      {/* 1. BLUSUKAN (Deposit) - Icon Peta (Map) */}
      <button
        onClick={() => onTabChange("deposit")}
        className={`flex flex-col items-center gap-1.5 transition-all duration-300 w-20 group ${
          activeTab === "deposit" 
            ? "text-zinc-900 dark:text-white scale-110" 
            : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        }`}
      >
        <div className={`p-2.5 rounded-2xl transition-all ${
          activeTab === "deposit" ? "bg-zinc-100 dark:bg-zinc-800 shadow-sm" : "bg-transparent"
        }`}>
          {/* Map: Melambangkan "Blusukan" mencari lokasi/harta */}
          <Map className="w-6 h-6" strokeWidth={activeTab === "deposit" ? 2.5 : 2} />
        </div>
        <span className="text-[10px] font-bold tracking-tight">Blusukan</span>
      </button>

      {/* 2. BAKAR WILAYAH (Swap) - Icon Api (Flame) */}
      <button
        onClick={() => onTabChange("swap")}
        className={`flex flex-col items-center gap-1.5 transition-all duration-300 w-24 group ${
          activeTab === "swap" 
            ? "text-orange-600 scale-110" 
            : "text-zinc-400 hover:text-orange-400"
        }`}
      >
        <div className={`p-2.5 rounded-2xl transition-all ${
          activeTab === "swap" ? "bg-orange-50 dark:bg-orange-900/20 shadow-sm shadow-orange-500/10" : "bg-transparent"
        }`}>
          {/* Flame: Melambangkan "Api Unggun" / Membakar Wilayah */}
          <Flame className="w-6 h-6" strokeWidth={activeTab === "swap" ? 2.5 : 2} />
        </div>
        <span className="text-[10px] font-bold tracking-tight">Bakar Wilayah</span>
      </button>

      {/* 3. PANEN (Vault) - Icon Gandum (Wheat) */}
      <button
        onClick={() => onTabChange("vault")}
        className={`flex flex-col items-center gap-1.5 transition-all duration-300 w-20 group ${
          activeTab === "vault" 
            ? "text-yellow-600 scale-110" 
            : "text-zinc-400 hover:text-yellow-500"
        }`}
      >
        <div className={`p-2.5 rounded-2xl transition-all ${
          activeTab === "vault" ? "bg-yellow-50 dark:bg-yellow-900/20 shadow-sm shadow-yellow-500/10" : "bg-transparent"
        }`}>
          {/* Wheat: Melambangkan "Panen Raya" */}
          <Wheat className="w-6 h-6" strokeWidth={activeTab === "vault" ? 2.5 : 2} />
        </div>
        <span className="text-[10px] font-bold tracking-tight">Panen</span>
      </button>

    </div>
  );
};