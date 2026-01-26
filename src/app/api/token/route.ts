import { NextResponse } from "next/server";
import Moralis from "moralis";
import { EvmChain } from "@moralisweb3/common-evm-utils";

// Inisialisasi Moralis (Singleton Pattern)
const initMoralis = async () => {
  if (!Moralis.Core.isStarted) {
    await Moralis.start({
      apiKey: process.env.MORALIS_API_KEY, // Pastikan ada di .env.local
    });
  }
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "Address required" }, { status: 400 });
  }

  try {
    await initMoralis();

    // Scan Token di Network BASE MAINNET
    const response = await Moralis.EvmApi.token.getWalletTokenBalances({
      address,
      chain: EvmChain.BASE,
      excludeSpam: true, // Sembunyikan token scam/spam
    });

    // Format data agar enak dibaca frontend
    const tokens = response.raw.map((token) => ({
      name: token.name,
      symbol: token.symbol,
      balance: (Number(token.balance) / 10 ** token.decimals).toFixed(4),
      logo: token.thumbnail, 
      contract: token.token_address,
    }));

    // Filter: Hanya tampilkan yang saldonya > 0
    const activeTokens = tokens.filter(t => parseFloat(t.balance) > 0);

    return NextResponse.json(activeTokens);
  } catch (error: any) {
    console.error("Moralis Error:", error);
    return NextResponse.json({ error: "Gagal scan wallet" }, { status: 500 });
  }
}