// src/app/api/quote/route.ts
import { NextRequest, NextResponse } from "next/server";

const LIFI_API_KEY = process.env.NEXT_PUBLIC_LIFI_API_KEY || "";
const LIFI_API_URL = "https://li.quest/v1";

// Alamat Permit2 (sering bermasalah dengan Vault/Smart Contract)
const PERMIT2_ADDR = "0x000000000022d473030f116ddee9f6b43ac78ba3";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const chainId    = searchParams.get("chainId")    || "8453"; // Default Base
  const sellToken  = searchParams.get("sellToken")  || "";
  const buyToken   = searchParams.get("buyToken")   || "";
  const sellAmount = searchParams.get("sellAmount") || "";
  const taker      = searchParams.get("taker")      || "";
  const slippage   = searchParams.get("slippage")   || "0.005"; // 0.5%

  if (!sellToken || !buyToken || !sellAmount) {
    return NextResponse.json({ error: "Missing required params" }, { status: 400 });
  }

  // Alamat vault sebagai pemanggil dan penerima
  const fromAddress = taker || "0x0000000000000000000000000000000000000001";

  /**
   * DAFTAR DEX YANG DI-BLOCK:
   * Kita block DEX yang sering bermasalah dengan Smart Contract (EOA-only atau butuh Permit2)
   * LI.FI akan otomatis mencari rute terbaik DILUAR daftar ini.
   */
  const blockedExchanges = ["paraswap", "openocean", "dodo", "sushiswap"];

  const params = new URLSearchParams({
    fromChain:   chainId,
    toChain:     chainId,
    fromToken:   sellToken,
    toToken:     buyToken,
    fromAmount:  sellAmount,
    fromAddress,
    toAddress:   fromAddress,
    slippage,
    integrator:  "nyawit",
    denyExchanges: blockedExchanges.join(","), // LI.FI filter otomatis di server mereka
  });

  const headers: Record<string, string> = { "Accept": "application/json" };
  if (LIFI_API_KEY) headers["x-lifi-api-key"] = LIFI_API_KEY;

  try {
    const res = await fetch(`${LIFI_API_URL}/quote?${params}`, { headers });

    if (!res.ok) {
      const errorData = await res.json();
      return NextResponse.json({ error: errorData.message || "LI.FI Request Failed" }, { status: res.status });
    }

    const data = await res.json();

    // Guard 1: Double check Permit2 (Keamanan tambahan)
    const approvalAddr = (data?.estimate?.approvalAddress || "").toLowerCase();
    if (approvalAddr === PERMIT2_ADDR) {
      return NextResponse.json({ error: "Permit2 route detected, skipping for vault safety." }, { status: 200 });
    }

    // Ekstraksi data untuk dikirim ke Vault
    const buyAmount = data.estimate?.toAmount || "0";
    const txTo      = data.transactionRequest?.to   || "";
    const txData    = data.transactionRequest?.data || "";
    const txVal     = data.transactionRequest?.value || "0";
    const gasLimit  = data.transactionRequest?.gasLimit || "0";

    if (!txTo || !txData) {
      return NextResponse.json({ error: "Incomplete transaction data from LI.FI" }, { status: 200 });
    }

    console.log(`[LI.FI SUCCESS] Route: ${data.tool} | Output: ${buyAmount}`);

    return NextResponse.json({
      _source: "lifi",
      _tool: data.toolDetails?.name || data.tool || "unknown",
      buyAmount,
      transaction: {
        to: txTo,
        data: txData,
        value: txVal,
        gasLimit,
        approvalAddress: data.estimate?.approvalAddress || txTo,
      },
      estimate: {
        feeUsd: data.estimate?.feeCosts?.[0]?.amountUsd || "0",
        executionTime: data.estimate?.executionDuration || 30
      }
    });

  } catch (e: any) {
    console.error("[LI.FI CRITICAL ERROR]:", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}