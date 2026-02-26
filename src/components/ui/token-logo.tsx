// src/components/ui/token-logo.tsx
//
// Shared TokenLogo dengan cascade fallback:
//   1. logo dari props (Alchemy / DexScreener yang sudah di-resolve)
//   2. 1inch CDN
//   3. Trust Wallet GitHub (Base network)
//   4. Fallback: placeholder circle dengan inisial token
//
// Usage:
//   <TokenLogo address={token.contractAddress} logo={token.logo} symbol={token.symbol} size="md" />

"use client";

import { useState, useEffect } from "react";
import { oneInchLogoUrl, trustWalletLogoUrl } from "~/lib/resolve-token-logo";

type Size = "sm" | "md" | "lg";
const SIZE_CLASS: Record<Size, string> = {
  sm: "w-6 h-6 text-[8px]",
  md: "w-8 h-8 text-[10px]",
  lg: "w-10 h-10 text-xs",
};

interface TokenLogoProps {
  address: string;        // contract address (required untuk cascade)
  logo?:   string | null; // logo dari metadata (optional)
  symbol?: string;        // untuk fallback inisial
  size?:   Size;
  className?: string;
}

export const TokenLogo = ({
  address,
  logo,
  symbol = "?",
  size = "md",
  className = "",
}: TokenLogoProps) => {
  // Cascade: [resolvedLogo, 1inch, TrustWallet, null (placeholder)]
  const buildSources = (addr: string, initialLogo: string | null): (string | null)[] => [
    initialLogo,
    oneInchLogoUrl(addr),
    trustWalletLogoUrl(addr),
    null, // placeholder
  ];

  const [sources, setSources] = useState<(string | null)[]>(() =>
    buildSources(address, logo ?? null)
  );
  const [srcIndex, setSrcIndex] = useState(0);

  // Reset kalau address/logo berubah
  useEffect(() => {
    setSources(buildSources(address, logo ?? null));
    setSrcIndex(0);
  }, [address, logo]);

  const currentSrc = sources[srcIndex];
  const initials   = symbol.slice(0, 2).toUpperCase();

  // Kalau semua source gagal → tampilkan placeholder inisial
  if (currentSrc === null) {
    return (
      <div
        className={`${SIZE_CLASS[size]} rounded-full bg-zinc-700 flex items-center justify-center font-bold text-zinc-300 shrink-0 ${className}`}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={symbol}
      className={`${SIZE_CLASS[size]} rounded-full object-cover shrink-0 ${className}`}
      onError={() => {
        // Coba source berikutnya
        setSrcIndex(i => i + 1);
      }}
    />
  );
};
