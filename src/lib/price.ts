// src/lib/price.ts
//
// Client-side: semua request harga lewat /api/prices (Next.js proxy)
// Logika fetch DexScreener + GeckoTerminal ada di src/app/api/prices/route.ts
// Dipisah ke server agar tidak kena CORS block di browser.
//
// Return: { [contractAddress_lowercase]: priceUsd }

export async function fetchTokenPrices(
  addresses: string[]
): Promise<Record<string, number>> {
  if (addresses.length === 0) return {};

  try {
    const res = await fetch("/api/prices", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ addresses }),
    });
    if (!res.ok) {
      console.warn("[price] /api/prices returned", res.status);
      return {};
    }
    return res.json();
  } catch (e) {
    console.error("[price] fetchTokenPrices failed:", e);
    return {};
  }
}