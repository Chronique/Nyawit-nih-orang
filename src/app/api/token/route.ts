export const runtime = "nodejs";

import { NextResponse } from "next/server";
import Moralis from "moralis";
import { EvmChain } from "@moralisweb3/common-evm-utils";

let moralisStarted = false;

const initMoralis = async () => {
  if (!process.env.MORALIS_API_KEY) {
    throw new Error("MORALIS_API_KEY not set");
  }

  if (!moralisStarted) {
    await Moralis.start({
      apiKey: process.env.MORALIS_API_KEY,
    });
    moralisStarted = true;
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

    const response = await Moralis.EvmApi.token.getWalletTokenBalances({
      address,
      chain: EvmChain.BASE,
      excludeSpam: true,
    });

    const tokens = response.raw.map((token: any) => ({
      name: token.name,
      symbol: token.symbol,
      balance: (Number(token.balance) / 10 ** token.decimals).toFixed(4),
      logo: token.thumbnail,
      contract: token.token_address,
    }));

    const activeTokens = tokens.filter(
      (t: { balance: string }) => parseFloat(t.balance) > 0
    );

    return NextResponse.json(activeTokens);
  } catch (error) {
    console.error("Moralis Error:", error);
    return NextResponse.json(
      { error: "Gagal scan wallet" },
      { status: 500 }
    );
  }
}
