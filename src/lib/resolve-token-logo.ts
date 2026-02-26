// src/lib/resolve-token-logo.ts
//
// Cascade logo resolution — no API key needed:
//   1. Alchemy metadata logo  (sudah ada di fetchMoralisTokens)
//   2. 1inch CDN              (coverage luas, CDN cepat)
//   3. Trust Wallet GitHub    (ribuan token Base, gratis, no rate limit)
//   4. DexScreener API        (last resort — satu call per token, cache hasilnya)
//
// Gunakan resolveTokenLogo() di server side (fetchMoralisTokens)
// untuk pre-populate logo sebelum sampai ke komponen.
// TokenLogo komponen tetap punya onError cascade sebagai safety net.

import { getAddress } from "viem";

const DEXSCREENER_CACHE = new Map<string, string | null>();

// ── Trust Wallet URL (checksum address required) ──────────────────────────────
export const trustWalletLogoUrl = (address: string) => {
  try {
    const checksumAddr = getAddress(address); // viem getAddress = checksum
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${checksumAddr}/logo.png`;
  } catch {
    return null;
  }
};

// ── 1inch CDN ─────────────────────────────────────────────────────────────────
export const oneInchLogoUrl = (address: string) =>
  `https://tokens.1inch.io/${address.toLowerCase()}.png`;

// ── DexScreener (async, cache result) ─────────────────────────────────────────
export async function fetchDexScreenerLogo(address: string): Promise<string | null> {
  const key = address.toLowerCase();
  if (DEXSCREENER_CACHE.has(key)) return DEXSCREENER_CACHE.get(key) ?? null;

  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${key}`,
      { next: { revalidate: 3600 } } // Next.js cache 1 jam
    );
    if (!res.ok) { DEXSCREENER_CACHE.set(key, null); return null; }

    const data = await res.json();
    // DexScreener return array pairs, ambil logo dari pair pertama yang ada
    const logo: string | null =
      data?.pairs?.[0]?.baseToken?.address?.toLowerCase() === key
        ? (data.pairs[0]?.info?.imageUrl ?? null)
        : (data.pairs?.[0]?.quoteToken ? null : null); // fallback null

    DEXSCREENER_CACHE.set(key, logo);
    return logo;
  } catch {
    DEXSCREENER_CACHE.set(key, null);
    return null;
  }
}

// ── Main resolver: dipanggil di fetchMoralisTokens untuk pre-populate logo ────
// Urutan: alchemyLogo → 1inch → TrustWallet → DexScreener
// Karena ini async check via HEAD request, kita hanya coba DexScreener
// sebagai fallback terakhir kalau alchemyLogo null.
// 1inch & TrustWallet di-handle lewat onError cascade di komponen (lebih efisien).
export async function resolveTokenLogo(
  address:     string,
  alchemyLogo: string | null
): Promise<string | null> {
  // Kalau Alchemy sudah punya logo, langsung pakai
  if (alchemyLogo) return alchemyLogo;

  // Coba DexScreener sebagai async fallback di server
  // (1inch & TrustWallet di-handle onError di komponen)
  try {
    const dsLogo = await fetchDexScreenerLogo(address);
    if (dsLogo) return dsLogo;
  } catch { /* skip */ }

  return null; // komponen akan handle 1inch → TrustWallet via onError
}
