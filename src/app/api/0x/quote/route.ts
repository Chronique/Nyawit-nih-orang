// src/app/api/0x/quote/route.ts

import { NextRequest, NextResponse } from "next/server";

const ZEROX_API_KEY  = process.env.ZEROX_API_KEY  || process.env.NEXT_PUBLIC_ZEROX_API_KEY || "";
const LIFI_API_KEY   = process.env.NEXT_PUBLIC_LIFI_API_KEY || "";
const LIFI_API_URL   = "https://li.quest/v1";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const chainId            = searchParams.get("chainId")            || "8453";
  const sellToken          = searchParams.get("sellToken")          || "";
  const buyToken           = searchParams.get("buyToken")           || "";
  const sellAmount         = searchParams.get("sellAmount")         || "";
  const taker              = searchParams.get("taker")              || "";
  // ✅ FIX: default slippage 1.5% (bukan 15%)
  const slippagePercentage = searchParams.get("slippagePercentage") || "0.015";
  const feeRecipient       = searchParams.get("feeRecipient")       || "";
  const buyTokenPctFee     = searchParams.get("buyTokenPercentageFee") || "";

  if (!sellToken || !buyToken || !sellAmount) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  // ── Try 0x v2 API ─────────────────────────────────────────────────────────
  try {
    const params = new URLSearchParams({
      chainId,
      sellToken,
      buyToken,
      sellAmount,
      taker:              taker || "0x0000000000000000000000000000000000000001",
      // ✅ 0x v2 pakai "slippageBps" (integer basis points), bukan slippagePercentage
      // slippagePercentage 0.015 = 1.5% = 150 bps
      slippageBps:        String(Math.round(parseFloat(slippagePercentage) * 10_000)),
    });
    if (feeRecipient && buyTokenPctFee) {
      params.set("affiliateAddress", feeRecipient);
      // 0x v2 pakai "affiliateFee" dalam bps: 0.05 = 5% = 500 bps
      params.set("affiliateFeeBps", String(Math.round(parseFloat(buyTokenPctFee) * 10_000)));
    }

    const res = await fetch(`https://api.0x.org/swap/permit2/quote?${params}`, {
      headers: {
        "0x-api-key":     ZEROX_API_KEY,
        "0x-chain-id":    chainId,
        "Content-Type":   "application/json",
      },
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error(`[0x] Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
      throw new Error(`0x API returned non-JSON (${res.status})`);
    }

    const data = await res.json();

    if (!res.ok || data.code || data.reason) {
      console.warn(`[0x] API error:`, data.reason || data.code || data);
      throw new Error(data.reason || data.message || "0x quote failed");
    }

    const buyAmount =
      data.buyAmount       ||
      data.minBuyAmount    ||
      data.grossBuyAmount  ||
      "0";

    const approvalAddress =
      data.transaction?.allowanceTarget ||
      data.allowanceTarget              ||
      data.transaction?.to              ||
      "";

    console.log(`[0x] ${sellToken.slice(0,8)} → buyAmount=${buyAmount} via=${data.transaction?.to?.slice(0,10)}`);

    return NextResponse.json({
      _source:   "0x",
      buyAmount,
      transaction: {
        data:            data.transaction?.data,
        to:              data.transaction?.to,
        value:           data.transaction?.value || "0",
        gas:             data.transaction?.gas,
        approvalAddress,
      },
    });

  } catch (e0x: any) {
    console.error(`[0x] Fetch error:`, e0x?.message || e0x);
  }

  // ── Fallback: LI.FI ───────────────────────────────────────────────────────
  try {
    const params = new URLSearchParams({
      fromChain:     chainId,
      toChain:       chainId,
      fromToken:     sellToken,
      toToken:       buyToken,
      fromAmount:    sellAmount,
      fromAddress:   taker || "0x0000000000000000000000000000000000000001",
      toAddress:     taker || "0x0000000000000000000000000000000000000001",
      slippage:      slippagePercentage,
      denyExchanges: "paraswap",
    });
    if (LIFI_API_KEY && feeRecipient && buyTokenPctFee) {
      params.set("integrator", "nyawit");
      params.set("fee",        buyTokenPctFee);
      params.set("referrer",   feeRecipient);
    }

    const headers: Record<string, string> = { "Accept": "application/json" };
    if (LIFI_API_KEY) headers["x-lifi-api-key"] = LIFI_API_KEY;

    const res = await fetch(`${LIFI_API_URL}/quote?${params}`, { headers });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error(`[LI.FI] Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
      throw new Error(`LI.FI returned non-JSON (${res.status})`);
    }

    const data = await res.json();

    if (!res.ok) {
      console.warn(`[LI.FI] API error:`, data?.message || data);
      throw new Error(data?.message || "LI.FI quote failed");
    }

    // Permit2 guard
    const approvalAddr = (data?.estimate?.approvalAddress || "").toLowerCase();
    if (approvalAddr === "0x000000000022d473030f116ddee9f6b43ac78ba3") {
      throw new Error("LI.FI: permit2 route not supported in vault");
    }

    const buyAmount =
      data.estimate?.toAmount      ||
      data.estimate?.toAmountMin   ||
      data.action?.toAmount        ||
      "0";

    const approvalAddress = data.estimate?.approvalAddress || data.transactionRequest?.to || "";

    console.log(`[LI.FI] ${sellToken.slice(0,8)} → buyAmount=${buyAmount} via=${data.transactionRequest?.to?.slice(0,10)}`);

    return NextResponse.json({
      _source: "lifi",
      buyAmount,
      transaction: {
        data:            data.transactionRequest?.data,
        to:              data.transactionRequest?.to,
        value:           data.transactionRequest?.value || "0",
        gasLimit:        data.transactionRequest?.gasLimit,
        approvalAddress,
      },
    });

  } catch (elifi: any) {
    console.error(`[LI.FI] Fetch error:`, elifi?.message || elifi);
  }

  return NextResponse.json(
    { error: "No route found", reason: "Both 0x and LI.FI failed to return a valid quote" },
    { status: 200 }
  );
}
