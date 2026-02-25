// src/lib/moralis-data.ts
// ── Drop-in replacement: Moralis → Alchemy SDK ────────────────────────────────
// Interface MoralisToken dipertahankan persis sama supaya semua komponen
// (swap-view, vault-view, deposit-view, tanam-view) tidak perlu diubah sama sekali.

import { alchemy } from "~/lib/alchemy";
import { TokenBalanceType } from "alchemy-sdk";

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
    const allBalances: any[] = [];
    let pageKey: string | undefined = undefined;

    do {
      const res: any = await alchemy.core.getTokenBalances(address, {
        type: TokenBalanceType.ERC20, // ← explicit ERC20 only
        ...(pageKey ? { pageKey } : {}),
      });
      allBalances.push(...res.tokenBalances);
      pageKey = res.pageKey; // undefined = sudah habis
    } while (pageKey);

    const nonZero = allBalances.filter(
      t => t.tokenBalance && BigInt(t.tokenBalance) !== 0n
    );
    if (nonZero.length === 0) return [];

    // Step 2: ambil metadata secara parallel
    // Alchemy free tier bisa handle ~50 parallel calls dengan aman
    const CHUNK_SIZE = 25;
    const results: MoralisToken[] = [];

    for (let i = 0; i < nonZero.length; i += CHUNK_SIZE) {
      const chunk = nonZero.slice(i, i + CHUNK_SIZE);
      const metas = await Promise.all(
        chunk.map(t => alchemy.core.getTokenMetadata(t.contractAddress).catch(() => null))
      );
      for (let j = 0; j < chunk.length; j++) {
        const token = chunk[j];
        const meta  = metas[j];
        if (!meta) continue;

        results.push({
          token_address: token.contractAddress.toLowerCase(),
          balance:       BigInt(token.tokenBalance ?? "0").toString(),
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