// src/app/api/prices/route.ts
// Server-side proxy — tidak kena CORS karena fetch dari server, bukan browser

import { NextRequest, NextResponse } from "next/server";

const BASE_CHAIN = "base";

// ── 1. DexScreener batch ──────────────────────────────────────────────────────
async function fetchDexScreener(addresses: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += 30) chunks.push(addresses.slice(i, i + 30));

  await Promise.all(chunks.map(async (chunk) => {
    try {
      const res = await fetch(
        `https://api.dexscreener.com/tokens/v1/${BASE_CHAIN}/${chunk.join(",")}`,
        { headers: { Accept: "application/json" }, next: { revalidate: 60 } }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const pair of data) {
          const addr  = pair?.baseToken?.address?.toLowerCase();
          const price = parseFloat(pair?.priceUsd || "0");
          if (addr && price > 0 && (!result[addr] || price > result[addr])) {
            result[addr] = price;
          }
        }
      }
    } catch (e) {
      console.warn("[prices/route] DexScreener chunk failed:", e);
    }
  }));
  return result;
}

// ── 2. GeckoTerminal batch ────────────────────────────────────────────────────
async function fetchGeckoTerminal(addresses: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += 30) chunks.push(addresses.slice(i, i + 30));

  await Promise.all(chunks.map(async (chunk) => {
    try {
      const res = await fetch(
        `https://api.geckoterminal.com/api/v2/networks/${BASE_CHAIN}/tokens/multi/${chunk.join(",")}`,
        { headers: { Accept: "application/json" }, next: { revalidate: 60 } }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data?.data && Array.isArray(data.data)) {
        for (const item of data.data) {
          const addr  = item?.attributes?.address?.toLowerCase();
          const price = parseFloat(item?.attributes?.price_usd || "0");
          if (addr && price > 0 && !result[addr]) result[addr] = price;
        }
      }
    } catch (e) {
      console.warn("[prices/route] GeckoTerminal chunk failed:", e);
    }
  }));
  return result;
}

// ── 3. DexScreener single (fallback untuk yang masih miss) ────────────────────
async function fetchDexScreenerSingle(address: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      { headers: { Accept: "application/json" }, next: { revalidate: 60 } }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    const pairs = (data?.pairs ?? []).filter((p: any) => p.chainId === BASE_CHAIN);
    if (pairs.length === 0) return 0;
    pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    return parseFloat(pairs[0]?.priceUsd || "0");
  } catch {
    return 0;
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { addresses } = await req.json();
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return NextResponse.json({});
    }

    const normalized = addresses.map((a: string) => a.toLowerCase());
    const result: Record<string, number> = {};

    // Step 1: DexScreener batch
    const dex = await fetchDexScreener(normalized);
    Object.assign(result, dex);

    // Step 2: GeckoTerminal untuk yang miss
    const missing1 = normalized.filter(a => !result[a]);
    if (missing1.length > 0) {
      const gecko = await fetchGeckoTerminal(missing1);
      Object.assign(result, gecko);
    }

    // Step 3: DexScreener single untuk yang masih miss
    const missing2 = normalized.filter(a => !result[a]);
    if (missing2.length > 0) {
      await Promise.all(missing2.map(async (addr) => {
        const price = await fetchDexScreenerSingle(addr);
        if (price > 0) result[addr] = price;
      }));
    }

    const stillMissing = normalized.filter(a => !result[a]);
    if (stillMissing.length > 0) {
      console.log("[prices/route] No price found for:", stillMissing);
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error("[prices/route] Error:", e);
    return NextResponse.json({});
  }
}