// src/lib/moralis-data.ts

const MORALIS_API_KEY = process.env.NEXT_PUBLIC_MORALIS_API_KEY;

// Interface response dari Moralis
export interface MoralisToken {
  token_address: string;
  name: string;
  symbol: string;
  logo?: string | null;
  thumbnail?: string | null;
  decimals: number;
  balance: string;
}

export const fetchMoralisTokens = async (address: string) => {
  if (!MORALIS_API_KEY) {
    console.error("Moralis API Key missing!");
    return [];
  }

  try {
    // URL untuk Base Sepolia
    // Jika mau Mainnet, ganti 'base%20sepolia' jadi 'base'
    const chain = "base"; 
    const url = `https://deep-index.moralis.io/api/v2.2/${address}/erc20?chain=${chain}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        "accept": "application/json",
        "X-API-Key": MORALIS_API_KEY
      },
    });

    if (!response.ok) throw new Error("Failed to fetch Moralis data");

    const data = await response.json();
    return data as MoralisToken[]; // Moralis mengembalikan array token langsung
  } catch (error) {
    console.error("Moralis Fetch Error:", error);
    return [];
  }
};