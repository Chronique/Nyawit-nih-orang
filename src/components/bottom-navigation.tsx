// src/components/bottom-navigation.tsx
import { Download, Wallet, RefreshDouble } from "iconoir-react"; // Import icon yang sesuai
import { TabType } from "~/types";

interface BottomNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export function BottomNavigation({ activeTab, onTabChange }: BottomNavigationProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-black border-t border-zinc-200 dark:border-zinc-800 pb-safe pt-2 px-6 z-50">
      <div className="flex justify-between items-center max-w-lg mx-auto">
        
        {/* TAB 1: DEPOSIT (Scan EOA) */}
        <button
          onClick={() => onTabChange("deposit")}
          className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
            activeTab === "deposit" ? "text-blue-600" : "text-zinc-400 hover:text-zinc-600"
          }`}
        >
          <Download className="w-6 h-6" />
          <span className="text-[10px] font-medium">Deposit</span>
        </button>

        {/* TAB 2: SWAP (Eksekusi) */}
        <button
          onClick={() => onTabChange("swap")}
          className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
            activeTab === "swap" ? "text-blue-600" : "text-zinc-400 hover:text-zinc-600"
          }`}
        >
          <RefreshDouble className="w-6 h-6" />
          <span className="text-[10px] font-medium">Swap</span>
        </button>

        {/* TAB 3: VAULT (Lihat Saldo AA) */}
        <button
          onClick={() => onTabChange("vault")}
          className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
            activeTab === "vault" ? "text-blue-600" : "text-zinc-400 hover:text-zinc-600"
          }`}
        >
          <Wallet className="w-6 h-6" />
          <span className="text-[10px] font-medium">My Vault</span>
        </button>
      </div>
    </div>
  );
}