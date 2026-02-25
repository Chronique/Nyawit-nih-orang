// src/app/api/prices/route.ts
// Server-side proxy — tidak kena CORS karena fetch dari server, bukan browser

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_CHAIN  = "base";
const WETH_BASE   = "0x4200000000000000000000000000000000000006";
const WETH_MAINNET = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

// ── WETH: ambil harga ETH dari CoinGecko (server-side, no CORS) ───────────────
async function fetchEthPrice(): Promise<number> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    return data?.ethereum?.usd ?? 0;
  } catch {
    return 0;
  }
}

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

// ── 3. DexScreener single fallback ────────────────────────────────────────────
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

// ── Handler ───────────────────────────────────────────────────────────────────
async function handlePrices(addresses: string[]) {
  if (!Array.isArray(addresses) || addresses.length === 0) return {};

  const normalized = addresses.map((a: string) => a.toLowerCase());
  const result: Record<string, number> = {};

  // ── WETH selalu = harga ETH ──────────────────────────────────────────────
  const hasWeth = normalized.includes(WETH_BASE.toLowerCase());
  const nonWeth = normalized.filter(a => a !== WETH_BASE.toLowerCase());

  if (hasWeth) {
    const ethPrice = await fetchEthPrice();
    if (ethPrice > 0) {
      result[WETH_BASE.toLowerCase()]    = ethPrice;
      result[WETH_MAINNET.toLowerCase()] = ethPrice; // jaga-jaga kalau ada yang pakai mainnet addr
    }
  }

  if (nonWeth.length === 0) return result;

  // Step 1: DexScreener batch
  const dex = await fetchDexScreener(nonWeth);
  Object.assign(result, dex);

  // Step 2: GeckoTerminal untuk yang miss
  const missing1 = nonWeth.filter(a => !result[a]);
  if (missing1.length > 0) {
    const gecko = await fetchGeckoTerminal(missing1);
    Object.assign(result, gecko);
  }

  // Step 3: DexScreener single untuk yang masih miss
  const missing2 = nonWeth.filter(a => !result[a]);
  if (missing2.length > 0) {
    await Promise.all(missing2.map(async (addr) => {
      const price = await fetchDexScreenerSingle(addr);
      if (price > 0) result[addr] = price;
    }));
  }

  const stillMissing = normalized.filter(a => !result[a]);
  if (stillMissing.length > 0) {
    console.log("[prices/route] No price for:", stillMissing);
  }

  return result;
}

export async function POST(req: NextRequest) {
  try {
    const { addresses } = await req.json();
    const result = await handlePrices(addresses);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[prices/route] POST error:", e);
    return NextResponse.json({});
  }
}

// GET fallback: /api/prices?addresses=0x...,0x...
export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get("addresses") ?? "";
    const addresses = raw.split(",").map(a => a.trim()).filter(Boolean);
    const result = await handlePrices(addresses);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[prices/route] GET error:", e);
    return NextResponse.json({});
  }
}