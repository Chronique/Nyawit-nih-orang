// src/lib/batch-swap.ts
// Simulate dan execute semua swap dalam 1 UserOperation
// Struktur: [approve1, swap1, approve2, swap2, ...] → sendUserOperation 1x

import { encodeFunctionData, erc20Abi, maxUint256, type Address } from "viem";
import { getSmartAccountClient } from "~/lib/smart-account";

const WETH           = "0x4200000000000000000000000000000000000006" as Address;
const FEE_RECIPIENT  = "0x4fba95e4772be6d37a0c931D00570Fe2c9675524";
// Fee 5% — dikirim ke 0x/LI.FI API sehingga fee sudah di-collect ON-CHAIN oleh aggregator.
// buyAmount yang dikembalikan API sudah BERSIH (setelah fee dipotong oleh router).
// Jadi kita TIDAK perlu mengurangi fee lagi dari grossWethOut di sini.
const FEE_PERCENT    = "0.05";

export interface SwapCandidate {
  token:    Address;
  symbol:   string;
  balance:  bigint;
  route?: {
    to:              Address;
    data:            `0x${string}`;
    value:           bigint;
    approvalSpender: Address;
    agg:             string;
    // buyAmount dari API = sudah NET (setelah fee dipotong oleh router)
    grossWethOut:    bigint;
  };
  status:  "ok" | "skip";
  reason?: string;
  // netWethOut = sama dengan grossWethOut karena fee sudah di-handle oleh router
  netWethOut:    bigint;
  // estimatedFee = 0 karena sudah dipotong oleh aggregator
  estimatedFee:  bigint;
}

export interface SimulationResult {
  calls: {
    to:    Address;
    data:  `0x${string}`;
    value: bigint;
  }[];
  candidates:  SwapCandidate[];   // semua token (ok + skip)
  processable: SwapCandidate[];   // hanya ok
  skipped:     SwapCandidate[];   // hanya skip
  totalNetWeth:  bigint;
  totalFee:      bigint;
  gasEstimate?: {
    callGasLimit:         bigint;
    verificationGasLimit: bigint;
    preVerificationGas:   bigint;
  };
}

// ── Fetch route dari /api/0x/quote ──────────────────────────────────────────
async function fetchRoute(
  token: Address,
  balance: bigint,
  vault: Address,
  chainId: number
): Promise<SwapCandidate["route"] | null> {
  // 1. Try 0x backend (dengan LI.FI fallback)
  try {
    const params = new URLSearchParams({
      chainId:               String(chainId),
      sellToken:             token,
      buyToken:              WETH,
      sellAmount:            balance.toString(),
      taker:                 vault,
      feeRecipient:          FEE_RECIPIENT,
      buyTokenPercentageFee: FEE_PERCENT,
      slippagePercentage:    "0.015", // ✅ FIX: 1.5% slippage (bukan 15%)
    });
    const res = await fetch(`/api/0x/quote?${params}`);
    if (res.ok) {
      const q = await res.json();
      if (q?.transaction?.data && q?.transaction?.to && !q?.error) {
        const gross = BigInt(q.buyAmount || q.estimate?.toAmount || "0");
        if (gross > 0n) {
          return {
            to:              q.transaction.to as Address,
            data:            q.transaction.data as `0x${string}`,
            value:           BigInt(q.transaction.value || "0"),
            approvalSpender: (q.transaction.approvalAddress || q.transaction.to) as Address,
            agg:             q._source === "lifi" ? "LI.FI" : "0x",
            grossWethOut:    gross, // Sudah NET — fee dipotong oleh router
          };
        }
      }
    }
  } catch (e) {
    console.warn("[fetchRoute] 0x/LI.FI failed:", e);
  }

  // 2. KyberSwap fallback (tanpa fee parameter karena KyberSwap tidak support buyTokenFee)
  try {
    const rRes = await fetch(
      `https://aggregator-api.kyberswap.com/base/api/v1/routes?tokenIn=${token}&tokenOut=${WETH}&amountIn=${balance.toString()}`,
      { headers: { Accept: "application/json", "x-client-id": "nyawit" } }
    );
    if (!rRes.ok) return null;
    const rd = await rRes.json();
    if (!rd?.data?.routeSummary) return null;

    const bRes = await fetch(
      "https://aggregator-api.kyberswap.com/base/api/v1/route/build",
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "x-client-id": "nyawit" },
        body: JSON.stringify({
          routeSummary:      rd.data.routeSummary,
          sender:            vault,
          recipient:         vault,
          slippageTolerance: 150, // 1.5% in bps
        }),
      }
    );
    if (!bRes.ok) return null;
    const bd = await bRes.json();
    if (!bd?.data?.data) return null;

    const gross = BigInt(rd.data.routeSummary.amountOut || "0");
    if (gross === 0n) return null;

    // KyberSwap tidak punya built-in fee param → potong manual 5% untuk fee recipient
    // Fee akan di-transfer terpisah di luar scope ini (atau bisa di-skip untuk kesederhanaan)
    const fee    = (gross * 500n) / 10_000n;
    const net    = gross - fee;

    return {
      to:              bd.data.routerAddress as Address,
      data:            bd.data.data as `0x${string}`,
      value:           0n,
      approvalSpender: bd.data.routerAddress as Address,
      agg:             "KyberSwap",
      grossWethOut:    net, // gunakan net karena KyberSwap tidak potong fee
    };
  } catch (e) {
    console.warn("[fetchRoute] KyberSwap fallback failed:", e);
  }

  return null;
}

