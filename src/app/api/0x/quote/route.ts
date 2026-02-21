// src/app/api/0x/quote/route.ts

import { type NextRequest, NextResponse } from "next/server";

// PENTING: Jangan pakai NEXT_PUBLIC_ — API key tidak boleh expose ke browser
// Di .env.local: ZEROEX_API_KEY=your_key (tanpa NEXT_PUBLIC)
const ZEROEX_API_KEY = process.env.ZEROEX_API_KEY || process.env.NEXT_PUBLIC_ZEROEX_API_KEY;
const LIFI_API_KEY   = process.env.LIFI_API_KEY   || process.env.NEXT_PUBLIC_LIFI_API_KEY;

export async function GET(request: NextRequest) {
  const params  = request.nextUrl.searchParams;
  const chainId = params.get("chainId") || "8453";

  // ── Try 0x first ──────────────────────────────────────────────────────────
  // Endpoint: allowance-holder (bukan permit2) — vault pakai approve() biasa
  // permit2 butuh off-chain signature yang tidak bisa dilakukan dari smart contract
  if (ZEROEX_API_KEY) {
    try {
      const url = `https://api.0x.org/swap/allowance-holder/quote?${params.toString()}`;
      const res = await fetch(url, {
        headers: {
          "0x-api-key":  ZEROEX_API_KEY,
          "0x-chain-id": chainId,
        },
      });

      const data = await res.json();

      if (res.ok) {
        // Tambah field source biar frontend tahu dapat dari mana
        return NextResponse.json({ ...data, _source: "0x" });
      }

      console.warn("[0x] Failed:", res.status, data?.reason || data?.validationErrors);
      // Kalau 0x gagal, lanjut ke LI.FI fallback
    } catch (e) {
      console.error("[0x] Fetch error:", e);
    }
  } else {
    console.warn("[0x] No API key — skipping, trying LI.FI");
  }

  // ── Fallback: LI.FI ───────────────────────────────────────────────────────
  // Dipakai kalau: 0x tidak ada API key, atau 0x tidak dapat route
  // LI.FI support lebih banyak token, tapi butuh fromAddress
  const fromAddress = params.get("taker") || params.get("fromAddress");

  if (!fromAddress) {
    return NextResponse.json(
      { error: "0x no route and LI.FI requires fromAddress" },
      { status: 400 }
    );
  }

  try {
    const lifiParams = new URLSearchParams({
      fromChain:  chainId,
      toChain:    chainId,
      fromToken:  params.get("sellToken") || "",
      toToken:    params.get("buyToken")  || "",
      fromAmount: params.get("sellAmount") || "",
      fromAddress,
      toAddress:  fromAddress,
      slippage:   "0.03",
    });

    const lifiHeaders: Record<string, string> = {
      Accept: "application/json",
    };
    if (LIFI_API_KEY) {
      lifiHeaders["x-lifi-api-key"] = LIFI_API_KEY;
      lifiParams.set("integrator", "nyawit");
    }

    const lifiRes  = await fetch(`https://li.quest/v1/quote?${lifiParams}`, { headers: lifiHeaders });
    const lifiData = await lifiRes.json();

    if (!lifiRes.ok) {
      return NextResponse.json(
        { error: "No route found", lifi: lifiData },
        { status: 404 }
      );
    }

    // Normalize LI.FI response ke format yang mirip 0x
    // supaya frontend tidak perlu tahu pakai aggregator mana
    return NextResponse.json({
      _source: "lifi",
      transaction: {
        to:    lifiData.transactionRequest?.to,
        data:  lifiData.transactionRequest?.data,
        value: lifiData.transactionRequest?.value || "0",
        gas:   lifiData.transactionRequest?.gasLimit,
      },
      // Sertakan raw LI.FI response juga untuk debugging
      _lifi: lifiData,
    });

  } catch (e: any) {
    console.error("[LI.FI] Fetch error:", e);
    return NextResponse.json(
      { error: "All aggregators failed: " + e?.message },
      { status: 500 }
    );
  }
}