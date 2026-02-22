// src/app/api/0x/quote/route.ts
//
// PENTING: Pakai /swap/allowance-holder/quote (BUKAN /swap/permit2/quote)
// Vault adalah smart contract → tidak bisa produce Permit2 signature → revert
// Allowance-holder pakai approve() + swap standar → compatible dengan vault

import { NextRequest, NextResponse } from "next/server";

const ZEROX_API_KEY = process.env.ZEROX_API_KEY || process.env.NEXT_PUBLIC_ZEROX_API_KEY || "";
const LIFI_API_KEY  = process.env.NEXT_PUBLIC_LIFI_API_KEY || "";
const LIFI_API_URL  = "https://li.quest/v1";

const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const chainId            = searchParams.get("chainId")               || "8453";
  const sellToken          = searchParams.get("sellToken")             || "";
  const buyToken           = searchParams.get("buyToken")              || "";
  const sellAmount         = searchParams.get("sellAmount")            || "";
  const taker              = searchParams.get("taker")                 || "";
  const slippagePercentage = searchParams.get("slippagePercentage")    || "0.015";
  const feeRecipient       = searchParams.get("feeRecipient")          || "";
  const buyTokenPctFee     = searchParams.get("buyTokenPercentageFee") || "";

  if (!sellToken || !buyToken || !sellAmount) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  const slippageBps = String(Math.round(parseFloat(slippagePercentage) * 10_000));
  const feesBps     = feeRecipient && buyTokenPctFee
    ? String(Math.round(parseFloat(buyTokenPctFee) * 10_000))
    : "";

  // ── 1. 0x Allowance-Holder (smart contract compatible) ────────────────────
  // /allowance-holder/ = approve(spender) + swap → WORKS di smart contract vault
  // /permit2/          = EIP-712 off-chain signature → REVERT di smart contract vault
  if (ZEROX_API_KEY) {
    try {
      const params = new URLSearchParams({
        chainId,
        sellToken,
        buyToken,
        sellAmount,
        taker:       taker || "0x0000000000000000000000000000000000000001",
        slippageBps,
      });
      if (feeRecipient && feesBps) {
        params.set("affiliateAddress", feeRecipient);
        params.set("affiliateFeeBps",  feesBps);
      }

      const res = await fetch(
        `https://api.0x.org/swap/allowance-holder/quote?${params}`,
        {
          headers: {
            "0x-api-key":   ZEROX_API_KEY,
            "0x-chain-id":  chainId,
            "Content-Type": "application/json",
          },
        }
      );

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const text = await res.text();
        console.error(`[0x AH] Non-JSON (${res.status}): ${text.slice(0, 200)}`);
        throw new Error(`0x allowance-holder non-JSON (${res.status})`);
      }

      const data = await res.json();

      if (!res.ok || data.code || data.reason || data.message) {
        console.warn(`[0x AH] Error:`, data.reason || data.message || data.code);
        throw new Error(data.reason || data.message || "0x allowance-holder failed");
      }

      const buyAmount = data.buyAmount || data.minBuyAmount || "0";
      if (!buyAmount || buyAmount === "0") throw new Error("0x: buyAmount is 0");

      // Cek approvalAddress bukan Permit2
      const spender = (
        data.issues?.allowances?.[0]?.spender ||
        data.transaction?.allowanceTarget      ||
        data.allowanceTarget                   ||
        data.transaction?.to                   ||
        ""
      ).toLowerCase();

      if (spender === PERMIT2_ADDRESS) {
        throw new Error("0x: allowance-holder returned Permit2 spender — unexpected");
      }

      console.log(`[0x AH] ${sellToken.slice(0,8)} → buyAmount=${buyAmount} spender=${spender.slice(0,10)} router=${data.transaction?.to?.slice(0,10)}`);

      return NextResponse.json({
        _source:  "0x",
        buyAmount,
        transaction: {
          data:            data.transaction?.data,
          to:              data.transaction?.to,
          value:           data.transaction?.value || "0",
          gas:             data.transaction?.gas,
          approvalAddress: spender,
        },
      });

    } catch (e: any) {
      console.error(`[0x AH] Failed:`, e?.message || e);
    }
  }

  // ── 2. LI.FI fallback ─────────────────────────────────────────────────────
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

    const headers: Record<string, string> = { Accept: "application/json" };
    if (LIFI_API_KEY) headers["x-lifi-api-key"] = LIFI_API_KEY;

    const res = await fetch(`${LIFI_API_URL}/quote?${params}`, { headers });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error(`[LI.FI] Non-JSON (${res.status}): ${text.slice(0, 200)}`);
      throw new Error(`LI.FI non-JSON (${res.status})`);
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || "LI.FI failed");

    // Tolak route Permit2
    const approvalAddr = (data?.estimate?.approvalAddress || "").toLowerCase();
    if (approvalAddr === PERMIT2_ADDRESS) {
      throw new Error("LI.FI: route requires Permit2 — not supported in vault");
    }

    const buyAmount = data.estimate?.toAmount || data.estimate?.toAmountMin || "0";
    if (!buyAmount || buyAmount === "0") throw new Error("LI.FI: toAmount is 0");

    const approvalAddress = data.estimate?.approvalAddress || data.transactionRequest?.to || "";

    console.log(`[LI.FI] ${sellToken.slice(0,8)} → buyAmount=${buyAmount} spender=${approvalAddress.slice(0,10)}`);

    return NextResponse.json({
      _source:  "lifi",
      buyAmount,
      transaction: {
        data:            data.transactionRequest?.data,
        to:              data.transactionRequest?.to,
        value:           data.transactionRequest?.value || "0",
        gasLimit:        data.transactionRequest?.gasLimit,
        approvalAddress,
      },
    });

  } catch (e: any) {
    console.error(`[LI.FI] Failed:`, e?.message || e);
  }

  // ── 3. KyberSwap last resort ──────────────────────────────────────────────
  try {
    const rRes = await fetch(
      `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${sellToken}&tokenOut=${buyToken}&amountIn=${sellAmount}`,
      { headers: { Accept: "application/json", "x-client-id": "nyawit" } }
    );
    if (!rRes.ok) throw new Error(`KyberSwap routes ${rRes.status}`);
    const rd = await rRes.json();
    if (!rd?.data?.routeSummary) throw new Error("KyberSwap: no routeSummary");

    const bRes = await fetch(
      "https://aggregator-api.kyberswap.com/base/api/v1/route/build",
      {
        method:  "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-client-id": "nyawit",
        },
        body: JSON.stringify({
          routeSummary:      rd.data.routeSummary,
          sender:            taker || "0x0000000000000000000000000000000000000001",
          recipient:         taker || "0x0000000000000000000000000000000000000001",
          slippageTolerance: 150,
        }),
      }
    );
    if (!bRes.ok) throw new Error(`KyberSwap build ${bRes.status}`);
    const bd = await bRes.json();
    if (!bd?.data?.data) throw new Error("KyberSwap: no tx data");

    const approvalAddress = bd.data.routerAddress || "";
    const buyAmount       = rd.data.routeSummary.amountOut || "0";

    console.log(`[KyberSwap] ${sellToken.slice(0,8)} → buyAmount=${buyAmount} router=${approvalAddress.slice(0,10)}`);

    return NextResponse.json({
      _source:  "kyberswap",
      buyAmount,
      transaction: {
        data:            bd.data.data,
        to:              bd.data.routerAddress,
        value:           "0",
        approvalAddress,
      },
    });

  } catch (e: any) {
    console.error(`[KyberSwap] Failed:`, e?.message || e);
  }

  return NextResponse.json(
    { error: "No route found", reason: "0x allowance-holder, LI.FI, and KyberSwap all failed" },
    { status: 200 }
  );
}