// src/app/api/quote/route.ts
// Pure LI.FI aggregator — covers 0x, KyberSwap, Uniswap, Paraswap, dll
//
// LI.FI dipilih karena:
//   - Meta-aggregator: cek semua DEX sekaligus
//   - Best route otomatis (harga terbaik)
//   - Support Base native
//   - Fee via integrator parameter (bukan buyTokenPercentageFee yang corrupt buyAmount)
//
// PENTING:
//   - Deny permit2 (vault tidak bisa sign off-chain)
//   - fromAddress = toAddress = vault (vault yang approve, swap, dan terima output)
//   - slippage 0.5 (50 BPS) untuk token micro-cap

import { NextRequest, NextResponse } from "next/server";

const LIFI_API_KEY = process.env.NEXT_PUBLIC_LIFI_API_KEY || "";
const LIFI_API_URL = "https://li.quest/v1";

// Permit2 address — tidak support di vault (butuh off-chain signature EOA)
const PERMIT2_ADDR = "0x000000000022d473030f116ddee9f6b43ac78ba3";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const chainId    = searchParams.get("chainId")    || "8453";
  const sellToken  = searchParams.get("sellToken")  || "";
  const buyToken   = searchParams.get("buyToken")   || "";
  const sellAmount = searchParams.get("sellAmount") || "";
  const taker      = searchParams.get("taker")      || "";
  const slippage   = searchParams.get("slippage")   || "0.005"; // 0.5% default

  if (!sellToken || !buyToken || !sellAmount) {
    return NextResponse.json({ error: "Missing params: sellToken, buyToken, sellAmount" }, { status: 400 });
  }

  const fromAddress = taker || "0x0000000000000000000000000000000000000001";

  const params = new URLSearchParams({
    fromChain:   chainId,
    toChain:     chainId,
    fromToken:   sellToken,
    toToken:     buyToken,
    fromAmount:  sellAmount,
    fromAddress,
    toAddress:   fromAddress, // output balik ke vault juga
    slippage,
    integrator:  "nyawit",
    // Deny exchange yang butuh permit2 atau tidak kompatibel dengan smart account
    denyExchanges: "paraswap,openocean",
  });

  const headers: Record<string, string> = { "Accept": "application/json" };
  if (LIFI_API_KEY) headers["x-lifi-api-key"] = LIFI_API_KEY;

  try {
    const res = await fetch(`${LIFI_API_URL}/quote?${params}`, { headers });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error(`[LI.FI] Non-JSON (${res.status}): ${text.slice(0, 300)}`);
      return NextResponse.json({ error: "LI.FI non-JSON response", status: res.status }, { status: 200 });
    }

    const data = await res.json();

    if (!res.ok || data?.message || data?.code) {
      console.warn(`[LI.FI] Error (${res.status}):`, data?.message || data?.code || data);
      return NextResponse.json({ error: data?.message || "LI.FI quote failed" }, { status: 200 });
    }

    // Guard: reject permit2 approval
    const approvalAddr = (data?.estimate?.approvalAddress || "").toLowerCase();
    if (approvalAddr === PERMIT2_ADDR) {
      console.warn("[LI.FI] permit2 route — skip (vault cannot sign off-chain)");
      return NextResponse.json({ error: "permit2 route not supported" }, { status: 200 });
    }

    // LI.FI response fields
    const buyAmount =
      data.estimate?.toAmount    ||   // gross output
      data.estimate?.toAmountMin ||   // minimum (after slippage)
      "0";

    const approvalAddress =
      data.estimate?.approvalAddress ||
      data.transactionRequest?.to    ||
      "";

    const txTo   = data.transactionRequest?.to   || "";
    const txData = data.transactionRequest?.data || "";
    const txVal  = data.transactionRequest?.value || "0";

    if (!txTo || !txData) {
      console.warn("[LI.FI] No transaction data in response");
      return NextResponse.json({ error: "No transaction data" }, { status: 200 });
    }

    console.log(`[LI.FI] ${sellToken.slice(0,8)}→WETH buyAmount=${buyAmount} via=${data.toolDetails?.name || "?"} router=${txTo.slice(0,10)}`);

    return NextResponse.json({
      _source:  "lifi",
      _tool:    data.toolDetails?.name || data.tool || "",  // nama DEX yang dipilih LI.FI
      buyAmount,
      transaction: {
        to:              txTo,
        data:            txData,
        value:           txVal,
        gasLimit:        data.transactionRequest?.gasLimit,
        approvalAddress, // spender untuk approve()
      },
    });

  } catch (e: any) {
    console.error("[LI.FI] Exception:", e?.message || e);
    return NextResponse.json({ error: "LI.FI fetch exception: " + (e?.message || "unknown") }, { status: 200 });
  }
}