// ── SIMULATE ─────────────────────────────────────────────────────────────────
export async function simulateBatchSwap({
  walletClient,
  chainId,
  tokens,
}: {
  walletClient: any;
  chainId:      number;
  tokens: { address: Address; symbol: string; balance: bigint }[];
}): Promise<SimulationResult> {
  const client = await getSmartAccountClient(walletClient);
  const vault  = client.account.address;
  const vaultLower = vault.toLowerCase();
  const zeroAddr   = "0x0000000000000000000000000000000000000000";

  // Parallel route fetch
  const candidates: SwapCandidate[] = await Promise.all(
    tokens.map(async t => {
      if (t.balance === 0n) {
        return { token: t.address, symbol: t.symbol, balance: t.balance, status: "skip" as const, reason: "Zero balance", netWethOut: 0n, estimatedFee: 0n };
      }

      const route = await fetchRoute(t.address, t.balance, vault, chainId);
      if (!route) {
        return { token: t.address, symbol: t.symbol, balance: t.balance, status: "skip" as const, reason: "No route found", netWethOut: 0n, estimatedFee: 0n };
      }

      // Guard: spender tidak boleh vault atau zero
      const spender = route.approvalSpender.toLowerCase();
      if (spender === vaultLower || spender === zeroAddr) {
        return { token: t.address, symbol: t.symbol, balance: t.balance, status: "skip" as const, reason: "Invalid spender", netWethOut: 0n, estimatedFee: 0n };
      }

      // ✅ FIX: grossWethOut dari 0x/LI.FI sudah NET (fee sudah dipotong oleh router)
      // Jangan kurangi fee lagi! netWethOut = grossWethOut
      return {
        token:  t.address,
        symbol: t.symbol,
        balance: t.balance,
        route,
        status: "ok" as const,
        netWethOut:   route.grossWethOut, // sudah net
        estimatedFee: 0n,                 // fee sudah di-handle oleh aggregator
      };
    })
  );

  const processable = candidates.filter(c => c.status === "ok");
  const skipped     = candidates.filter(c => c.status === "skip");

  if (processable.length === 0) {
    throw new Error("No routes found for any selected token");
  }

  // Build calls: [approve1, swap1, approve2, swap2, ...]
  const calls: SimulationResult["calls"] = [];
  for (const c of processable) {
    const r = c.route!;
    // approve
    calls.push({
      to:    c.token,
      value: 0n,
      data:  encodeFunctionData({
        abi:          erc20Abi,
        functionName: "approve",
        args:         [r.approvalSpender, maxUint256],
      }),
    });
    // swap
    calls.push({ to: r.to, value: r.value, data: r.data });
  }

  // Static gas estimate — ~200k per approve+swap pair + 50k base
  const gasEstimate: SimulationResult["gasEstimate"] = {
    callGasLimit:         BigInt(processable.length) * 200_000n + 50_000n,
    verificationGasLimit: 100_000n,
    preVerificationGas:   21_000n,
  };

  const totalNetWeth = processable.reduce((a, c) => a + c.netWethOut,   0n);
  const totalFee     = processable.reduce((a, c) => a + c.estimatedFee, 0n);

  return { calls, candidates, processable, skipped, totalNetWeth, totalFee, gasEstimate };
}

// ── EXECUTE ───────────────────────────────────────────────────────────────────
export async function executeBatchSwap({
  walletClient,
  calls,
}: {
  walletClient: any;
  calls: SimulationResult["calls"];
}) {
  const client = await getSmartAccountClient(walletClient);
  const uoHash = await client.sendUserOperation({ calls });
  return await client.waitForUserOperationReceipt({ hash: uoHash });
}
