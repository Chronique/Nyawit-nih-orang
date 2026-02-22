// src/lib/moralis-data.ts
// ── Drop-in replacement: Moralis → Alchemy SDK ────────────────────────────────
// Interface MoralisToken dipertahankan persis sama supaya semua komponen
// (swap-view, vault-view, deposit-view, tanam-view) tidak perlu diubah sama sekali.

import { alchemy } from "~/lib/alchemy";

export interface MoralisToken {
  token_address: string;
  balance:       string;   // raw integer string (bukan hex)
  symbol:        string;
  decimals:      number;
  logo:          string | null;
  name:          string;
}

/**
 * Fetch semua ERC-20 token balance untuk satu address menggunakan Alchemy.
 * Return type identik dengan versi Moralis — komponen tidak perlu diubah.
 *
 * Alchemy `getTokenBalances` → parallel `getTokenMetadata` per token.
 * Free tier: 300M compute units/bulan (sangat cukup untuk mini-app).
 */
export async function fetchMoralisTokens(address: string): Promise<MoralisToken[]> {
  try {
    // Step 1: ambil semua token balance (1 call)
    const balancesRes = await alchemy.core.getTokenBalances(address);
    const nonZero     = balancesRes.tokenBalances.filter(
      t => t.tokenBalance && BigInt(t.tokenBalance) !== 0n
    );

    if (nonZero.length === 0) return [];

    // Step 2: ambil metadata secara parallel
    // Alchemy free tier bisa handle ~50 parallel calls dengan aman
    const CHUNK_SIZE = 25; // batasi parallelism agar tidak throttled
    const results: MoralisToken[] = [];

    for (let i = 0; i < nonZero.length; i += CHUNK_SIZE) {
      const chunk = nonZero.slice(i, i + CHUNK_SIZE);
      const metas = await Promise.all(
        chunk.map(t => alchemy.core.getTokenMetadata(t.contractAddress).catch(() => null))
      );

      for (let j = 0; j < chunk.length; j++) {
        const token = chunk[j];
        const meta  = metas[j];
        if (!meta) continue; // skip kalau metadata gagal

        // Konversi hex balance → decimal string
        // Alchemy return hex string (0x...) atau bisa juga sudah BigInt-able
        const rawBal = token.tokenBalance ?? "0";
        const balDec = BigInt(rawBal).toString();

        results.push({
          token_address: token.contractAddress.toLowerCase(),
          balance:       balDec,
          symbol:        meta.symbol   || "UNKNOWN",
          decimals:      meta.decimals || 18,
          logo:          meta.logo     || null,
          name:          meta.name     || "Unknown Token",
        });
      }
    }

    return results;
  } catch (e) {
    console.error("[AlchemyData] fetchMoralisTokens error:", e);
    return [];
  }
}