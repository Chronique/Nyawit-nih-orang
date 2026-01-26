// src/lib/price.ts

// Kita pakai GeckoTerminal karena dia support Contract Address (gratis & tanpa API Key)
const BASE_API_URL = "https://api.geckoterminal.com/api/v2/networks/base/tokens_multi";

export const fetchTokenPrices = async (contractAddresses: string[]) => {
  if (contractAddresses.length === 0) return {};

  const prices: Record<string, number> = {};
  const chunkSize = 30; // Gecko limit 30 address per call

  try {
    // Loop untuk menangani lebih dari 30 token (Chunking)
    for (let i = 0; i < contractAddresses.length; i += chunkSize) {
        const chunk = contractAddresses.slice(i, i + chunkSize);
        const addresses = chunk.join(",");
        
        const res = await fetch(`${BASE_API_URL}/${addresses}`);
        const data = await res.json();

        if (data.data) {
            data.data.forEach((token: any) => {
                // Simpan harga dengan key lowercase agar mudah dicocokkan
                prices[token.attributes.address.toLowerCase()] = parseFloat(token.attributes.price_usd);
            });
        }

        // Sedikit delay agar tidak kena rate limit jika token sangat banyak
        if (i + chunkSize < contractAddresses.length) {
            await new Promise(r => setTimeout(r, 200));
        }
    }

    return prices;
  } catch (error) {
    console.error("Failed to get price from GeckoTerminal:", error);
    return {};
  }
};