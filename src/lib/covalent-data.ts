// src/lib/covalent-data.ts (atau timpa di moralis-data.ts)

export interface MoralisToken {
  token_address: string;
  name: string;
  symbol: string;
  logo?: string;
  decimals: number;
  balance: string;
}

export async function fetchWalletTokens(walletAddress: string): Promise<MoralisToken[]> {
  const API_KEY = process.env.NEXT_PUBLIC_COVALENT_API_KEY;
  if (!API_KEY) {
    console.error("Covalent API key is missing!");
    return [];
  }

  // Base Mainnet di Covalent bisa dipanggil pakai ID "8453" atau "base-mainnet"
  const chainId = "base-mainnet"; 
  const url = `https://api.covalenthq.com/v1/${chainId}/address/${walletAddress}/balances_v2/?key=${API_KEY}`;

  try {
    const response = await fetch(url);
    const json = await response.json();

    if (!json.data || !json.data.items) return [];

    return json.data.items
      .filter((item: any) => {
        // 1. Pastikan saldo lebih dari 0
        if (!item.balance || BigInt(item.balance) === 0n) return false;
        
        // 2. Filter ETH Native (0xeeee...) karena kita cuma mau sweep ERC-20
        // (Native ETH sudah di-handle secara terpisah di kodemu)
        if (item.contract_address.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") return false;
        
        // 3. Opsional: filter NFT (Covalent kadang mengembalikan NFT ERC721/1155 di sini)
        if (item.type === "nft") return false;

        return true;
      })
      .map((item: any) => ({
        token_address: item.contract_address,
        name: item.contract_name || "Unknown",
        symbol: item.contract_ticker_symbol || "???",
        logo: item.logo_url || null,
        decimals: item.contract_decimals || 18,
        balance: item.balance.toString(), // Konversi ke string agar sama dengan format Moralis
      }));
  } catch (error) {
    console.error("Failed to fetch tokens from Covalent:", error);
    return [];
  }
}