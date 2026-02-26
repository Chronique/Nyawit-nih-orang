// src/lib/moralis-data.ts
// ── Drop-in replacement: Moralis → Alchemy SDK ────────────────────────────────

import { alchemy } from "~/lib/alchemy";
import { TokenBalanceType } from "alchemy-sdk";
import { resolveTokenLogo } from "~/lib/resolve-token-logo";

export interface MoralisToken {
  token_address: string;
  balance:       string;
  symbol:        string;
  decimals:      number;
  logo:          string | null;
  name:          string;
}

export async function fetchMoralisTokens(address: string): Promise<MoralisToken[]> {
  try {
    // Step 1: ambil semua token balance dengan pagination
    const allBalances: any[] = [];
    let pageKey: string | undefined = undefined;

    do {
      const res: any = await alchemy.core.getTokenBalances(address, {
        type: TokenBalanceType.ERC20,
        ...(pageKey ? { pageKey } : {}),
      });
      allBalances.push(...res.tokenBalances);
      pageKey = res.pageKey;
    } while (pageKey);

    // ── DEDUPLICATE by contractAddress (case-insensitive) ──────────────────
    // Alchemy kadang return token yang sama 2x dari page berbeda
    const seenAddresses = new Set<string>();
    const uniqueBalances = allBalances.filter(t => {
      const addr = t.contractAddress?.toLowerCase();
      if (!addr || seenAddresses.has(addr)) return false;
      seenAddresses.add(addr);
      return true;
    });

    const nonZero = uniqueBalances.filter(
      t => t.tokenBalance && BigInt(t.tokenBalance) !== 0n
    );
    if (nonZero.length === 0) return [];

    // Step 2: ambil metadata secara parallel, chunked
    const CHUNK_SIZE = 25;
    const results: MoralisToken[] = [];

    for (let i = 0; i < nonZero.length; i += CHUNK_SIZE) {
      const chunk = nonZero.slice(i, i + CHUNK_SIZE);
      const metas = await Promise.all(
        chunk.map(t => alchemy.core.getTokenMetadata(t.contractAddress).catch(() => null))
      );

      // Step 3: resolve logo dengan cascade (parallel per chunk)
      // Alchemy logo → DexScreener. 1inch & TrustWallet di-handle komponen.
      const logos = await Promise.all(
        chunk.map((t, j) =>
          resolveTokenLogo(t.contractAddress, metas[j]?.logo ?? null).catch(() => null)
        )
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
          logo:          logos[j],        // ← resolved logo (Alchemy atau DexScreener)
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
