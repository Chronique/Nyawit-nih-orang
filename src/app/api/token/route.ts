// src/app/api/tokens/route.ts — pakai Alchemy, bukan Moralis
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { alchemy } from "~/lib/alchemy";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "Address required" }, { status: 400 });
  }

  try {
    const balancesRes = await alchemy.core.getTokenBalances(address);
    const nonZero = balancesRes.tokenBalances.filter(
      t => t.tokenBalance && BigInt(t.tokenBalance) !== 0n
    );

    const tokens = await Promise.all(
      nonZero.map(async (t) => {
        const meta = await alchemy.core.getTokenMetadata(t.contractAddress).catch(() => null);
        if (!meta) return null;
        const decimals = meta.decimals || 18;
        const balance  = (Number(BigInt(t.tokenBalance ?? "0")) / 10 ** decimals).toFixed(4);
        return {
          name:     meta.name     || "Unknown",
          symbol:   meta.symbol   || "???",
          balance,
          logo:     meta.logo     || null,
          contract: t.contractAddress.toLowerCase(),
        };
      })
    );

    const active = tokens.filter(t => t !== null && parseFloat(t!.balance) > 0);
    return NextResponse.json(active);
  } catch (e) {
    console.error("[/api/tokens]", e);
    return NextResponse.json({ error: "Gagal scan wallet" }, { status: 500 });
  }
}