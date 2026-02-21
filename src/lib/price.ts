// src/lib/price.ts
//
// Multi-source price fetching dengan fallback:
// 1. DexScreener  — gratis, no API key, Base support bagus
// 2. GeckoTerminal — gratis, kadang 404 untuk token kecil
// 3. Moralis      — fallback terakhir
//
// Return: { [contractAddress_lowercase]: priceUsd }

const BASE_CHAIN = "base";

// ── 1. DexScreener (primary) ──────────────────────────────────────────────────
// Docs: https://docs.dexscreener.com/api/reference
// Support batch up to 30 addresses per call
async function fetchDexScreenerPrices(addresses: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  try {
    // DexScreener: batch by 30
    const chunks: string[][] = [];
    for (let i = 0; i < addresses.length; i += 30) {
      chunks.push(addresses.slice(i, i + 30));
    }

    await Promise.all(
      chunks.map(async (chunk) => {
        const joined = chunk.join(",");
        const res = await fetch(
          `https://api.dexscreener.com/tokens/v1/${BASE_CHAIN}/${joined}`,
          { headers: { Accept: "application/json" } }
        );
        if (!res.ok) return;
        const data = await res.json();

        // data is array of token pairs
        if (Array.isArray(data)) {
          for (const pair of data) {
            const addr = pair?.baseToken?.address?.toLowerCase();
            const price = parseFloat(pair?.priceUsd || "0");
            if (addr && price > 0) {
              // Keep highest price if multiple pairs
              if (!result[addr] || price > result[addr]) {
                result[addr] = price;
              }
            }
          }
        }
      })
    );
  } catch (e) {
    console.warn("[price] DexScreener failed:", e);
  }
  return result;
}

// ── 2. GeckoTerminal (secondary) ─────────────────────────────────────────────
// Docs: https://www.geckoterminal.com/dex-api
// Support batch up to 30 addresses
async function fetchGeckoTerminalPrices(addresses: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  try {
    const chunks: string[][] = [];
    for (let i = 0; i < addresses.length; i += 30) {
      chunks.push(addresses.slice(i, i + 30));
    }

    await Promise.all(
      chunks.map(async (chunk) => {
        const joined = chunk.join(",");
        const res = await fetch(
          `https://api.geckoterminal.com/api/v2/networks/${BASE_CHAIN}/tokens/multi/${joined}`,
          { headers: { Accept: "application/json" } }
        );
        if (!res.ok) return;
        const data = await res.json();

        if (data?.data && Array.isArray(data.data)) {
          for (const item of data.data) {
            const addr = item?.attributes?.address?.toLowerCase();
            const price = parseFloat(item?.attributes?.price_usd || "0");
            if (addr && price > 0 && !result[addr]) {
              result[addr] = price;
            }
          }
        }
      })
    );
  } catch (e) {
    console.warn("[price] GeckoTerminal failed:", e);
  }
  return result;
}

// ── 3. DexScreener single token (tertiary, untuk yang masih miss) ─────────────
async function fetchDexScreenerSingle(address: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    const pairs = data?.pairs?.filter((p: any) => p.chainId === BASE_CHAIN);
    if (!pairs || pairs.length === 0) return 0;
    // Sort by liquidity, pick highest
    pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    return parseFloat(pairs[0]?.priceUsd || "0");
  } catch {
    return 0;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function fetchTokenPrices(
  addresses: string[]
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};

  const normalized = addresses.map((a) => a.toLowerCase());
  const result: Record<string, number> = {};

  // Step 1: DexScreener batch (paling reliable untuk Base)
  const dexPrices = await fetchDexScreenerPrices(normalized);
  Object.assign(result, dexPrices);

  // Step 2: GeckoTerminal untuk yang masih miss
  const missing1 = normalized.filter((a) => !result[a]);
  if (missing1.length > 0) {
    const geckoPrices = await fetchGeckoTerminalPrices(missing1);
    Object.assign(result, geckoPrices);
  }

  // Step 3: DexScreener single untuk yang masih miss (lebih thorough)
  const missing2 = normalized.filter((a) => !result[a]);
  if (missing2.length > 0) {
    await Promise.all(
      missing2.map(async (addr) => {
        const price = await fetchDexScreenerSingle(addr);
        if (price > 0) result[addr] = price;
      })
    );
  }

  // Log miss
  const stillMissing = normalized.filter((a) => !result[a]);
  if (stillMissing.length > 0) {
    console.log("[price] No price found for:", stillMissing);
  }

  return result;
}