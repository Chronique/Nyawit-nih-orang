// src/app/api/0x/quote/route.ts

import { type NextRequest, NextResponse } from "next/server";

// Server-only keys — jangan pakai NEXT_PUBLIC_ untuk API keys
// .env.local: ZEROEX_API_KEY=xxx dan LIFI_API_KEY=xxx
const ZEROEX_API_KEY = process.env.ZEROEX_API_KEY || process.env.NEXT_PUBLIC_ZEROEX_API_KEY;
const LIFI_API_KEY   = process.env.LIFI_API_KEY   || process.env.NEXT_PUBLIC_LIFI_API_KEY;

export async function GET(request: NextRequest) {
  const params  = request.nextUrl.searchParams;
  const chainId = params.get("chainId") || "8453";

  // ── 0x allowance-holder ───────────────────────────────────────────────────
  // Endpoint: allowance-holder (bukan permit2) — vault pakai approve() biasa
  if (ZEROEX_API_KEY) {
    try {
      const url = `https://api.0x.org/swap/allowance-holder/quote?${params.toString()}`;
      const res  = await fetch(url, {
        headers: {
          "0x-api-key":  ZEROEX_API_KEY,
          "0x-chain-id": chainId,
        },
      });
      const data = await res.json();

      if (res.ok) {
        return NextResponse.json({ ...data, _source: "0x" });
      }
      console.warn("[0x] Failed:", res.status, data?.reason || data?.validationErrors);
    } catch (e) {
      console.error("[0x] Fetch error:", e);
    }
  }

  // ── LI.FI fallback ────────────────────────────────────────────────────────
  // Dipakai kalau 0x tidak punya route atau tidak ada API key
  const fromAddress = params.get("taker") || params.get("fromAddress");
  if (!fromAddress) {
    return NextResponse.json({ error: "No route found (0x failed, LI.FI requires fromAddress)" }, { status: 400 });
  }

  try {
    const lifiParams = new URLSearchParams({
      fromChain:     chainId,
      toChain:       chainId,
      fromToken:     params.get("sellToken")  || "",
      toToken:       params.get("buyToken")   || "",
      fromAmount:    params.get("sellAmount") || "",
      fromAddress,
      toAddress:     fromAddress,
      slippage:      "0.03",
      denyExchanges: "paraswap", // paraswap pakai permit2, tidak compatible vault
    });

    const feeRecipient = params.get("feeRecipient");
    const lifiHeaders: Record<string, string> = { Accept: "application/json" };
    if (LIFI_API_KEY) {
      lifiHeaders["x-lifi-api-key"] = LIFI_API_KEY;
      lifiParams.set("integrator", "nyawit");
      if (feeRecipient) {
        lifiParams.set("fee",      params.get("buyTokenPercentageFee") || "0.05");
        lifiParams.set("referrer", feeRecipient);
      }
    }

    const lifiRes  = await fetch(`https://li.quest/v1/quote?${lifiParams}`, { headers: lifiHeaders });
    const lifiData = await lifiRes.json();

    if (!lifiRes.ok) {
      return NextResponse.json({ error: "No route found", detail: lifiData }, { status: 404 });
    }

    // Reject permit2 routes — vault tidak support off-chain signature
    const approvalAddr = (lifiData?.estimate?.approvalAddress || "").toLowerCase();
    if (approvalAddr === "0x000000000022d473030f116ddee9f6b43ac78ba3") {
      return NextResponse.json({ error: "LI.FI: only permit2 route available — not supported" }, { status: 404 });
    }

    // Normalize ke format mirip 0x supaya frontend bisa pakai response yang sama
    // approvalAddress di-expose — frontend HARUS approve ke sini, bukan ke transaction.to
    return NextResponse.json({
      _source: "lifi",
      transaction: {
        to:    lifiData.transactionRequest?.to,
        data:  lifiData.transactionRequest?.data,
        value: lifiData.transactionRequest?.value || "0",
        gas:   lifiData.transactionRequest?.gasLimit,
        // approvalAddress = target untuk ERC20 approve()
        // bisa beda dari `to` — ini yang bikin revert kalau salah
        approvalAddress: lifiData.estimate?.approvalAddress || lifiData.transactionRequest?.to,
      },
    });

  } catch (e: any) {
    console.error("[LI.FI] Error:", e);
    return NextResponse.json({ error: "All aggregators failed: " + e?.message }, { status: 500 });
  }
}